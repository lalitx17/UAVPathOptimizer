import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, List

from ..models import Drone, World
from .algorithms.base import AlgoContext, Algorithm
from .algorithms.registry import available_algorithms, build_algorithm
from .world import step_drones


@dataclass
class SimulationEngine:
    world: World
    drones: List[Drone] = field(default_factory=list)
    algorithm: Algorithm = field(default_factory=lambda: build_algorithm("straight_line"))
    params: Dict[str, Any] = field(default_factory=dict)
    tick: int = 0
    tick_rate_hz: int = 20

    def set_algorithm(self, name: str):
        self.algorithm = build_algorithm(name)

    def set_params(self, params: Dict[str, Any]):
        self.params.update(params or {})

    def set_drones(self, drones: List[Drone]):
        self.drones = drones

    async def run(self, send_state):
        try:
            while True:
                dt = 1.0 / max(1, self.tick_rate_hz)
                self.params["tick"] = self.tick
                ctx = AlgoContext(world=self.world, drones=self.drones, params=self.params)
                self.algorithm.plan_paths(ctx)

                speed = float(self.params.get("speed", 30.0))
                step_drones(self.drones, dt, speed=speed)

                self.tick += 1
                await send_state(self.tick, self.drones)
                await asyncio.sleep(dt)
        except asyncio.CancelledError:
            pass

    @staticmethod
    def algorithms():
        return available_algorithms()
