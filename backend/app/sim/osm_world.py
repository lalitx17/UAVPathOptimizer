# app/sim/osm_world.py
from __future__ import annotations

import random
import uuid
from typing import Dict, List, Tuple

import requests
from pyproj import Transformer

from ..models import Building, Vec3, World

# (north, south, east, west) in WGS84 degrees
BBox = Tuple[float, float, float, float]


def _levels_to_height_from_tags(tags: dict, default_h: float, floor_h: float) -> float:
    """Estimate height from OSM tags, falling back to defaults."""
    lv = tags.get("building:levels") or tags.get("levels")
    try:
        return max(6.0, float(lv) * floor_h)
    except Exception:
        return default_h


def _grid_thin_uniform(
    pts: List[Tuple[float, float, Dict]],  # [(x_m, y_m, tags)]
    world_w: float,
    world_h: float,
    target: int,
    jitter_frac: float = 0.35,
) -> List[Tuple[float, float, Dict]]:
    """
    Spread points across the world by keeping at most one per grid cell.
    Cell size chosen so ~target cells cover the world area.
    Jitters each kept point within its cell to avoid a visible lattice.
    """
    if not pts or target <= 0 or world_w <= 0 or world_h <= 0:
        return []

    area = max(1e-6, world_w * world_h)
    cell = (area / max(1, target)) ** 0.5  # meters

    # avoid bias: randomize incoming order
    random.shuffle(pts)

    seen = set()
    kept: List[Tuple[float, float, Dict]] = []
    for x, y, tags in pts:
        gx = int(x // cell)
        gy = int(y // cell)
        key = (gx, gy)
        if key in seen:
            continue
        seen.add(key)

        # jitter inside cell
        jx = (random.random() - 0.5) * jitter_frac * cell
        jy = (random.random() - 0.5) * jitter_frac * cell
        cx = (gx + 0.5) * cell + jx
        cy = (gy + 0.5) * cell + jy
        # clamp to world bounds
        cx = min(max(0.0, cx), world_w)
        cy = min(max(0.0, cy), world_h)

        kept.append((cx, cy, tags))
        if len(kept) >= target:
            break

    return kept


def world_from_osm_bbox_fast_centers(
    bbox: BBox,
    *,
    # Density & fetching
    target_buildings: int | None = None,  # if None → place up to min(len(pts), limit)
    limit: int = 500,                     # server-side cap for fetched centers
    oversample: float = 1.0,              # multiplier for limit (server may return fewer)
    max_bbox_deg2: float = 0.02,          # guard to keep queries fast (~<= 1–2km² depending on latitude)
    timeout_s: int = 25,                  # Overpass timeout
    # Building synthesis
    default_height_m: float = 15.0,
    floor_height_m: float = 3.0,
    width_range_m: Tuple[float, float] = (12.0, 36.0),
    depth_range_m: Tuple[float, float] = (12.0, 36.0),
    jitter_frac: float = 0.35,            # how much to jitter inside each cell (0..~0.5)
    backfill: bool = True,                # if true, sprinkle synthetic buildings in empty regions
    # World sizing
    fit_to_buildings: bool = True,        # if true, world.size tightly wraps building extents
    ceiling_margin_m: float = 5.0,        # extra headroom above tallest building
    # Infra
    overpass_url: str = "https://overpass-api.de/api/interpreter",
    proj_epsg: int = 3857,                # project to meters for world coords
) -> World:
    """
    FAST loader:
      1) Query Overpass for building CENTERS only (cheap).
      2) Project to meters and convert to local coords.
      3) Spread uniformly via grid thinning (+ jitter) to avoid clusters.
      4) (Optional) Backfill empty regions with synthetic buildings.
      5) (Optional) Fit world size tightly to building volume.

    Returns a World whose obstacles are simple axis-aligned boxes (AABBs).
    """
    north, south, east, west = bbox

    # Keep requested area reasonable for fast interaction.
    if (north - south) * (east - west) > max_bbox_deg2:
        raise ValueError("Bounding box too large for fast mode. Shrink the bbox or raise max_bbox_deg2.")

    # Compute request limit (allow modest oversample; API may return fewer)
    req_limit = int(limit * max(1.0, oversample))
    req_limit = max(50, min(req_limit, 2000))

    # 1) Fetch building centers (and tags) ------------------------------------
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
        # No buildings found – return a tiny empty world to keep pipeline happy
        return World(size=(100.0, 100.0, 50.0), obstacles=[])

    # 2) Project bbox & points to meters; origin at (west, south) -------------
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
        lon = float(center["lon"])
        lat = float(center["lat"])
        x_m, y_m = to_m.transform(lon, lat)
        pts.append((float(x_m - minx_m), float(y_m - miny_m), el.get("tags", {})))

    # Decide target number to place uniformly
    if target_buildings is None:
        target_buildings = min(len(pts), req_limit)

    # 3) Spread uniformly with grid thinning + jitter -------------------------
    uniform_pts = _grid_thin_uniform(
        pts=pts,
        world_w=world_w,
        world_h=world_h,
        target=max(1, target_buildings),
        jitter_frac=jitter_frac,
    )

    # 4) Optional backfill to reach target (uniform coverage) -----------------
    if backfill and len(uniform_pts) < target_buildings:
        deficit = target_buildings - len(uniform_pts)
        for _ in range(deficit):
            xj = random.random() * world_w
            yj = random.random() * world_h
            uniform_pts.append((xj, yj, {}))  # empty tags → default height

    # 5) Synthesize AABB blocks -----------------------------------------------
    obstacles: List[Building] = []
    max_z = 0.0
    for cx, cy, tags in uniform_pts:
        h = _levels_to_height_from_tags(tags, default_height_m, floor_height_m)
        w = random.uniform(*width_range_m)
        d = random.uniform(*depth_range_m)
        obstacles.append(
            Building(
                id=str(uuid.uuid4()),
                center=Vec3(x=cx, y=cy, z=h / 2.0),
                size=Vec3(x=w, y=d, z=h),
            )
        )
        max_z = max(max_z, h)

    # 6) World sizing ----------------------------------------------------------
    if fit_to_buildings and obstacles:
        # Tight bounds from buildings (use full box: center ± size/2)
        min_x = min(o.center.x - o.size.x * 0.5 for o in obstacles)
        max_x = max(o.center.x + o.size.x * 0.5 for o in obstacles)
        min_y = min(o.center.y - o.size.y * 0.5 for o in obstacles)
        max_y = max(o.center.y + o.size.y * 0.5 for o in obstacles)
        max_h = max(o.size.z for o in obstacles)

        # Re-base so min corner is (0,0)
        shift_x = min_x
        shift_y = min_y
        for o in obstacles:
            o.center = Vec3(x=o.center.x - shift_x, y=o.center.y - shift_y, z=o.center.z)

        world_w = max(0.1, max_x - min_x)
        world_h = max(0.1, max_y - min_y)
        ceiling = max_h + max(0.0, ceiling_margin_m)
    else:
        # Keep bbox-derived width/height; add a generous ceiling
        ceiling = max_z + max(0.0, ceiling_margin_m) + 25.0

    return World(size=(world_w, world_h, ceiling), obstacles=obstacles)
