// src/components/DeckScene.tsx
import { AmbientLight, COORDINATE_SYSTEM, DirectionalLight, LightingEffect, OrbitView } from "@deck.gl/core";
import { PathLayer, PolygonLayer, SolidPolygonLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import DeckGL from "@deck.gl/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSimStore } from "../state/simStore";
import type { Building, Drone, Vec3 } from "../types";

const DRONE_MODEL_URL = (import.meta.env.VITE_DRONE_MODEL as string) || "/drone.glb";

// ---------------------- helpers ----------------------
function rectFootprint(b: Building) {
  const hw = b.size.x / 2,
    hd = b.size.y / 2;
  const cx = b.center.x,
    cy = b.center.y;
  return [
    [cx - hw, cy - hd, 0],
    [cx + hw, cy - hd, 0],
    [cx + hw, cy + hd, 0],
    [cx - hw, cy + hd, 0],
  ];
}

// color ramp based on height (meters)
function buildingColor(h: number): [number, number, number, number] {
  // clamp 8..120m to 0..1
  const t = Math.max(0, Math.min(1, (h - 8) / 120));
  // simple two-stage gradient: slate -> teal -> warm gold
  const c1: [number, number, number] = [160, 169, 178]; // low
  const c2: [number, number, number] = [62, 157, 158]; // mid
  const c3: [number, number, number] = [218, 170, 81]; // tall

  let r: number, g: number, b: number;
  if (t < 0.55) {
    const u = t / 0.55;
    r = c1[0] + (c2[0] - c1[0]) * u;
    g = c1[1] + (c2[1] - c1[1]) * u;
    b = c1[2] + (c2[2] - c1[2]) * u;
  } else {
    const u = (t - 0.55) / 0.45;
    r = c2[0] + (c3[0] - c2[0]) * u;
    g = c2[1] + (c3[1] - c2[1]) * u;
    b = c2[2] + (c3[2] - c2[2]) * u;
  }
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

// keep camera within [0..W]x[0..H]
function clampViewState(vs: any, W: number, H: number, margin = 10) {
  const { zoom = 1, target = [W / 2, H / 2, 0] } = vs;
  const scale = Math.pow(2, zoom);
  const halfWidthWU = window.innerWidth / (2 * scale);
  const halfHeightWU = window.innerHeight / (2 * scale);

  if (W <= 2 * (halfWidthWU + margin) || H <= 2 * (halfHeightWU + margin)) {
    return { ...vs, target: [W / 2, H / 2, 0] };
  }
  const minX = margin + halfWidthWU;
  const maxX = W - margin - halfWidthWU;
  const minY = margin + halfHeightWU;
  const maxY = H - margin - halfHeightWU;

  const x = Math.min(maxX, Math.max(minX, target[0]));
  const y = Math.min(maxY, Math.max(minY, target[1]));
  return { ...vs, target: [x, y, target[2] ?? 0] };
}

// ---------------------- component ----------------------
export default function DeckScene() {
  const drones = useSimStore((s) => s.drones);
  const world = useSimStore((s) => s.world);
  const [W, H, Z] = world.size ?? [100, 100, 50];

  // --- lighting for depth/shine
  const effects = useMemo(() => {
    const ambient = new AmbientLight({
      color: [255, 255, 255],
      intensity: 0.5,
    });
    const dir = new DirectionalLight({
      color: [255, 255, 255],
      intensity: 1.2,
      direction: [-1, -1, -2], // from NE, elevated
    });
    return new LightingEffect({ ambient, dir });
  }, []);

  // --- materials for buildings
  const buildingMaterial = useMemo(
    () => ({
      ambient: 0.35,
      diffuse: 0.6,
      shininess: 18,
      specularColor: [80, 80, 80],
    }),
    []
  );

  // --- layers
  const layers = useMemo(() => {
    // beautiful, subtle ground the size of the world
   // vivid ground
const ground = new SolidPolygonLayer({
    id: "ground",
    data: [
      {
        poly: [
          [0, 0],
          [W, 0],
          [W, H],
          [0, H],
        ],
      },
    ],
    getPolygon: (d: any) => d.poly,
    // vivid grass-like green (try also [60, 130, 200] for vivid blue)
    getFillColor: [60, 180, 120, 255],
    pickable: false,
    extruded: false,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  });
  

    // subtle world border
    const border = new PathLayer({
      id: "world-border",
      data: [
        {
          path: [
            [0, 0, 0],
            [W, 0, 0],
            [W, H, 0],
            [0, H, 0],
            [0, 0, 0],
          ],
        },
      ],
      getPath: (d: any) => d.path,
      getWidth: 2,
      widthUnits: "pixels",
      getColor: [180, 180, 190, 180],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    // buildings with a pleasant palette by height
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
      widthUnits: "pixels",
      getLineColor: [60, 70, 80, 140],
      getFillColor: (b) => buildingColor(b.size.z),
      pickable: true,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    // drone model (unchanged, just looks better over the floor)
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
      parameters: { depthTest: true },
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      loadOptions: { gltf: { decompressMeshes: true } },
    });

    // paths
    const paths = new PathLayer<Drone>({
      id: "paths",
      data: drones.filter((d) => d.path && d.path.length > 0),
      getPath: (d) => d.path!.map((p: Vec3) => [p.x, p.y, p.z ?? 0] as [number, number, number]),
      widthUnits: "pixels",
      getWidth: 2,
      getColor: [20, 120, 230, 200],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    });

    return [ground, border, buildings, paths, drone3D];
  }, [drones, world.obstacles, W, H, buildingMaterial]);

  // --- view state with clamping
  const [viewState, setViewState] = useState({
    target: [W / 2, H / 2, 0] as [number, number, number],
    rotationX: 35,
    rotationOrbit: 30,
    zoom: 1.5,
  });

  // recenter on world change
  useEffect(() => {
    setViewState((vs) => ({ ...vs, target: [W / 2, H / 2, 0] as [number, number, number] }));
  }, [W, H]);

  const onViewStateChange = useCallback(
    ({ viewState: next }: any) => {
      setViewState(clampViewState(next, W, H));
    },
    [W, H]
  );

  return (
    <DeckGL
      layers={layers}
      effects={[effects]}
      views={new OrbitView()}
      controller={{ inertia: true }}
      viewState={viewState}
      onViewStateChange={onViewStateChange}
      style={{ background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 40%)", position: "absolute", inset: "0", zIndex: 1 }}
    />
  );
}
