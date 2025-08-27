from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ...models import Building, Drone, Vec3, World
from .base import AlgoContext, Algorithm

Coord = Tuple[int,int]

def _rect_overlaps_cell(cx, cy, w, d, cell_x, cell_y, cell_size):
    half = cell_size * 0.5
    rxmin = cx - w*0.5; rxmax = cx + w*0.5
    rymin = cy - d*0.5; rymax = cy + d*0.5
    cxmin = cell_x*cell_size; cxmax = cxmin + cell_size
    cymin = cell_y*cell_size; cymax = cymin + cell_size
    return not (rxmax <= cxmin or rxmin >= cxmax or rymax <= cymin or rymin >= cymax)

@dataclass
class GridCache:
    cell: float
    width: int
    height: int
    blocked: List[bool]  # len = width*height
    max_building_z: float

    @staticmethod
    def build(world: World, cell_size: float, clearance: float) -> "GridCache":
        w_cells = max(1, int(world.size[0] // cell_size))
        h_cells = max(1, int(world.size[1] // cell_size))
        blocked = [False]*(w_cells*h_cells)
        maxz = 0.0
        # grow each building footprint by 'clearance' in each axis
        for b in world.obstacles:
            maxz = max(maxz, b.size.z)
            cx, cy = b.center.x, b.center.y
            w, d = b.size.x + 2*clearance, b.size.y + 2*clearance
            # compute candidate cell range
            xmin = max(0, int((cx - w*0.5)//cell_size))
            xmax = min(w_cells-1, int((cx + w*0.5)//cell_size))
            ymin = max(0, int((cy - d*0.5)//cell_size))
            ymax = min(h_cells-1, int((cy + d*0.5)//cell_size))
            for gx in range(xmin, xmax+1):
                for gy in range(ymin, ymax+1):
                    if _rect_overlaps_cell(cx, cy, w, d, gx, gy, cell_size):
                        blocked[gy*w_cells + gx] = True
        return GridCache(cell=cell_size, width=w_cells, height=h_cells, blocked=blocked, max_building_z=maxz)

    def is_blocked(self, g: Coord) -> bool:
        x,y = g
        if x<0 or y<0 or x>=self.width or y>=self.height: return True
        return self.blocked[y*self.width + x]

    def to_world(self, g: Coord, z: float) -> Vec3:
        gx, gy = g
        return Vec3(x=(gx+0.5)*self.cell, y=(gy+0.5)*self.cell, z=z)

    def from_world(self, x: float, y: float) -> Coord:
        return (max(0, min(self.width-1, int(x // self.cell))),
                max(0, min(self.height-1, int(y // self.cell))))

class AStarGrid(Algorithm):
    name = "a_star_grid"

    def __init__(self):
        self._grid_cache: Optional[GridCache] = None
        self._replan_every = 10   # ticks
        self._last_planned_tick: Dict[str,int] = {}
        self._last_target_key: Dict[str,Tuple[float,float]] = {}

    def plan_paths(self, ctx: AlgoContext) -> None:
        p = ctx.params or {}
        cell = float(p.get("grid_cell_m", 10.0))
        clearance = float(p.get("clearance_m", 5.0))
        cruise_alt = float(p.get("cruise_alt_m", 50.0))
        diagonal = bool(p.get("allow_diagonal", True))

        if self._grid_cache is None or getattr(self._grid_cache, "cell", None) != cell:
            self._grid_cache = GridCache.build(ctx.world, cell, clearance)

        for d in ctx.drones:
            if not d.target: 
                continue
            tgt = (d.target.x, d.target.y)
            # replan on first time / target change / cadence
            if (d.id not in self._last_planned_tick
                or self._last_target_key.get(d.id) != tgt
                or (ctx.params.get("tick", 0) - self._last_planned_tick[d.id]) >= self._replan_every
                or not d.path):
                path = self._plan_one(d.pos, d.target, self._grid_cache, cruise_alt, diagonal)
                d.path = path
                self._last_planned_tick[d.id] = int(ctx.params.get("tick", 0))
                self._last_target_key[d.id] = tgt

    def _plan_one(self, start: Vec3, goal: Vec3, grid: GridCache, z: float, diagonal: bool) -> List[Vec3]:
        s = grid.from_world(start.x, start.y)
        g = grid.from_world(goal.x, goal.y)
        if grid.is_blocked(g):  # nudge goal to nearest free
            g = self._nearest_free(g, grid)
        came: Dict[Coord,Coord] = {}
        g_score: Dict[Coord,float] = {s: 0.0}
        f_score: Dict[Coord,float] = {s: self._h(s,g)}
        openpq: List[Tuple[float,Coord]] = [(f_score[s], s)]
        closed = set()
        nbrs4 = [(-1,0),(1,0),(0,-1),(0,1)]
        nbrs8 = nbrs4 + [(-1,-1),(1,-1),(-1,1),(1,1)]
        nbrs = nbrs8 if diagonal else nbrs4

        while openpq:
            _, cur = heapq.heappop(openpq)
            if cur in closed: 
                continue
            if cur == g:
                return self._reconstruct(cur, came, grid, z)
            closed.add(cur)
            cx,cy = cur
            for dx,dy in nbrs:
                nx,ny = cx+dx, cy+dy
                n = (nx,ny)
                if grid.is_blocked(n) or n in closed: 
                    continue
                step = math.sqrt(2) if (dx!=0 and dy!=0) else 1.0
                tentative = g_score[cur] + step
                if tentative < g_score.get(n, 1e18):
                    came[n] = cur
                    g_score[n] = tentative
                    fval = tentative + self._h(n,g)
                    f_score[n] = fval
                    heapq.heappush(openpq, (fval, n))
        # fallback: straight-ish line samples
        return [Vec3(x=goal.x, y=goal.y, z=z)]

    def _reconstruct(self, cur: Coord, came: Dict[Coord,Coord], grid: GridCache, z: float) -> List[Vec3]:
        path = [cur]
        while cur in came:
            cur = came[cur]
            path.append(cur)
        path.reverse()
        return [grid.to_world(g, z) for g in path]

    def _h(self, a: Coord, b: Coord) -> float:
        return abs(a[0]-b[0]) + abs(a[1]-b[1])

    def _nearest_free(self, g: Coord, grid: GridCache) -> Coord:
        # small spiral search
        if not grid.is_blocked(g): return g
        for r in range(1, 20):
            for dx in range(-r, r+1):
                for dy in (-r, r):
                    c = (g[0]+dx, g[1]+dy)
                    if not grid.is_blocked(c): return c
            for dy in range(-r+1, r):
                for dx in (-r, r):
                    c = (g[0]+dx, g[1]+dy)
                    if not grid.is_blocked(c): return c
        return g
