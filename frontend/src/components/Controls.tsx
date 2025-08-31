// Controls.tsx
import * as Label from "@radix-ui/react-label";
import * as Select from "@radix-ui/react-select";
import * as Separator from "@radix-ui/react-separator";
import * as Slider from "@radix-ui/react-slider";
import { Check, ChevronDown, PanelLeftClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { send } from "../api/ws";
import { useSimStore } from "../state/simStore";
import type { World } from "../types";

const API = "http://localhost:8000";

type BBox = { north: number; south: number; east: number; west: number };
const PRESETS: Record<string, BBox> = {
  "NYC – Times Sq (tiny)": { north: 40.7589, south: 40.7579, east: -73.984, west: -73.9862 },
  "Boston – Kendall (small)": { north: 42.3673, south: 42.3647, east: -71.0875, west: -71.0915 },
  "SF – FiDi (small)": { north: 37.7926, south: 37.79, east: -122.3985, west: -122.402 },
};

type WorldMode = "synthetic" | "osm";

export default function Controls() {
  // --------- Global sim state (via store) ---------
  const algorithms = useSimStore((s) => s.algorithms);
  const selected = useSimStore((s) => s.selectedAlgorithm);
  const setSelected = useSimStore((s) => s.setSelectedAlgorithm);
  const tick = useSimStore((s) => s.tick);
  const drones = useSimStore((s) => s.drones);
  const connected = useSimStore((s) => s.connected);

  useEffect(() => {
    if (!algorithms?.length) return;
    if (selected && algorithms.includes(selected)) return;
    const preferred = algorithms.includes("bandit_mha_star")
      ? "bandit_mha_star"
      : algorithms[0];
    setSelected?.(preferred);
  }, [algorithms, selected, setSelected]);


  const [open, setOpen] = useState(true);
  const toggle = () => setOpen((o) => !o);
  const [phase, setPhase] = useState<"world" | "simulation">("world");

  const [mode, setMode] = useState<WorldMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [north, setNorth] = useState(PRESETS["NYC – Times Sq (tiny)"].north);
  const [south, setSouth] = useState(PRESETS["NYC – Times Sq (tiny)"].south);
  const [east, setEast] = useState(PRESETS["NYC – Times Sq (tiny)"].east);
  const [west, setWest] = useState(PRESETS["NYC – Times Sq (tiny)"].west);
  const [maxB, setMaxB] = useState(250);

  const [cityWidth, setCityWidth] = useState(3000);
  const [cityHeight, setCityHeight] = useState(3000);
  const [seed, setSeed] = useState(42);

  const [speed, setSpeed] = useState(30);
  const [tickRate, setTickRate] = useState(20);
  const [droneCount, setDroneCount] = useState(200);


  useEffect(() => {
    send({ type: "set_params", params: { grid_cell_m: 20, clearance_m: 6, speed: 30 } });
  }, []);
  useEffect(() => {
    send({ type: "set_params", params: { speed } });
  }, [speed]);
  useEffect(() => {
    send({ type: "tick_rate", tick_rate_hz: tickRate });
  }, [tickRate]);

  const applyPreset = (name: keyof typeof PRESETS) => {
    const b = PRESETS[name];
    setNorth(b.north);
    setSouth(b.south);
    setEast(b.east);
    setWest(b.west);
  };

  const loadSyntheticWorld = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const body = { mode: "synthetic", city_w: cityWidth, city_h: cityHeight, seed };
      const r = await fetch(`${API}/world_from_osm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        alert(`Synthetic world load failed (${r.status}). ${text || "Check server logs."}`);
        return;
      }
      const worldData = await r.json();
      send({ type: "set_world", world: worldData });
      setPhase("simulation");
    } finally {
      setIsLoading(false);
    }
  };

  const loadOSMWorld = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const body = {
        mode: "osm",
        north,
        south,
        east,
        west,
        target_buildings: maxB,
        limit: Math.max(100, maxB),
      };
      const r = await fetch(`${API}/world_from_osm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        alert(`OSM world load failed (${r.status}). ${text || "Check server logs."}`);
        return;
      }
      const worldData = await r.json();
      send({ type: "set_world", world: worldData });
      setPhase("simulation");
    } finally {
      setIsLoading(false);
    }
  };

  // --------- Drone seeding ---------
  function seedDrones(count = 200) {
    const w = useSimStore.getState().world;
    const hasSize = w.size && w.size[0] > 0 && w.size[1] > 0 && w.size[2] > 0;
    const W =
      hasSize
        ? w.size[0]
        : Math.max(100, Math.max(...(w.obstacles?.map((o) => o.center.x + o.size.x / 2) ?? [100])));
    const H =
      hasSize
        ? w.size[1]
        : Math.max(100, Math.max(...(w.obstacles?.map((o) => o.center.y + o.size.y / 2) ?? [100])));
    const maxBuildingZ = w.obstacles?.length ? Math.max(...w.obstacles.map((o) => o.size.z)) : 0;

    const margin = 5;
    const zMin = Math.min(122, maxBuildingZ + 5);
    const zMax = Math.min(122, Math.max(zMin + 1, maxBuildingZ + 20));
    const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

    const generatePointAtDistance = (
      start: { x: number; y: number; z: number },
      targetDistance: number
    ) => {
      const angle = Math.random() * 2 * Math.PI;
      const dx = targetDistance * Math.cos(angle);
      const dy = targetDistance * Math.sin(angle);

      for (let attempt = 0; attempt < 10; attempt++) {
        const x = start.x + dx;
        const y = start.y + dy;
        if (x >= margin && x <= W - margin && y >= margin && y <= H - margin) {
          return { x, y, z: rnd(zMin, zMax) };
        }
      }
      return {
        x: Math.min(Math.max(margin, start.x + dx), W - margin),
        y: Math.min(Math.max(margin, start.y + dy), H - margin),
        z: rnd(zMin, zMax),
      };
    };

    const worldDiagonal = Math.sqrt(W * W + H * H);
    const ds = Array.from({ length: count }, (_, i) => {
      const startPos = {
        x: rnd(margin, Math.max(margin, W - margin)),
        y: rnd(margin, Math.max(margin, H - margin)),
        z: rnd(zMin, zMax),
      };
      const targetDistance = worldDiagonal * (0.8 + Math.random() * 0.15);
      const targetPos = generatePointAtDistance(startPos, targetDistance);

      return {
        id: String(i),
        pos: startPos,
        vel: { x: 0, y: 0, z: 0 },
        target: targetPos,
        path: [],
      };
    });
    send({ type: "set_drones", drones: ds });
  }

  const inWorldSetup = phase === "world";

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={toggle}
        aria-label={open ? "Hide control panel" : "Show control panel"}
        className={`
          fixed top-4 z-50 flex items-center gap-2
          px-3 py-2 rounded-full border
          ${open ? "bg-white/70 left-[320px]" : "bg-white/30 left-6"}
          border-white/40 backdrop-blur-xl shadow-lg
          hover:bg-white/80 transition-all duration-300
        `}
        style={{ transform: "translateX(-50%)" }}
      >
        {open ? <PanelLeftClose size={16} /> : <PanelRightOpen size={16} />}
        <span className="text-[12px] font-semibold text-gray-800">{open ? "Hide" : "Show"}</span>
      </button>

      {/* Sidebar */}
      <div
        className={`
          fixed left-0 top-0 h-full w-80
          ${open ? "translate-x-0" : "-translate-x-full"}
          transition-transform duration-300 ease-out
          z-40
        `}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        <div
          className="
            h-full w-full flex flex-col
            bg-gray-600/20 backdrop-blur-xl
            border-r border-white/30 shadow-2xl
          "
        >
          {/* Header */}
          <div className="p-4 border-b border-white/30">
            <h1 className="text-xl font-bold text-gray-900 drop-shadow-sm">Control Panel</h1>
          </div>
          <Separator.Root className="h-px bg-white/30 mx-3" />

          {/* Content */}
          <div className="flex-1 p-3 overflow-y-auto">
            {/* World setup */}
            {inWorldSetup && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-3">World Setup</h2>

                {!mode ? (
                  <div className="space-y-3">
                    <div className="bg-white/30 p-3 rounded border border-white/40">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Select World Type</h3>
                      <div className="space-y-2">
                        <button
                          onClick={() => setMode("synthetic")}
                          className="w-full bg-white/70 hover:bg-white text-gray-900 rounded px-3 py-2 text-xs border border-white/50"
                        >
                          Synthetic City
                        </button>
                        <button
                          onClick={() => setMode("osm")}
                          className="w-full bg-white/70 hover:bg-white text-gray-900 rounded px-3 py-2 text-xs border border-white/50"
                        >
                          OSM Bounding Box
                        </button>
                      </div>
                    </div>
                  </div>
                ) : mode === "synthetic" ? (
                  <div className="space-y-3">
                    <div className="bg-white/30 p-3 rounded border border-white/40 space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900">Synthetic City</h3>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <label className="flex flex-col gap-1">
                          <span>Width (m)</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={cityWidth}
                            onChange={(e) => setCityWidth(+e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>Height (m)</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={cityHeight}
                            onChange={(e) => setCityHeight(+e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 col-span-2">
                          <span>Seed</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={seed}
                            onChange={(e) => setSeed(+e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={loadSyntheticWorld}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"
                          disabled={isLoading}
                        >
                          {isLoading ? "Loading…" : "Build World"}
                        </button>
                        <button
                          onClick={() => setMode(null)}
                          className="bg-white/60 px-3 py-1 rounded text-xs border border-white/40"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-white/30 p-3 rounded border border-white/40 space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900">OSM Bounding Box</h3>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <label className="flex flex-col gap-1">
                          <span>North</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={north}
                            onChange={(e) => setNorth(+e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>South</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={south}
                            onChange={(e) => setSouth(+e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>East</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={east}
                            onChange={(e) => setEast(+e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>West</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={west}
                            onChange={(e) => setWest(+e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 col-span-2">
                          <span>Target Buildings</span>
                          <input
                            type="number"
                            className="px-2 py-1 rounded border border-white/40 bg-white/60"
                            value={maxB}
                            onChange={(e) => setMaxB(+e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={loadOSMWorld}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"
                          disabled={isLoading}
                        >
                          {isLoading ? "Loading…" : "Fetch World"}
                        </button>
                        <button
                          onClick={() => setMode(null)}
                          className="bg-white/60 px-3 py-1 rounded text-xs border border-white/40"
                        >
                          Back
                        </button>
                      </div>
                      <div className="mt-2 text-xs">
                        <button
                          className="underline"
                          onClick={() => applyPreset("NYC – Times Sq (tiny)")}
                        >
                          Use NYC Times Sq (tiny)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Simulation panel */}
            {!inWorldSetup && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-3">Simulation</h2>

                <div className="grid gap-3">
                  <div className="bg-white/30 p-3 rounded border border-white/40 space-y-3">
                    <h4 className="text-sm font-semibold text-gray-900">Planner & Runtime</h4>

                    {/* Algorithm select */}
                    <div>
                      <Label.Root className="text-xs font-medium text-gray-800">
                        Algorithm
                      </Label.Root>
                      <Select.Root
                        value={selected ?? ""}
                        onValueChange={(val) => setSelected?.(val)}
                        disabled={!algorithms?.length}
                      >
                        <Select.Trigger className="mt-1 w-full inline-flex items-center justify-between text-xs px-3 py-2 bg-white/60 rounded border border-white/40">
                          <Select.Value placeholder="Select algorithm…" />
                          <ChevronDown size={14} />
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content className="bg-white/90 rounded shadow-lg text-xs z-[9999]">
                            <Select.Viewport>
                              {algorithms?.map((name) => (
                                <Select.Item
                                  key={name}
                                  value={name}
                                  className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-blue-50"
                                >
                                  <Select.ItemText>{name}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={12} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>

                    {/* Speed */}
                    <div>
                      <div className="flex justify-between mb-1">
                        <Label.Root className="text-xs font-medium text-gray-800">
                          Speed: {speed} m/s
                        </Label.Root>
                      </div>
                      <Slider.Root
                        value={[speed]}
                        onValueChange={([v]) => setSpeed(v)}
                        min={5}
                        max={120}
                        step={5}
                        className="relative flex items-center w-full h-4"
                      >
                        <Slider.Track className="bg-white/40 rounded-full h-1 flex-1">
                          <Slider.Range className="bg-blue-500 rounded-full h-full" />
                        </Slider.Track>
                        <Slider.Thumb className="block w-4 h-4 bg-blue-500 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </Slider.Root>
                    </div>

                    {/* Tick rate */}
                    <div>
                      <div className="flex justify-between mb-1">
                        <Label.Root className="text-xs font-medium text-gray-800">
                          Tick Rate: {tickRate} Hz
                        </Label.Root>
                      </div>
                      <Slider.Root
                        value={[tickRate]}
                        onValueChange={([v]) => setTickRate(v)}
                        min={1}
                        max={60}
                        step={1}
                        className="relative flex items-center w-full h-4"
                      >
                        <Slider.Track className="bg-white/40 rounded-full h-1 flex-1">
                          <Slider.Range className="bg-blue-500 rounded-full h-full" />
                        </Slider.Track>
                        <Slider.Thumb className="block w-4 h-4 bg-blue-500 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </Slider.Root>
                    </div>
                  </div>

                  {/* Drone population */}
                  <div className="bg-white/30 p-3 rounded border border-white/40">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Drone Population</h4>
                    <p className="text-xs text-gray-800 mb-2">Current: {drones.length} drones</p>
                    <div className="flex gap-2 mb-3">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={droneCount}
                        className="w-20 px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        onChange={(e) =>
                          setDroneCount(Math.min(1000, Math.max(1, +e.target.value)))
                        }
                      />
                    </div>
                  </div>

                  <Separator.Root className="h-px bg-white/30 my-1" />

                  {/* Controls */}
                  <div className="bg-white/30 p-3 rounded border border-white/40">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Controls</h4>
                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          // Send everything in a deterministic order to avoid race conditions:
                          // 1) algorithm, 2) params, 3) tick rate, 4) drones, 5) start
                          if (selected) {
                            send({ type: "set_algorithm", algorithm: selected });
                          }
                          send({
                            type: "set_params",
                            params: {
                              grid_cell_m: 20,
                              clearance_m: 6,
                              speed,
                            },
                          });
                          send({ type: "tick_rate", tick_rate_hz: tickRate });

                          seedDrones(droneCount);
                          send({ type: "start" });
                        }}
                        className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 transition-colors"
                      >
                        Start
                      </button>

                      <button
                        onClick={() => {
                          // Full reset (UI + backend)
                          send({ type: "reset" });
                          send({ type: "set_drones", drones: [] });
                          useSimStore.setState({ drones: [], tick: 0 });
                          const emptyWorld: World = {
                            obstacles: [],
                            size: [1000, 1000, 1000] as [number, number, number],
                          };
                          send({ type: "set_world", world: emptyWorld });
                          useSimStore.setState({ world: emptyWorld });
                          setPhase("world");
                          setMode(null);
                        }}
                        className="bg-rose-600 text-white px-3 py-1 rounded text-xs hover:bg-rose-700 transition-colors"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mt-2 p-2 bg-white/40 rounded text-xs">
                      <p className="text-gray-800">Tick: {tick}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-gray-800">UAV Simulation</p>
                <p className="text-[11px] text-gray-700">v1.0</p>
              </div>
              <div
                className={`px-2 py-1 rounded-md text-[11px] ${
                  connected ? "bg-green-500/20 text-green-700" : "bg-red-500/20 text-red-700"
                }`}
              >
                {connected ? "Connected" : "Disconnected"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
