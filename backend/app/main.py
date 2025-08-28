# app/main.py
import asyncio
import contextlib
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .models import ClientMsg, Drone, ErrorMsg, MetaMsg, StateMsg, World
from .sim.engine import SimulationEngine
from .sim.osm_world import (world_from_osm_bbox_fast_centers,
                            world_synthetic_city)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------- Request body (one route; two modes) ----------
class BBoxBody(BaseModel):
    # choose which world builder to use
    mode: Literal["osm", "synthetic"] = "osm"

    # OSM mode params
    north: Optional[float] = None
    south: Optional[float] = None
    east: Optional[float] = None
    west: Optional[float] = None
    target_buildings: Optional[int] = None
    limit: int = 500
    oversample: float = 1.0
    default_height_m: float = 15.0
    floor_height_m: float = 3.0
    width_minmax_m: tuple[float, float] = Field((12.0, 36.0), alias="width_range_m")
    depth_minmax_m: tuple[float, float] = Field((12.0, 36.0), alias="depth_range_m")
    max_bbox_deg2: float = 0.02
    timeout_s: int = 25
    backfill: bool = True
    fit_to_buildings: bool = True
    ceiling_margin_m: float = 5.0

    # Synthetic mode params
    city_w: float = 6000.0
    city_h: float = 4000.0
    street_w: float = 18.0
    avenue_w: float = 28.0
    block_w: float = 140.0
    block_h: float = 110.0
    setback_m: float = 6.0
    min_bldg_w: float = 12.0
    min_bldg_d: float = 12.0
    spacing_m: float = 6.0
    buildings_per_block_min: int = 2
    buildings_per_block_max: int = 6
    park_prob: float = 0.08
    plaza_prob: float = 0.04
    base_h: float = 12.0
    floor_h: float = 3.2
    max_levels_cbd: int = 25
    min_levels_out: int = 3
    cbd_center_frac_x: float = 0.5
    cbd_center_frac_y: float = 0.5
    cbd_falloff: float = 0.35
    seed: Optional[int] = None

@app.post("/world_from_osm")
def make_world(body: BBoxBody):
    try:
        if body.mode == "synthetic":
            w = world_synthetic_city(
                city_w=body.city_w, city_h=body.city_h,
                street_w=body.street_w, avenue_w=body.avenue_w,
                block_w=body.block_w, block_h=body.block_h,
                setback_m=body.setback_m, spacing_m=body.spacing_m,
                buildings_per_block=(body.buildings_per_block_min, body.buildings_per_block_max),
                min_bldg_w=body.min_bldg_w, min_bldg_d=body.min_bldg_d,
                park_prob=body.park_prob, plaza_prob=body.plaza_prob,
                base_h=body.base_h, floor_h=body.floor_h,
                max_levels_cbd=body.max_levels_cbd, min_levels_out=body.min_levels_out,
                cbd_center_frac=(body.cbd_center_frac_x, body.cbd_center_frac_y),
                cbd_falloff=body.cbd_falloff,
                seed=body.seed,
            )
        else:
            # Validate bbox presence for OSM mode
            if None in (body.north, body.south, body.east, body.west):
                raise HTTPException(status_code=400, detail="OSM mode requires north/south/east/west.")
            w = world_from_osm_bbox_fast_centers(
                (float(body.north), float(body.south), float(body.east), float(body.west)),
                target_buildings=body.target_buildings,
                limit=body.limit,
                oversample=body.oversample,
                default_height_m=body.default_height_m,
                floor_height_m=body.floor_height_m,
                width_range_m=body.width_minmax_m,
                depth_range_m=body.depth_minmax_m,
                jitter_frac=0.35,
                backfill=body.backfill,
                fit_to_buildings=body.fit_to_buildings,
                ceiling_margin_m=body.ceiling_margin_m,
                max_bbox_deg2=body.max_bbox_deg2,
                timeout_s=body.timeout_s,
            )

        if len(w.obstacles) == 0:
            raise HTTPException(status_code=400, detail="No buildings produced; adjust parameters.")
        return w.model_dump()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/world_from_osm failed: {e}")


# ---------- algorithms + websocket (unchanged) ----------
@app.get("/algorithms")
def get_algorithms():
    world = World()
    engine = SimulationEngine(world=world)
    return {"algorithms": engine.algorithms(), "world": world.model_dump()}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    world = World()
    engine = SimulationEngine(world=world)
    tick_task: asyncio.Task | None = None

    await ws.send_json(MetaMsg(algorithms=engine.algorithms(), world=world, worlds=[]).model_dump())

    async def send_state(tick: int, drones: list[Drone]):
        await ws.send_json(StateMsg(tick=tick, drones=drones).model_dump())

    try:
        while True:
            raw = await ws.receive_json()
            try:
                msg = ClientMsg(**raw)
            except Exception as e:
                await ws.send_json(ErrorMsg(message=f"bad message: {e}").model_dump())
                continue

            if msg.type == "set_world" and msg.world is not None:
                engine.world = msg.world
                engine.tick = 0
                await ws.send_json(MetaMsg(algorithms=engine.algorithms(), world=engine.world, worlds=[]).model_dump())

            elif msg.type == "init" and msg.world is not None:
                engine.world = msg.world

            elif msg.type == "set_algorithm" and msg.algorithm:
                try:
                    engine.set_algorithm(msg.algorithm)
                except KeyError as e:
                    await ws.send_json(ErrorMsg(message=str(e)).model_dump())

            elif msg.type == "set_params" and msg.params is not None:
                engine.set_params(msg.params)

            elif msg.type == "set_drones" and msg.drones is not None:
                engine.set_drones(msg.drones)

            elif msg.type == "tick_rate" and msg.tick_rate_hz:
                engine.tick_rate_hz = msg.tick_rate_hz

            elif msg.type == "start":
                if not tick_task or tick_task.done():
                    tick_task = asyncio.create_task(engine.run(send_state))

            elif msg.type == "pause":
                if tick_task and not tick_task.done():
                    tick_task.cancel()
                    with contextlib.suppress(Exception):
                        await tick_task
                tick_task = None

            elif msg.type == "reset":
                engine.tick = 0

    except WebSocketDisconnect:
        if tick_task and not tick_task.done():
            tick_task.cancel()
            with contextlib.suppress(Exception):
                await tick_task
