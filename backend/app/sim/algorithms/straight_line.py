from ...models import Vec3
from .base import AlgoContext, Algorithm


class StraightLine(Algorithm):
    name = "straight_line"
    def plan_paths(self, ctx: AlgoContext) -> None:
        speed = float(ctx.params.get("speed", 30.0))
        for d in ctx.drones:
            if d.target:
                d.path = [d.target] 
