from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from ...models import Drone, Vec3, World
from .base import AlgoContext, Algorithm

Coord = Tuple[int, int]


def _rect_overlaps_cell(cx, cy, w, d, cell_x, cell_y, cell_size):
    rx0, rx1 = cx - w * 0.5, cx + w * 0.5
    ry0, ry1 = cy - d * 0.5, cy + d * 0.5
    cx0, cx1 = cell_x * cell_size, (cell_x + 1) * cell_size
    cy0, cy1 = cell_y * cell_size, (cell_y + 1) * cell_size
    return not (rx1 <= cx0 or rx0 >= cx1 or ry1 <= cy0 or ry0 >= cy1)


@dataclass
class GridCacheBMHA:
    """Grid cache with inflated blocked mask + clearance (meters to nearest blocked)."""
    cell: float
    w: int
    h: int
    blocked: List[bool]
    clearance_m: List[float]

    @staticmethod
    def build(world: World, cell_size: float, clearance_inflate_m: float) -> "GridCacheBMHA":
        w_cells = max(1, int(world.size[0] // cell_size))
        h_cells = max(1, int(world.size[1] // cell_size))
        N = w_cells * h_cells

        blocked = [False] * N
        for b in world.obstacles:
            cx, cy = b.center.x, b.center.y
            w, d = b.size.x + 2 * clearance_inflate_m, b.size.y + 2 * clearance_inflate_m
            xmin = max(0, int((cx - w * 0.5) // cell_size))
            xmax = min(w_cells - 1, int((cx + w * 0.5) // cell_size))
            ymin = max(0, int((cy - d * 0.5) // cell_size))
            ymax = min(h_cells - 1, int((cy + d * 0.5) // cell_size))
            for gx in range(xmin, xmax + 1):
                for gy in range(ymin, ymax + 1):
                    if _rect_overlaps_cell(cx, cy, w, d, gx, gy, cell_size):
                        blocked[gy * w_cells + gx] = True

        INF = 10**9
        dist = [0 if blocked[i] else INF for i in range(N)]

        for y in range(h_cells):
            row = y * w_cells
            for x in range(w_cells):
                i = row + x
                if dist[i] == 0:
                    continue
                best = dist[i]
                if x > 0:
                    best = min(best, dist[i - 1] + 1)
                if y > 0:
                    best = min(best, dist[i - w_cells] + 1)
                dist[i] = best

        for y in range(h_cells - 1, -1, -1):
            row = y * w_cells
            for x in range(w_cells - 1, -1, -1):
                i = row + x
                if dist[i] == 0:
                    continue
                best = dist[i]
                if x + 1 < w_cells:
                    best = min(best, dist[i + 1] + 1)
                if y + 1 < h_cells:
                    best = min(best, dist[i + w_cells] + 1)
                dist[i] = best

        clearance_m = [d * cell_size for d in dist]
        return GridCacheBMHA(cell=cell_size, w=w_cells, h=h_cells,
                             blocked=blocked, clearance_m=clearance_m)

    @staticmethod
    def build_fallback(world: World, cell_size: float, clearance_inflate_m: float) -> "GridCacheBMHA":
        w_cells = max(1, int(world.size[0] // cell_size))
        h_cells = max(1, int(world.size[1] // cell_size))
        N = w_cells * h_cells
        blocked = [False] * N
        for b in world.obstacles:
            gx = max(0, min(w_cells - 1, int(b.center.x // cell_size)))
            gy = max(0, min(h_cells - 1, int(b.center.y // cell_size)))
            blocked[gy * w_cells + gx] = True
        clearance_m = [cell_size * 2.0] * N
        return GridCacheBMHA(cell=cell_size, w=w_cells, h=h_cells,
                             blocked=blocked, clearance_m=clearance_m)

    def idx(self, g: Coord) -> int:
        return g[1] * self.w + g[0]

    def is_blocked(self, g: Coord) -> bool:
        x, y = g
        return x < 0 or y < 0 or x >= self.w or y >= self.h or self.blocked[self.idx(g)]

    def to_world(self, g: Coord, z: float) -> Vec3:
        return Vec3(x=(g[0] + 0.5) * self.cell, y=(g[1] + 0.5) * self.cell, z=z)

    def from_world(self, x: float, y: float) -> Coord:
        return (
            max(0, min(self.w - 1, int(x // self.cell))),
            max(0, min(self.h - 1, int(y // self.cell))),
        )


def _speed_from_clearance(clr_m: float, v_min: float, v_max: float, kappa_m: float) -> float:
    """Monotone increasing speed model: v = v_min + (v_max - v_min) * clr/(clr+kappa)."""
    if kappa_m <= 0:
        return v_max
    frac = clr_m / (clr_m + kappa_m)
    return max(v_min, min(v_max, v_min + (v_max - v_min) * frac))


class BanditMHAStar(Algorithm):
    """
    Multi-queue A* with bandit scheduling.

    Queues:
      0: anchor (admissible time heuristic: dist / v_max)
      1: hint - clearance-time (inadmissible; uses local speed estimate)
      2: hint - ALT landmark time lower bound (admissible, may be inflated)
      3: hint - bearing-biased (inadmissible)
    """

    name = "bandit_mha_star"

    def __init__(self):
        self._grid: Optional[GridCacheBMHA] = None
        self._last_tick: Dict[str, int] = {}
        self._last_goal: Dict[str, Tuple[float, float]] = {}

        self._replan_every = 20

        self._push_counter = 0

    def plan_paths(self, ctx: AlgoContext) -> None:
        p = ctx.params or {}
        cell = float(p.get("grid_cell_m", 20.0))
        inflate = float(p.get("clearance_m", 6.0))
        cruise_alt = float(p.get("cruise_alt_m", 60.0))

        if (self._grid is None) or (getattr(self._grid, "cell", None) != cell):
            w_cells = max(1, int(ctx.world.size[0] // max(cell, 1.0)))
            h_cells = max(1, int(ctx.world.size[1] // max(cell, 1.0)))
            if w_cells * h_cells > 300_000 or len(ctx.world.obstacles) > 5000:
                coarse = max(cell, 24.0)
                try:
                    self._grid = GridCacheBMHA.build(ctx.world, coarse, inflate)
                except Exception:
                    self._grid = GridCacheBMHA.build_fallback(ctx.world, coarse, inflate)
            else:
                self._grid = GridCacheBMHA.build(ctx.world, cell, inflate)

        tick = int(p.get("tick", 0))

        for d in ctx.drones:
            if not d.target:
                continue
            tgt = (d.target.x, d.target.y)
            need = (
                d.id not in self._last_tick
                or self._last_goal.get(d.id) != tgt
                or (tick - self._last_tick[d.id]) >= self._replan_every
                or not d.path
            )
            if not need:
                continue
            d.path = self._plan_one(ctx.world, d.pos, d.target, cruise_alt, p)
            self._last_goal[d.id] = tgt
            self._last_tick[d.id] = tick

    def _plan_one(self, world: World, start: Vec3, goal: Vec3, z: float, p: Dict) -> List[Vec3]:
        gcache = self._grid
        assert gcache is not None

        v_max = float(p.get("v_max", 20.0))
        v_min = float(p.get("v_min", 4.0))
        clr_k = float(p.get("clr_kappa_m", 8.0))

        samples = int(p.get("edge_samples", 2))

        use8 = bool(p.get("neighbors8", False))
        N4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        N8 = N4 + [(-1, -1), (1, -1), (-1, 1), (1, 1)]
        neigh = N8 if use8 else N4

        w_clear = float(p.get("w_clear", 1.15))
        w_landm = float(p.get("w_landmark", 1.0))
        w_bear = float(p.get("w_bearing", 1.1))
        gamma_bear = float(p.get("bearing_gamma", 0.2))
        ucb_c = float(p.get("ucb_c", 0.8))
        anchor_period = int(p.get("anchor_period", 6))
        max_exp = int(p.get("max_expansions", 2500))
        subopt_w = float(p.get("accept_suboptimal_w", 1.05))

        G = gcache.from_world(goal.x, goal.y)
        landmarks = [(0, 0), (gcache.w - 1, 0), (0, gcache.h - 1), (gcache.w - 1, gcache.h - 1)]
        goal_lm_d = [math.hypot(lx - G[0], ly - G[1]) * gcache.cell for (lx, ly) in landmarks]

        S = gcache.from_world(start.x, start.y)
        T = G
        if gcache.is_blocked(T):
            T = self._nearest_free(T, gcache)
        if gcache.is_blocked(S):
            S = self._nearest_free(S, gcache)
        if S == T:
            return [gcache.to_world(S, z)]

        g_cost: Dict[Coord, float] = {S: 0.0}
        parent: Dict[Coord, Coord] = {}

        open_anchor: List[Tuple[float, int, Coord]] = []
        open_clear: List[Tuple[float, int, Coord]] = []
        open_landm: List[Tuple[float, int, Coord]] = []
        open_bear: List[Tuple[float, int, Coord]] = []
        closed: Dict[Coord, bool] = {}

        self._push_counter = 0
        self._push(open_anchor, self._f_anchor(S, T, g_cost, v_max, gcache), S)
        self._push(open_clear,  self._f_clear(S, T, g_cost, v_max, v_min, clr_k, w_clear, gcache), S)
        self._push(open_landm,  self._f_landmark(S, T, g_cost, w_landm, landmarks, goal_lm_d, v_max, gcache), S)
        self._push(open_bear,   self._f_bearing(S, T, g_cost, v_max, w_bear, gamma_bear, S, T, gcache), S)

        pulls = [0, 0, 0, 0]
        reward_sum = [0.0, 0.0, 0.0, 0.0]
        total_pulls = 0

        def reward_from_node(u: Coord, prev: float) -> float:
            cur = self._h_euclid_time(u, T, v_max, gcache)
            r = max(0.0, prev - cur)
            return r, cur

        last_progress = self._h_euclid_time(S, T, v_max, gcache)
        goal_node: Optional[Coord] = None
        expansions = 0

        while expansions < max_exp:
            expansions += 1
            forced_anchor = (expansions % anchor_period == 0)

            q_idx = self._choose_queue_ucb(
                forced_anchor,
                open_anchor, open_clear, open_landm, open_bear,
                pulls, reward_sum, total_pulls, ucb_c
            )

            node = self._pop_valid(q_idx, open_anchor, open_clear, open_landm, open_bear, closed,
                                   g_cost, S, T, v_max, v_min, clr_k,
                                   w_clear, w_landm, w_bear, gamma_bear,
                                   landmarks, goal_lm_d, gcache)
            if node is None:
                break
            u = node

            if u == T:
                goal_node = u
                if q_idx == 0:
                    break
                if g_cost.get(u, float("inf")) <= subopt_w * self._h_euclid_time(S, T, v_max, gcache):
                    break

            if closed.get(u, False):
                continue
            closed[u] = True

            pulls[q_idx] += 1
            total_pulls += 1

            ux, uy = u
            for dx, dy in neigh:
                v = (ux + dx, uy + dy)
                if gcache.is_blocked(v):
                    continue
                length = gcache.cell if (dx == 0 or dy == 0) else (math.sqrt(2.0) * gcache.cell)
                if samples <= 2:
                    clr_a = gcache.clearance_m[gcache.idx(u)]
                    clr_b = gcache.clearance_m[gcache.idx(v)]
                    v_eff = min(
                        _speed_from_clearance(clr_a, v_min, v_max, clr_k),
                        _speed_from_clearance(clr_b, v_min, v_max, clr_k),
                    )
                else:
                    min_clr = float("inf")
                    ax, ay = u; bx, by = v
                    for k in range(samples):
                        t = k / (samples - 1)
                        sx = int(round(ax + t * (bx - ax)))
                        sy = int(round(ay + t * (by - ay)))
                        if sx < 0 or sy < 0 or sx >= gcache.w or sy >= gcache.h:
                            min_clr = 0.0
                            break
                        min_clr = min(min_clr, gcache.clearance_m[gcache.idx((sx, sy))])
                    v_eff = _speed_from_clearance(min_clr, v_min, v_max, clr_k)

                edge_time = length / max(1e-6, v_eff)
                cand = g_cost.get(u, float("inf")) + edge_time
                if cand + 1e-12 < g_cost.get(v, float("inf")):
                    g_cost[v] = cand
                    parent[v] = u
                    self._push(open_anchor, self._f_anchor(v, T, g_cost, v_max, gcache), v)
                    self._push(open_clear,  self._f_clear(v, T, g_cost, v_max, v_min, clr_k, w_clear, gcache), v)
                    self._push(open_landm,  self._f_landmark(v, T, g_cost, w_landm, landmarks, goal_lm_d, v_max, gcache), v)
                    self._push(open_bear,   self._f_bearing(v, T, g_cost, v_max, w_bear, gamma_bear, S, T, gcache), v)

            r, last_progress = reward_from_node(u, last_progress)
            reward_sum[q_idx] += r

        if goal_node is None:
            if T in parent or T == S:
                goal_node = T
            else:
                return [gcache.to_world(T, z)]

        cur = goal_node
        if cur not in parent and cur != S:
            return [gcache.to_world(S, z), gcache.to_world(cur, z)]
        chain: List[Coord] = []
        while cur != S:
            chain.append(cur)
            cur = parent.get(cur, S)
            if cur == S:
                chain.append(S)
                break
        chain.reverse()
        return [gcache.to_world(c, z) for c in chain]

    def _h_euclid_time(self, n: Coord, t: Coord, v_max: float, gcache: GridCacheBMHA) -> float:
        return (math.hypot(n[0] - t[0], n[1] - t[1]) * gcache.cell) / max(1e-6, v_max)

    def _h_clear_time(self, n: Coord, t: Coord, v_max: float, v_min: float, clr_k: float, gcache: GridCacheBMHA) -> float:
        clr = gcache.clearance_m[gcache.idx(n)]
        v_est = _speed_from_clearance(clr, v_min, v_max, clr_k)
        return (math.hypot(n[0] - t[0], n[1] - t[1]) * gcache.cell) / max(1e-6, v_est)

    def _h_landmark_time(self, n: Coord, t: Coord, landmarks: List[Coord], goal_lm_d: List[float], v_max: float, gcache: GridCacheBMHA) -> float:
        best = 0.0
        for idx, (lx, ly) in enumerate(landmarks):
            d_n = math.hypot(n[0] - lx, n[1] - ly) * gcache.cell
            d_t = goal_lm_d[idx]
            best = max(best, abs(d_n - d_t))
        return best / max(1e-6, v_max)

    def _bearing_alignment(self, S: Coord, T: Coord, n: Coord) -> float:
        sx, sy = S; tx, ty = T; nx, ny = n
        g1 = (tx - sx, ty - sy)
        g2 = (tx - nx, ty - ny)
        def norm(v): 
            return math.hypot(v[0], v[1]) + 1e-9
        return max(-1.0, min(1.0, (g1[0]*g2[0] + g1[1]*g2[1]) / (norm(g1) * norm(g2))))

    def _h_bearing_time(self, n: Coord, t: Coord, S: Coord, T: Coord, v_max: float, gamma: float, gcache: GridCacheBMHA) -> float:
        h = self._h_euclid_time(n, t, v_max, gcache)
        align = self._bearing_alignment(S, T, n)
        return max(0.0, h * (1.0 - gamma * align))

    def _f_anchor(self, n: Coord, t: Coord, g_cost: Dict[Coord, float], v_max: float, gcache: GridCacheBMHA) -> float:
        return g_cost.get(n, float("inf")) + self._h_euclid_time(n, t, v_max, gcache)

    def _f_clear(self, n: Coord, t: Coord, g_cost: Dict[Coord, float], v_max: float, v_min: float, clr_k: float, w: float, gcache: GridCacheBMHA) -> float:
        return g_cost.get(n, float("inf")) + w * self._h_clear_time(n, t, v_max, v_min, clr_k, gcache)

    def _f_landmark(self, n: Coord, t: Coord, g_cost: Dict[Coord, float], w: float, landmarks: List[Coord], goal_lm_d: List[float], v_max: float, gcache: GridCacheBMHA) -> float:
        return g_cost.get(n, float("inf")) + w * self._h_landmark_time(n, t, landmarks, goal_lm_d, v_max, gcache)

    def _f_bearing(self, n: Coord, t: Coord, g_cost: Dict[Coord, float], v_max: float, w: float, gamma: float, S: Coord, T: Coord, gcache: GridCacheBMHA) -> float:
        return g_cost.get(n, float("inf")) + w * self._h_bearing_time(n, t, S, T, v_max, gamma, gcache)

    def _push(self, heap: List[Tuple[float, int, Coord]], key: float, node: Coord) -> None:
        self._push_counter += 1
        heapq.heappush(heap, (key, self._push_counter, node))

    def _pop_valid(self, q_idx: int,
                   open_anchor, open_clear, open_landm, open_bear,
                   closed: Dict[Coord, bool], g_cost: Dict[Coord, float],
                   S: Coord, T: Coord, v_max: float, v_min: float, clr_k: float,
                   w_clear: float, w_landm: float, w_bear: float, gamma_bear: float,
                   landmarks: List[Coord], goal_lm_d: List[float],
                   gcache: GridCacheBMHA) -> Optional[Coord]:
        heap = [open_anchor, open_clear, open_landm, open_bear][q_idx]
        while heap:
            key, _, n = heapq.heappop(heap)
            if closed.get(n, False):
                continue
            if q_idx == 0:
                cur = self._f_anchor(n, T, g_cost, v_max, gcache)
            elif q_idx == 1:
                cur = self._f_clear(n, T, g_cost, v_max, v_min, clr_k, w_clear, gcache)
            elif q_idx == 2:
                cur = self._f_landmark(n, T, g_cost, w_landm, landmarks, goal_lm_d, v_max, gcache)
            else:
                cur = self._f_bearing(n, T, g_cost, v_max, w_bear, gamma_bear, S, T, gcache)
            if cur > key + 1e-12:
                continue
            return n
        return None

    def _choose_queue_ucb(self, force_anchor: bool,
                          open_anchor, open_clear, open_landm, open_bear,
                          pulls: List[int], reward_sum: List[float], total_pulls: int, c: float) -> int:
        if force_anchor and open_anchor:
            return 0
        avail = []
        if open_anchor: avail.append(0)
        if open_clear:  avail.append(1)
        if open_landm:  avail.append(2)
        if open_bear:   avail.append(3)
        if not avail:
            return 0
        for i in avail:
            if pulls[i] == 0:
                return i
        best_i = avail[0]
        best_score = -1e18
        for i in avail:
            avg = reward_sum[i] / max(1, pulls[i])
            score = avg + c * math.sqrt(math.log(max(1, total_pulls)) / pulls[i])
            if score > best_score:
                best_score = score
                best_i = i
        return best_i

    def _nearest_free(self, g0: Coord, grid: GridCacheBMHA) -> Coord:
        if not grid.is_blocked(g0):
            return g0
        for r in range(1, 50):
            for dx in range(-r, r + 1):
                for dy in (-r, r):
                    c = (g0[0] + dx, g0[1] + dy)
                    if not grid.is_blocked(c): return c
            for dy in range(-r + 1, r):
                for dx in (-r, r):
                    c = (g0[0] + dx, g0[1] + dy)
                    if not grid.is_blocked(c): return c
        return g0
