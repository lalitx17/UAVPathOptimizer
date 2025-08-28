import { COORDINATE_SYSTEM, OrbitView } from "@deck.gl/core";
import { PathLayer, PolygonLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import DeckGL from "@deck.gl/react";
import { useMemo } from "react";
import { useSimStore } from "../state/simStore";
import type { Building, Drone, Vec3 } from "../types";


const DRONE_MODEL_URL =
  (import.meta.env.VITE_DRONE_MODEL as string) || "/drone.glb";

function rectFootprint(b: Building) {
  const hw = b.size.x/2, hd = b.size.y/2;
  const cx = b.center.x, cy = b.center.y;
  return [
    [cx - hw, cy - hd, 0],
    [cx + hw, cy - hd, 0],
    [cx + hw, cy + hd, 0],
    [cx - hw, cy + hd, 0],
  ];
}

export default function DeckScene() {
  const drones = useSimStore(s=>s.drones);
  const world  = useSimStore(s=>s.world);

  const layers = useMemo(()=> {
    const buildings = new PolygonLayer({
      id: "buildings",
      data: world.obstacles,
      getPolygon: (b: Building)=> rectFootprint(b),
      extruded: true,
      getElevation: (b: Building)=> b.size.z,
      wireframe: true,
      stroked: true,
      getLineWidth: 1,
      widthUnits: "pixels",
      pickable: true,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

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

    const paths = new PathLayer({
      id: "paths",
      data: drones.filter(d => d.path && d.path.length > 0),
      getPath: (d: Drone)=> d.path!.map((p: Vec3)=>[p.x,p.y,p.z ?? 0] as [number, number, number]),
      widthUnits: "pixels", getWidth: 2,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });

    return [buildings, paths, drone3D];
  }, [drones, world]);

  const initialViewState = useMemo(()=>({
    target: [world.size[0]/2, world.size[1]/2, world.size[2]/2] as [number, number, number],
    rotationX: 30, rotationOrbit: 30, minZoom: 0, maxZoom: 100, zoom: 1.5
  }), [world]);

  return (
    <DeckGL
      layers={layers}
      views={new OrbitView()}
      controller={true}
      initialViewState={initialViewState}
      style={{ backgroundColor: 'white', position: 'absolute', inset: '0', zIndex: '1' }}
    />
  );
}
