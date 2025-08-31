from typing import Dict, Type

from .bandit_mha_star import BanditMHAStar
from .base import Algorithm
from .straight_line import StraightLine

_REGISTRY: Dict[str, Type[Algorithm]] = {
    StraightLine.name: StraightLine,
    BanditMHAStar.name: BanditMHAStar,
}

def available_algorithms() -> list[str]:
    return list(_REGISTRY.keys())

def build_algorithm(name: str) -> Algorithm:
    if name not in _REGISTRY:
        raise KeyError(f"Unknown algorithm '{name}'")
    return _REGISTRY[name]() 
