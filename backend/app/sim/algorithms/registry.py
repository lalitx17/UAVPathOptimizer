from typing import Dict, Type

from .a_star_grid import AStarGrid
from .base import Algorithm
from .straight_line import StraightLine

_REGISTRY: Dict[str, Type[Algorithm]] = {
    StraightLine.name: StraightLine,
    AStarGrid.name: AStarGrid,
}

def available_algorithms() -> list[str]:
    return list(_REGISTRY.keys())

def build_algorithm(name: str) -> Algorithm:
    if name not in _REGISTRY:
        raise KeyError(f"Unknown algorithm '{name}'")
    return _REGISTRY[name]()  # type: ignore
