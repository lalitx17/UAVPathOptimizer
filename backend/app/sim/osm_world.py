from __future__ import annotations

import random
import uuid
from typing import List, Tuple

import requests
from pyproj import Transformer

from ..models import Building, Vec3, World

BBox = Tuple[float, float, float, float]

def _levels_to_height_from_tags(tags: dict, default_h: float, floor_h: float) -> float:
    lv = tags.get("building:levels") or tags.get("levels")
    try:
        return max(6.0, float(lv) * floor_h)
    except Exception:
        return default_h

def world_from_osm_bbox_fast_centers(
    bbox: BBox,
    default_height_m: float = 15.0,
    floor_height_m: float = 3.0,
    limit: int = 400,
    width_range_m: Tuple[float,float] = (12.0, 36.0),
    depth_range_m: Tuple[float,float] = (12.0, 36.0),
    overpass_url: str = "https://overpass-api.de/api/interpreter",
    proj_epsg: int = 3857,
) -> World:
    """
    FAST path: query Overpass for building *centers only*, then synthesize
    axis-aligned blocks around those centers. Much faster than fetching polygons.
    """
    north, south, east, west = bbox

    if (north - south) * (east - west) > 0.01:
        raise ValueError("Bounding box too large for fast mode. Pick ~1km x 1km or smaller.")

    query = f"""
    [out:json][timeout:25];
    way["building"]({south},{west},{north},{east});
    out center qt {limit};
    """

    resp = requests.post(overpass_url, data={"data": query})
    resp.raise_for_status()
    data = resp.json()

    elements = data.get("elements", [])
    if not elements:
        return World(size=(100.0, 100.0, 50.0), obstacles=[])

    to_m = Transformer.from_crs("EPSG:4326", f"EPSG:{proj_epsg}", always_xy=True)
    minx_m, miny_m = to_m.transform(west, south)

    obstacles: List[Building] = []
    max_z = 0.0

    for el in elements:
        center = el.get("center")
        if not center:
            continue
        lon = float(center["lon"]); lat = float(center["lat"])
        x_m, y_m = to_m.transform(lon, lat)
        cx = float(x_m - minx_m)
        cy = float(y_m - miny_m)

        tags = el.get("tags", {})
        h = _levels_to_height_from_tags(tags, default_height_m, floor_height_m)
        w = random.uniform(*width_range_m)
        d = random.uniform(*depth_range_m)

        obstacles.append(Building(
            id=str(uuid.uuid4()),
            center=Vec3(x=cx, y=cy, z=h/2.0),
            size=Vec3(x=w, y=d, z=h),
        ))
        max_z = max(max_z, h)

    maxx_m, maxy_m = to_m.transform(east, north)
    world_w = float(maxx_m - minx_m)
    world_h = float(maxy_m - miny_m)
    return World(size=(world_w, world_h, max_z + 30.0), obstacles=obstacles)
