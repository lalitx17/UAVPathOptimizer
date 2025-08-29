import type { OrbitViewState } from "@deck.gl/core";
import { AmbientLight, COORDINATE_SYSTEM, DirectionalLight, LightingEffect, OrbitView } from "@deck.gl/core";
import { PathLayer, PolygonLayer, ScatterplotLayer, SolidPolygonLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import DeckGL from "@deck.gl/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimStore } from "../state/simStore";
import type { Building, Drone } from "../types";

const DRONE_MODEL_URL = (import.meta.env.VITE_DRONE_MODEL as string) || "/drone.glb";

interface GroundData { poly: [number, number][]; }
interface BorderData { path: [number, number, number][]; }

function rectFootprint(b: Building) {
  const hw = b.size.x / 2, hd = b.size.y / 2;
  const cx = b.center.x, cy = b.center.y;
  return [
    [cx - hw, cy - hd, 0],
    [cx + hw, cy - hd, 0],
    [cx + hw, cy + hd, 0],
    [cx - hw, cy + hd, 0],
  ];
}

function buildingColor(): [number, number, number, number] { return [64, 64, 64, 120]; }
function buildingTopColor(): [number, number, number, number] { return [255, 255, 255, 255]; }


function freeViewState(vs: OrbitViewState): OrbitViewState {
  return vs;
}

export default function DeckScene() {
  const drones = useSimStore((s) => s.drones);
  const world = useSimStore((s) => s.world);
  const [W, H] = world.size ?? [100, 100, 50];

  const TRAIL_LEN = 80;
  const TRAIL_STEP = 1;
  const frameRef = useRef(0);
  const trailsRef = useRef<Map<string, [number, number, number][]>>(new Map());
  const [trailData, setTrailData] = useState<{ id: string; path: [number, number, number][] }[]>([]);
  const [trailDots, setTrailDots] = useState<{ p: [number, number, number]; age: number }[]>([]);

  useEffect(() => {
    frameRef.current++;
    if (frameRef.current % TRAIL_STEP !== 0) return;

    const map = trailsRef.current;
    const liveIds = new Set<string>();
    for (const d of drones) {
      liveIds.add(d.id);
      const arr = map.get(d.id) ?? [];
      const p: [number, number, number] = [d.pos.x, d.pos.y, d.pos.z ?? 0];
      if (arr.length === 0) {
        arr.push(p);
      } else {
        const last = arr[arr.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.01) {
          arr.push(p);
        }
      }
      // cap length
      if (arr.length > TRAIL_LEN) arr.splice(0, arr.length - TRAIL_LEN);
      map.set(d.id, arr);
    }
    // drop trails of disappeared drones
    for (const id of Array.from(map.keys())) if (!liveIds.has(id)) map.delete(id);

    // flatten to layer data
    const lines = Array.from(map.entries()).map(([id, path]) => ({ id, path }));
    setTrailData(lines);

    // optional: dots with fading alpha (age = index from tail)
    const dots: { p: [number, number, number]; age: number }[] = [];
    for (const path of map.values()) {
      for (let i = 0; i < path.length; i += 4) { // subsample to keep it light
        dots.push({ p: path[i], age: path.length - 1 - i });
      }
    }
    setTrailDots(dots);
  }, [drones]);


  const effects = useMemo(() => {
    const ambient = new AmbientLight({ color: [255, 255, 255], intensity: 0.6 });
    const dir = new DirectionalLight({ color: [255, 255, 255], intensity: 1.0, direction: [-1, -1, -1] });
    return new LightingEffect({ ambient, dir });
  }, []);

  const buildingMaterial = useMemo(() => ({
    ambient: 0.35, diffuse: 0.6, shininess: 18, specularColor: [80, 80, 80] as [number, number, number],
  }), []);


  const layers = useMemo(() => {
    const ground = new SolidPolygonLayer({
      id: "ground",
      data: [{ poly: [[0, 0], [W, 0], [W, H], [0, H]] }],
      getPolygon: (d: GroundData) => d.poly,
      getFillColor: [128, 128, 128, 255],
      pickable: false,
      extruded: false,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    const border = new PathLayer({
      id: "world-border",
      data: [{ path: [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, 0, 0]] }],
      getPath: (d: BorderData) => d.path,
      getWidth: 2,
      widthUnits: "pixels",
      getColor: [180, 180, 190, 180],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    const buildings = new PolygonLayer<Building>({
      id: "buildings",
      data: world.obstacles,
      getPolygon: (b) => rectFootprint(b),
      extruded: true,
      getElevation: (b) => b.size.z,
      material: buildingMaterial,
      wireframe: false,
      stroked: true,
      getLineWidth: 1,
      getLineColor: [60, 70, 80, 140],
      getFillColor: () => buildingColor(),
      pickable: true,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    const buildingTops = new PolygonLayer<Building>({
      id: "building-tops",
      data: world.obstacles,
      getPolygon: (b) => {
        const hw = b.size.x / 2, hd = b.size.y / 2;
        const cx = b.center.x, cy = b.center.y, h = b.size.z;
        return [[cx - hw, cy - hd, h], [cx + hw, cy - hd, h], [cx + hw, cy + hd, h], [cx - hw, cy + hd, h]];
      },
      extruded: false,
      material: buildingMaterial,
      wireframe: false,
      stroked: false,
      getFillColor: () => buildingTopColor(),
      pickable: false,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    const flightTrails = new PathLayer({
      id: "flight-trails",
      data: trailData,
      getPath: (d: { id: string; path: [number, number, number][] }) => d.path,
      getWidth: 3,
      widthUnits: "pixels",
      getColor: (d, { index }) => {
        const i = (index ?? 0) % 6;
        const palette: [number, number, number, number][] = [
          [0, 123, 255, 180],   // blue
          [40, 167, 69, 180],   // green
          [255, 99, 132, 180],  // pink-red
          [255, 159, 64, 180],  // orange
          [153, 102, 255, 180], // purple
          [23, 162, 184, 180],  // teal
        ];
        return palette[i];
      },
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      parameters: { depthTest: true },
    });

    const trailPoints = new ScatterplotLayer({
      id: "trail-dots",
      data: trailDots,
      getPosition: (d: { p: [number, number, number]; age: number }) => d.p,
      getRadius: 2,
      radiusUnits: "pixels",
      getFillColor: (d: { age: number }) => {
        const a = Math.max(40, 220 - d.age * (220 / TRAIL_LEN));
        return [30, 30, 30, a];
      },
      pickable: false,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      parameters: { depthTest: true },
    });

    const drone3D = new ScenegraphLayer<Drone>({
      id: "drone-3d",
      data: drones,
      scenegraph: DRONE_MODEL_URL,
      getPosition: (d) => [d.pos.x, d.pos.y, d.pos.z ?? 0],
      getOrientation: (d) => {
        const yawDeg = (Math.atan2(d.vel?.y ?? 0, d.vel?.x ?? 1e-6) * 180) / Math.PI;
        return [0, 0, yawDeg + 90];
      },
      sizeScale: 15,
      pickable: true,
      _lighting: "pbr",
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      loadOptions: { gltf: { decompressMeshes: true } },
    });

    return [
      ground,
      border,
      buildings,
      buildingTops,
      flightTrails,
      trailPoints,
      drone3D,
    ];
  }, [drones, world.obstacles, W, H, buildingMaterial, trailData, trailDots]);

  const [viewState, setViewState] = useState<OrbitViewState>({
    target: [W / 2, H / 2, 0] as [number, number, number],
    rotationX: 35,
    rotationOrbit: 30,
    zoom: 1.5,
  });
  useEffect(() => { setViewState((vs) => ({ ...vs, target: [W / 2, H / 2, 0] as [number, number, number] })); }, [W, H]);
  const onViewStateChange = useCallback(({ viewState: next }: { viewState: OrbitViewState }) => {
    setViewState(freeViewState(next));
  }, []);

  return (
    <DeckGL
      layers={layers}
      effects={[effects]}
      views={new OrbitView()}
      controller={{
        inertia: true,
        scrollZoom: true,
        dragPan: true,
        dragRotate: true,
      }}
      viewState={viewState}
      onViewStateChange={onViewStateChange}
      style={{ background: "linear-gradient(180deg, #e8e8e8 0%, #f5f5f5 40%)", position: "absolute", inset: "0", zIndex: "1" }}
    />
  );
}