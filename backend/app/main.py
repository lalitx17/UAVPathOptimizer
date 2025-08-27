import asyncio
import contextlib
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .models import ClientMsg, Drone, ErrorMsg, MetaMsg, StateMsg, World
from .sim.engine import SimulationEngine

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/algorithms")
def get_algorithms():
    # for simple HTTP fetch in UI
    world = World()
    engine = SimulationEngine(world=world)
    return {"algorithms": engine.algorithms(), "world": world.model_dump()}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()

    world = World()
    engine = SimulationEngine(world=world)
    tick_task: asyncio.Task | None = None

    # send initial meta
    await ws.send_json(MetaMsg(algorithms=engine.algorithms(), world=world).model_dump())

    async def send_state(tick: int, drones: List[Drone]):
        await ws.send_json(StateMsg(tick=tick, drones=drones).model_dump())

    try:
        while True:
            raw = await ws.receive_json()
            try:
                msg = ClientMsg(**raw)
            except Exception as e:
                await ws.send_json(ErrorMsg(message=f"bad message: {e}").model_dump())
                continue

            if msg.type == "init" and msg.world:
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
                if tick_task and not tick_task.done():
                    # already running
                    continue
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
        # clean up task if running
        if tick_task and not tick_task.done():
            tick_task.cancel()
            with contextlib.suppress(Exception):
                await tick_task
