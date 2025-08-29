from __future__ import annotations

import math
import random
import uuid
from typing import Dict, List, Tuple

import requests
from pyproj import Transformer

from ..models import Building, Vec3, World

BBox = Tuple[float, float, float, float]


def _levels_to_height_from_tags(tags: dict, default_h: float, floor_h: float) -> float:
    lv = tags.get("building:levels") or tags.get("levels")
    if lv is None:
        return default_h
    try:
        num_levels = float(lv)
        return max(6.0, num_levels * floor_h)
    except (ValueError, TypeError):
        return default_h


def _grid_thin_uniform(
    pts: List[Tuple[float, float, Dict]],
    world_w: float,
    world_h: float,
    target: int,
    jitter_frac: float = 0.35,
) -> List[Tuple[float, float, Dict]]:
    """Spread points over the world by keeping at most one per grid cell."""
    if not pts or target <= 0 or world_w <= 0 or world_h <= 0:
        return []
    area = max(1e-6, world_w * world_h)
    cell = math.sqrt(area / max(1, target))
    random.shuffle(pts)
    seen = set()
    kept: List[Tuple[float, float, Dict]] = []
    for x, y, tags in pts:
        gx = int(x // cell); gy = int(y // cell)
        key = (gx, gy)
        if key in seen:
            continue
        seen.add(key)
        # jitter within the cell
        jx = (random.random() - 0.5) * jitter_frac * cell
        jy = (random.random() - 0.5) * jitter_frac * cell
        cx = min(max(0.0, (gx + 0.5) * cell + jx), world_w)
        cy = min(max(0.0, (gy + 0.5) * cell + jy), world_h)
        kept.append((cx, cy, tags))
        if len(kept) >= target:
            break
    return kept



def world_from_osm_bbox_fast_centers(
    bbox: BBox,
    *,
    target_buildings: int | None = None,  
    limit: int = 500,                     
    oversample: float = 1.0,             
    max_bbox_deg2: float = 0.02,         
    timeout_s: int = 25,
    default_height_m: float = 15.0,
    floor_height_m: float = 3.0,
    width_range_m: Tuple[float, float] = (12.0, 36.0),
    depth_range_m: Tuple[float, float] = (12.0, 36.0),
    jitter_frac: float = 0.35,
    backfill: bool = True,
    fit_to_buildings: bool = True,
    ceiling_margin_m: float = 5.0,
    # infra
    overpass_url: str = "https://overpass-api.de/api/interpreter",
    proj_epsg: int = 3857,
) -> World:
    north, south, east, west = bbox
    if (north - south) * (east - west) > max_bbox_deg2:
        raise ValueError("Bounding box too large for fast mode. Shrink the bbox or raise max_bbox_deg2.")

    req_limit = int(limit * max(1.0, oversample))
    req_limit = max(50, min(req_limit, 2000))

    query = f"""
    [out:json][timeout:{int(timeout_s)}];
    way["building"]({south},{west},{north},{east});
    out center qt {req_limit};
    """
    resp = requests.post(overpass_url, data={"data": query}, timeout=timeout_s + 5)
    resp.raise_for_status()
    data = resp.json()

    elements = data.get("elements", [])
    if not elements:
        return World(size=(100.0, 100.0, 50.0), obstacles=[])

    # project bbox & points to meters; origin at (west, south)
    to_m = Transformer.from_crs("EPSG:4326", f"EPSG:{proj_epsg}", always_xy=True)
    minx_m, miny_m = to_m.transform(west, south)
    maxx_m, maxy_m = to_m.transform(east, north)
    world_w = float(maxx_m - minx_m)
    world_h = float(maxy_m - miny_m)

    pts: List[Tuple[float, float, Dict]] = []
    for el in elements:
        center = el.get("center")
        if not center:
            continue
        lon = float(center["lon"]); lat = float(center["lat"])
        x_m, y_m = to_m.transform(lon, lat)
        pts.append((float(x_m - minx_m), float(y_m - miny_m), el.get("tags", {})))

    if target_buildings is None:
        target_buildings = min(len(pts), req_limit)

    uniform_pts = _grid_thin_uniform(pts, world_w, world_h, max(1, target_buildings), jitter_frac)

    if backfill and len(uniform_pts) < target_buildings:
        deficit = target_buildings - len(uniform_pts)
        for _ in range(deficit):
            uniform_pts.append((random.random() * world_w, random.random() * world_h, {}))

    obstacles: List[Building] = []
    max_z = 0.0
    for cx, cy, tags in uniform_pts:
        h = _levels_to_height_from_tags(tags, default_height_m, floor_height_m)
        w = random.uniform(*width_range_m)
        d = random.uniform(*depth_range_m)
        obstacles.append(Building(id=str(uuid.uuid4()), center=Vec3(x=cx, y=cy, z=h/2.0), size=Vec3(x=w, y=d, z=h)))
        max_z = max(max_z, h)

    if fit_to_buildings and obstacles:
        min_x = min(o.center.x - o.size.x * 0.5 for o in obstacles)
        max_x = max(o.center.x + o.size.x * 0.5 for o in obstacles)
        min_y = min(o.center.y - o.size.y * 0.5 for o in obstacles)
        max_y = max(o.center.y + o.size.y * 0.5 for o in obstacles)
        max_h = max(o.size.z for o in obstacles)
        sx, sy = min_x, min_y
        for o in obstacles:
            o.center = Vec3(x=o.center.x - sx, y=o.center.y - sy, z=o.center.z)
        world_w = max(0.1, max_x - min_x)
        world_h = max(0.1, max_y - min_y)
        ceiling = max_h + max(0.0, ceiling_margin_m)
    else:
        ceiling = max_z + max(0.0, ceiling_margin_m) + 25.0

    return World(size=(world_w, world_h, ceiling), obstacles=obstacles)



def world_synthetic_city(
    *,
    city_w: float = 6000.0,
    city_h: float = 4000.0,
    # grid (meters)
    street_w: float = 18.0,     
    avenue_w: float = 28.0,     
    block_w: float = 140.0,
    block_h: float = 110.0,
    # per-block
    setback_m: float = 6.0,
    min_bldg_w: float = 12.0,
    min_bldg_d: float = 12.0,
    spacing_m: float = 6.0,
    buildings_per_block: Tuple[int, int] = (2, 6),
    # land use
    park_prob: float = 0.08,
    plaza_prob: float = 0.04,
    # height model
    base_h: float = 15.0,
    floor_h: float = 3.5,
    max_levels_cbd: int = 40,
    min_levels_out: int = 2,
    cbd_center_frac: Tuple[float, float] = (0.5, 0.5),
    cbd_falloff: float = 0.35,
    # random
    seed: int | None = None,
) -> World:
    if seed is not None:
        random.seed(seed)

    def tiling(total: float, block: float, road: float) -> Tuple[int, float]:
        pair = road + block
        if pair <= 0:
            return 0, total
        n_blocks = int((total - road) // pair)
        used = road + n_blocks * pair
        return max(0, n_blocks), max(0.0, total - used)

    nx, margin_x = tiling(city_w, block_w, avenue_w)
    ny, margin_y = tiling(city_h, block_h, street_w)
    if nx <= 0 or ny <= 0:
        return World(size=(max(100.0, city_w), max(100.0, city_h), 60.0), obstacles=[])

    origin_x = margin_x * 0.5
    origin_y = margin_y * 0.5

    obstacles: List[Building] = []
    max_z = 0.0

    cbd_cx = city_w * cbd_center_frac[0]
    cbd_cy = city_h * cbd_center_frac[1]
    cbd_scale = math.hypot(city_w, city_h)

    def height_for_block(cx: float, cy: float) -> float:
        d = math.hypot(cx - cbd_cx, cy - cbd_cy) / max(1e-6, cbd_scale)
        w = max(0.0, 1.0 - d / max(1e-6, cbd_falloff))
        levels = int(min(max_levels_cbd, max(min_levels_out, round(min_levels_out + w * (max_levels_cbd - min_levels_out)))))
        return base_h + levels * floor_h

    for ix in range(nx):
        ax0 = origin_x + ix * (avenue_w + block_w) + avenue_w
        ax1 = ax0 + block_w
        for iy in range(ny):
            sy0 = origin_y + iy * (street_w + block_h) + street_w
            sy1 = sy0 + block_h

            r = random.random()
            if r < park_prob:
                continue  

            inner_x0 = ax0 + setback_m
            inner_y0 = sy0 + setback_m
            inner_x1 = ax1 - setback_m
            inner_y1 = sy1 - setback_m
            if inner_x1 - inner_x0 < min_bldg_w or inner_y1 - inner_y0 < min_bldg_d:
                continue

            n_b = random.randint(1, 2) if r < park_prob + plaza_prob else random.randint(*buildings_per_block)

            avg_w = max(min_bldg_w, (inner_x1 - inner_x0) / max(2, math.sqrt(n_b)) - spacing_m)
            avg_d = max(min_bldg_d, (inner_y1 - inner_y0) / max(2, math.sqrt(n_b)) - spacing_m)

            attempts, placed = 0, 0
            taken: List[Tuple[float, float, float, float]] = []
            while placed < n_b and attempts < n_b * 20:
                attempts += 1
                w = random.uniform(0.8 * avg_w, 1.4 * avg_w)
                d = random.uniform(0.8 * avg_d, 1.4 * avg_d)
                if w < min_bldg_w or d < min_bldg_d:
                    continue
                x0 = random.uniform(inner_x0, max(inner_x0, inner_x1 - w))
                y0 = random.uniform(inner_y0, max(inner_y0, inner_y1 - d))
                x1 = x0 + w; y1 = y0 + d

                ok = True
                for (tx0, ty0, tx1, ty1) in taken:
                    if not (x1 + spacing_m <= tx0 or x0 >= tx1 + spacing_m or y1 + spacing_m <= ty0 or y0 >= ty1 + spacing_m):
                        ok = False; break
                if not ok:
                    continue

                taken.append((x0, y0, x1, y1)); placed += 1
                cx = (x0 + x1) * 0.5; cy = (y0 + y1) * 0.5
                bw = (x1 - x0); bd = (y1 - y0)
                h = height_for_block(cx, cy)
                
                # Calculate distance from edges (normalized 0-1)
                edge_dist_x = min(cx / city_w, (city_w - cx) / city_w)
                edge_dist_y = min(cy / city_h, (city_h - cy) / city_h)
                edge_dist = min(edge_dist_x, edge_dist_y)
                
                # Higher chance of super-tall buildings near edges (up to 15% at edges, 0% at center)
                edge_supertall_prob = 0.15 * (1.0 - min(1.0, edge_dist * 4))
                is_supertall = random.random() < edge_supertall_prob
                
                if is_supertall:
                    # Create dramatically taller buildings (2-4x normal height)
                    h *= random.uniform(2.0, 4.0)
                else:
                    # Normal buildings get more height variation
                    h *= random.uniform(0.4, 0.7) if r < park_prob + plaza_prob else random.uniform(0.6, 1.8)

                obstacles.append(Building(id=str(uuid.uuid4()),
                                          center=Vec3(x=cx, y=cy, z=h * 0.5),
                                          size=Vec3(x=bw, y=bd, z=h)))
                max_z = max(max_z, h)

    ceiling = max(60.0, max_z + 10.0)
    return World(size=(city_w, city_h, ceiling), obstacles=obstacles)
