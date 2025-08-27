import { COORDINATE_SYSTEM, OrbitView } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { useMemo } from "react";
import { useSimStore } from "../state/simStore";
import type { Drone, Vec3 } from "../types";

export default function DeckScene() {
  const drones = useSimStore((s)=>s.drones);
  const worldSize = useSimStore((s)=>s.worldSize);

  const layers = useMemo(()=> {
    const scatter = new ScatterplotLayer({
      id: "drones",
      data: drones,
      getPosition: (d: Drone)=> [d.pos.x, d.pos.y, d.pos.z ?? 0],
      getRadius: 6,
      radiusUnits: "pixels",
      pickable: true,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });
    const paths = new PathLayer({
      id: "paths",
      data: drones.filter(d => d.path && d.path.length > 0),
      getPath: (d: Drone)=> d.path!.map((p: Vec3)=>[p.x,p.y,p.z ?? 0]) as [number, number, number][],
      widthUnits: "pixels",
      getWidth: 2,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
    return [paths, scatter];
  }, [drones]);

  const initialViewState = useMemo(()=>({
    target: [worldSize[0]/2, worldSize[1]/2, worldSize[2]/2] as [number, number, number],
    rotationX: 30,
    rotationOrbit: 30,
    minZoom: 0,
    maxZoom: 100,
    zoom: 1.5
  }), [worldSize]);

  return (
    <DeckGL
      layers={layers}
      views={new OrbitView()}
      controller={true}
      initialViewState={initialViewState}
      style={{ background: 'white' }}
    />
  );
}
