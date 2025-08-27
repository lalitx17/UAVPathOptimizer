# app/main.py
import asyncio
import contextlib

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import ClientMsg, Drone, ErrorMsg, MetaMsg, StateMsg, World
from .sim.engine import SimulationEngine
from .sim.osm_world import world_from_osm_bbox_fast_centers

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "*",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BBoxBody(BaseModel):
    north: float
    south: float
    east: float
    west: float
    # fast centers params
    default_height_m: float = 15.0
    floor_height_m: float = 3.0
    limit: int = 300  # cap number of synthesized buildings

@app.post("/world_from_osm")
def make_world_from_osm(body: BBoxBody):
    """
    FAST loader: query Overpass for building centers only, synthesize AABB blocks.
    Keep bbox small (~<= 1km x 1km) and lower 'limit' for speed.
    """
    try:
        w = world_from_osm_bbox_fast_centers(
            (body.north, body.south, body.east, body.west),
            default_height_m=body.default_height_m,
            floor_height_m=body.floor_height_m,
            limit=body.limit,
        )
        if len(w.obstacles) == 0:
            raise HTTPException(
                status_code=400,
                detail="No buildings found; try a denser area or expand slightly."
            )
        return w.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/world_from_osm failed: {e}")

# ---------- HTTP: algorithms ----------
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

    await ws.send_json(
        MetaMsg(
            algorithms=engine.algorithms(),
            world=world,
            worlds=[]
        ).model_dump()
    )

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
                await ws.send_json(
                    MetaMsg(
                        algorithms=engine.algorithms(),
                        world=engine.world,
                        worlds=[]
                    ).model_dump()
                )

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
