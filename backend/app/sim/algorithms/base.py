from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from ...models import Drone, World


@dataclass
class AlgoContext:
    world: World
    drones: List[Drone]
    params: Dict[str, Any]

class Algorithm:
    name: str = "base"
    def plan_paths(self, ctx: AlgoContext) -> None:
        raise NotImplementedError
