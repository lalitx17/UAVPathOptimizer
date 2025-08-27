from ...models import Vec3
from .base import AlgoContext, Algorithm


class StraightLine(Algorithm):
    name = "straight_line"
    def plan_paths(self, ctx: AlgoContext) -> None:
        # naive: if a drone has a target, ensure a single segment path to it
        speed = float(ctx.params.get("speed", 30.0))
        for d in ctx.drones:
            if d.target:
                # set a simple 1-segment path
                d.path = [d.target]  # engine will step toward the next waypoint
            # attach per-drone param if desired via d.vel.z etc.
