import { COORDINATE_SYSTEM, OrbitView } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import DeckGL from "@deck.gl/react";
import { useMemo } from "react";
import { useSimStore } from "../state/simStore";
import type { Drone, Vec3 } from "../types";

const DRONE_MODEL_URL =
  (import.meta.env.VITE_DRONE_MODEL as string) || "/drone.glb";

export default function DeckScene() {
  const drones = useSimStore((s) => s.drones);
  const worldSize = useSimStore((s) => s.worldSize);

  const layers = useMemo(() => {
    const drone3D = new ScenegraphLayer<Drone>({
      id: "drone-3d",
      data: drones,
      scenegraph: DRONE_MODEL_URL,
      getPosition: (d) => [d.pos.x, d.pos.y, d.pos.z ?? 0],
      getOrientation: (d) => {
        const yawDeg =
          (Math.atan2(d.vel?.y ?? 0, d.vel?.x ?? 1e-6) * 180) / Math.PI;
        return [0, 0, yawDeg + 90];
      },
      sizeScale: 15,
      pickable: true,
      _lighting: "pbr",
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      loadOptions: { gltf: { decompressMeshes: true } },
    });


    const paths = new PathLayer<Drone>({
      id: "paths",
      data: drones.filter((d) => d.path && d.path.length > 0),
      getPath: (d) =>
        (d.path ?? []).map((p: Vec3) => [p.x, p.y, p.z ?? 0]) as [
          number,
          number,
          number
        ][],
      widthUnits: "pixels",
      getWidth: 2,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    return [paths, drone3D];
  }, [drones]);

  const initialViewState = useMemo(
    () => ({
      target: [
        worldSize[0] / 2,
        worldSize[1] / 2,
        worldSize[2] / 2,
      ] as [number, number, number],
      rotationX: 30,
      rotationOrbit: 30,
      minZoom: 0,
      maxZoom: 100,
      zoom: 1.5,
    }),
    [worldSize]
  );

  return (
    <DeckGL
      layers={layers}
      views={new OrbitView()}
      controller
      initialViewState={initialViewState}
      style={{ background: "white", width: "100vw", height: "100vh" }}
    />
  );
}
