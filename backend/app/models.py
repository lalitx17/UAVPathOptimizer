from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field


class Vec3(BaseModel):
    x: float
    y: float
    z: float = 0.0

class Drone(BaseModel):
    id: str
    pos: Vec3
    vel: Vec3 = Vec3(x=0, y=0, z=0)
    path: List[Vec3] = []         # waypoints (optional)
    target: Optional[Vec3] = None # high-level target

class World(BaseModel):
    size: Tuple[float, float, float] = (1000.0, 1000.0, 100.0)
    obstacles: List[Dict[str, Any]] = []  # extend later

# inbound messages (client -> server)
class ClientMsg(BaseModel):
    type: Literal["init","start","pause","reset","set_algorithm","set_params","set_drones","tick_rate"]
    algorithm: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    drones: Optional[List[Drone]] = None
    world: Optional[World] = None
    tick_rate_hz: Optional[int] = None

# outbound messages (server -> client)
class StateMsg(BaseModel):
    type: Literal["state"] = "state"
    tick: int
    drones: List[Drone]
    done: bool = False

class MetaMsg(BaseModel):
    type: Literal["meta"] = "meta"
    algorithms: List[str]
    world: World

class ErrorMsg(BaseModel):
    type: Literal["error"] = "error"
    message: str
