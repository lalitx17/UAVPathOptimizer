from typing import List

from ..models import Drone, Vec3, World


def step_drones(drones: List[Drone], dt: float, speed: float = 30.0) -> None:
    """Move drones toward their next waypoint if any (very simple kinematics)."""
    for d in drones:
        if not d.path:
            continue
        target = d.path[0]
        dx = target.x - d.pos.x
        dy = target.y - d.pos.y
        dz = target.z - d.pos.z
        dist = (dx*dx + dy*dy + dz*dz) ** 0.5
        if dist < 1e-3:
            # reached this waypoint
            d.pos = target
            d.path.pop(0)
            continue
        # move toward waypoint
        ux, uy, uz = dx/dist, dy/dist, dz/dist
        step = min(speed * dt, dist)
        d.pos = Vec3(x=d.pos.x + ux*step, y=d.pos.y + uy*step, z=d.pos.z + uz*step)
