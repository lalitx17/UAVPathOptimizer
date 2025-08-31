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


class BBoxBody(BaseModel):
    mode: Literal["osm", "synthetic"] = "osm"

    # OSM mode params
    north: Optional[float] = None
    south: Optional[float] = None
    east: Optional[float] = None
    west: Optional[float] = None
    target_buildings: Optional[int] = None

    city_w: float = 6000.0
    city_h: float = 4000.0
    seed: Optional[int] = None

@app.post("/world_from_osm")
def make_world(body: BBoxBody):
    try:
        if body.mode == "synthetic":
            w = world_synthetic_city(
                city_w=body.city_w,
                city_h=body.city_h,
                seed=body.seed,
            )
        else:
            if None in (body.north, body.south, body.east, body.west):
                raise HTTPException(status_code=400, detail="OSM mode requires north/south/east/west.")
            north = float(body.north) if body.north is not None else 0.0
            south = float(body.south) if body.south is not None else 0.0
            east = float(body.east) if body.east is not None else 0.0
            west = float(body.west) if body.west is not None else 0.0
            w = world_from_osm_bbox_fast_centers(
                (north, south, east, west),
                target_buildings=body.target_buildings
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
                    print(f"Setting algorithm to: {msg.algorithm}")
                    engine.set_algorithm(msg.algorithm)
                    print(f"Algorithm set successfully. Available algorithms: {engine.algorithms()}")
                except KeyError as e:
                    print(f"Error setting algorithm: {e}")
                    await ws.send_json(ErrorMsg(message=str(e)).model_dump())

            elif msg.type == "set_params" and msg.params is not None:
                engine.set_params(msg.params)

            elif msg.type == "set_drones" and msg.drones is not None:
                print(f"Setting {len(msg.drones)} drones")
                engine.set_drones(msg.drones)
                print(f"Current algorithm: {type(engine.algorithm).__name__}")
                print(f"Current drones: {len(engine.drones)}")

            elif msg.type == "tick_rate" and msg.tick_rate_hz:
                engine.tick_rate_hz = msg.tick_rate_hz

            elif msg.type == "start":
                print(f"Starting simulation with {len(engine.drones)} drones and algorithm: {type(engine.algorithm).__name__}")
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
                engine.drones = []
                engine.params = {}
                if tick_task and not tick_task.done():
                    tick_task.cancel()
                    with contextlib.suppress(Exception):
                        await tick_task
                tick_task = None
                await ws.send_json(MetaMsg(algorithms=engine.algorithms(), world=engine.world, worlds=[]).model_dump())

    except WebSocketDisconnect:
        if tick_task and not tick_task.done():
            tick_task.cancel()
            with contextlib.suppress(Exception):
                await tick_task
