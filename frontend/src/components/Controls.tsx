import * as Label from "@radix-ui/react-label";
import * as Select from "@radix-ui/react-select";
import * as Separator from "@radix-ui/react-separator";
import * as Slider from "@radix-ui/react-slider";
import { Check, ChevronDown, PanelRightOpen, PanelLeftClose } from "lucide-react";
import { useEffect, useState } from "react";
import { send } from "../api/ws";
import { useSimStore } from "../state/simStore";

const API = "http://localhost:8000";

type BBox = { north: number; south: number; east: number; west: number };

const PRESETS: Record<string, BBox> = {
  "NYC – Times Sq (tiny)": { north: 40.7589, south: 40.7579, east: -73.984, west: -73.9862 },
  "Boston – Kendall (small)": { north: 42.3673, south: 42.3647, east: -71.0875, west: -71.0915 },
  "SF – FiDi (small)": { north: 37.7926, south: 37.79, east: -122.3985, west: -122.402 },
};

type WorldMode = "synthetic" | "osm";

export default function Controls() {
  const algorithms = useSimStore((s) => s.algorithms);
  const selected = useSimStore((s) => s.selectedAlgorithm);
  const setSelected = useSimStore((s) => s.setSelectedAlgorithm);
  const tick = useSimStore((s) => s.tick);
  const world = useSimStore((s) => s.world);
  const drones = useSimStore((s) => s.drones);
  const connected = useSimStore((s) => s.connected);

  // ------- Sidebar open/close -------
  const [open, setOpen] = useState(true);
  const toggle = () => setOpen((o) => !o);

  const [phase, setPhase] = useState<"world" | "simulation">("world");

  // ------- World UI state -------
  const [mode, setMode] = useState<WorldMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // OSM bbox inputs
  const [north, setNorth] = useState(PRESETS["NYC – Times Sq (tiny)"].north);
  const [south, setSouth] = useState(PRESETS["NYC – Times Sq (tiny)"].south);
  const [east, setEast] = useState(PRESETS["NYC – Times Sq (tiny)"].east);
  const [west, setWest] = useState(PRESETS["NYC – Times Sq (tiny)"].west);
  const [maxB, setMaxB] = useState(250);

  // Synthetic params
  const [cityWidth, setCityWidth] = useState(3000);
  const [cityHeight, setCityHeight] = useState(3000);
  const [seed, setSeed] = useState(42);

  // ------- Simulation params -------
  const [speed, setSpeed] = useState(30);
  const [tickRate, setTickRate] = useState(20);
  const [droneCount, setDroneCount] = useState(200);

  // Backend param sync
  useEffect(() => { if (selected) send({ type: "set_algorithm", algorithm: selected }); }, [selected]);
  useEffect(() => { send({ type: "set_params", params: { speed } }); }, [speed]);
  useEffect(() => { send({ type: "tick_rate", tick_rate_hz: tickRate }); }, [tickRate]);
  useEffect(() => {
    send({
      type: "set_params",
      params: { grid_cell_m: 10, clearance_m: 5, cruise_alt_m: 60, allow_diagonal: true },
    });
  }, []);

  const applyPreset = (name: keyof typeof PRESETS) => {
    const b = PRESETS[name];
    setNorth(b.north); setSouth(b.south); setEast(b.east); setWest(b.west);
  };

  // ------- Actions -------
  const loadSyntheticWorld = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const body = { mode: "synthetic", city_w: cityWidth, city_h: cityHeight, seed };
      const r = await fetch(`${API}/world_from_osm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        alert(`Synthetic world load failed (${r.status}). ${text || "Check server logs."}`);
        return;
      }
      const worldData = await r.json();
      send({ type: "set_world", world: worldData });

      // Flip to simulation phase after success
      setPhase("simulation");
    } finally {
      setIsLoading(false);
    }
  };

  const loadOSMWorld = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const body = { mode: "osm", north, south, east, west, target_buildings: maxB, limit: Math.max(100, maxB) };
      const r = await fetch(`${API}/world_from_osm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
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

  function seedDrones(count = 200) {
    const w = useSimStore.getState().world;
    const hasSize = w.size && w.size[0] > 0 && w.size[1] > 0 && w.size[2] > 0;
    const W = hasSize ? w.size[0] : Math.max(100, Math.max(...w.obstacles.map(o => o.center.x + o.size.x / 2) ?? [100]));
    const H = hasSize ? w.size[1] : Math.max(100, Math.max(...w.obstacles.map(o => o.center.y + o.size.y / 2) ?? [100]));
    const Z = hasSize ? w.size[2] : Math.max(50, Math.max(...w.obstacles.map(o => o.size.z) ?? [50]) + 20);
    const maxBuildingZ = w.obstacles.length ? Math.max(...w.obstacles.map(o => o.size.z)) : 0;

    const margin = 5;
    const zMin = Math.min(Z - 2, maxBuildingZ + 5);
    const zMax = Math.min(Z - 1, Math.max(zMin + 1, maxBuildingZ + 20));
    const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

    const ds = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      pos: { x: rnd(margin, Math.max(margin, W - margin)), y: rnd(margin, Math.max(margin, H - margin)), z: rnd(zMin, zMax) },
      vel: { x: 0, y: 0, z: 0 },
      target: { x: rnd(margin, Math.max(margin, W - margin)), y: rnd(margin, Math.max(margin, H - margin)), z: rnd(zMin, zMax) },
      path: [],
    }));
    send({ type: "set_drones", drones: ds });
  }

  const NavigationItem = ({ icon: Icon, label, isActive, onClick }: {
    icon: React.ComponentType<{ size?: number }>;
    label: string;
    isActive: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2 w-full text-left rounded-lg transition-colors ${isActive ? "bg-white/30 text-blue-800" : "text-gray-800 hover:bg-white/20"}`}
    >
      <Icon size={18} />
      <span className="font-medium">{label}</span>
    </button>
  );

  const inWorldSetup = phase === "world";

  return (
    <>
      {/* Floating toggle button */}
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

      {/* Liquid-crystal sidebar */}
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
            {/* -------- World Setup (locked after done) -------- */}
            {inWorldSetup && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-3">World Setup</h2>

                {/* Mode selection */}
                {!mode ? (
                  <div className="space-y-3">
                    <div className="bg-white/30 p-3 rounded border border-white/40">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Select World Type</h3>
                      <div className="space-y-2">
                        <button
                          onClick={() => setMode("synthetic")}
                          className="w-full p-3 border border-white/40 rounded hover:bg-white/40 transition-colors text-left"
                        >
                          <h4 className="font-semibold text-gray-900 text-sm">Synthetic World</h4>
                          <p className="text-xs text-gray-700">Procedurally created city</p>
                        </button>
                        <button
                          onClick={() => setMode("osm")}
                          className="w-full p-3 border border-white/40 rounded hover:bg-white/40 transition-colors text-left"
                        >
                          <h4 className="font-semibold text-gray-900 text-sm">Real World (OSM)</h4>
                          <p className="text-xs text-gray-700">OpenStreetMap data</p>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : mode === "synthetic" ? (
                  <div className="space-y-3">
                    <div className="bg-white/30 p-3 rounded border border-white/40">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Synthetic World</h3>
                      <div className="space-y-2">
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">City Width (m)</Label.Root>
                          <input
                            type="number"
                            value={cityWidth}
                            onChange={(e) => setCityWidth(+e.target.value)}
                            className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">City Height (m)</Label.Root>
                          <input
                            type="number"
                            value={cityHeight}
                            onChange={(e) => setCityHeight(+e.target.value)}
                            className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">Seed</Label.Root>
                          <input
                            type="number"
                            value={seed}
                            onChange={(e) => setSeed(+e.target.value)}
                            className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={loadSyntheticWorld}
                          disabled={isLoading}
                          className={`px-3 py-1 rounded text-xs transition-colors ${isLoading ? "bg-white/40 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                        >
                          {isLoading ? "Generating..." : "Generate"}
                        </button>
                        <button
                          onClick={() => setMode(null)}
                          disabled={isLoading}
                          className={`px-3 py-1 rounded text-xs transition-colors ${isLoading ? "bg-white/40 text-gray-400 cursor-not-allowed" : "bg-gray-600 text-white hover:bg-gray-700"}`}
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-white/30 p-3 rounded border border-white/40">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Real World (OSM)</h3>

                      <div className="mb-2">
                        <Label.Root className="text-xs font-medium text-gray-800 mb-1 block">Presets</Label.Root>
                        <div className="flex flex-wrap gap-1">
                          {Object.keys(PRESETS).map((name) => (
                            <button
                              key={name}
                              onClick={() => applyPreset(name as keyof typeof PRESETS)}
                              className="px-2 py-1 text-xs bg-white/50 text-gray-800 rounded border border-white/40 hover:bg-white/70 transition-colors"
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">North</Label.Root>
                          <input type="number" value={north} onChange={(e) => setNorth(+e.target.value)} className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">South</Label.Root>
                          <input type="number" value={south} onChange={(e) => setSouth(+e.target.value)} className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">East</Label.Root>
                          <input type="number" value={east} onChange={(e) => setEast(+e.target.value)} className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                        <div>
                          <Label.Root className="text-xs font-medium text-gray-800">West</Label.Root>
                          <input type="number" value={west} onChange={(e) => setWest(+e.target.value)} className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                      </div>

                      <div className="mt-2">
                        <Label.Root className="text-xs font-medium text-gray-800">Target Buildings</Label.Root>
                        <input type="number" value={maxB} onChange={(e) => setMaxB(+e.target.value)} className="mt-1 w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>

                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={loadOSMWorld}
                          disabled={isLoading}
                          className={`px-3 py-1 rounded text-xs transition-colors ${isLoading ? "bg-white/40 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                        >
                          {isLoading ? "Loading..." : "Load City"}
                        </button>
                        <button
                          onClick={() => setMode(null)}
                          disabled={isLoading}
                          className={`px-3 py-1 rounded text-xs transition-colors ${isLoading ? "bg-white/40 text-gray-400 cursor-not-allowed" : "bg-gray-600 text-white hover:bg-gray-700"}`}
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* -------- Simulation (visible only after world is generated) -------- */}
            {!inWorldSetup && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-3">Simulation</h2>
                <div className="space-y-3">
                  <div className="bg-white/30 p-3 rounded border border-white/40">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Parameters</h3>
                    <div className="space-y-3">
                      <div>
                        <Label.Root className="text-xs font-medium text-gray-800 mb-1 block">Algorithm</Label.Root>
                        <Select.Root value={selected ?? ""} onValueChange={setSelected}>
                          <Select.Trigger className="w-full px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400 flex items-center justify-between">
                            <Select.Value placeholder="Select algorithm" />
                            <Select.Icon><ChevronDown size={12} /></Select.Icon>
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content className="bg-white/90 backdrop-blur-md border border-white/40 rounded shadow-lg">
                              <Select.Viewport className="p-1">
                                {algorithms.map((algorithm) => (
                                  <Select.Item key={algorithm} value={algorithm} className="relative flex items-center px-6 py-1 text-xs text-gray-800 rounded cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                                    <Select.ItemText>{algorithm}</Select.ItemText>
                                    <Select.ItemIndicator className="absolute left-1"><Check size={12} /></Select.ItemIndicator>
                                  </Select.Item>
                                ))}
                              </Select.Viewport>
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>
                      </div>

                      <div>
                        <div className="flex justify-between mb-1"><Label.Root className="text-xs font-medium text-gray-800">Speed: {speed} m/s</Label.Root></div>
                        <Slider.Root value={[speed]} onValueChange={([v]) => setSpeed(v)} min={5} max={120} step={5} className="relative flex items-center w-full h-4">
                          <Slider.Track className="bg-white/40 rounded-full h-1 flex-1"><Slider.Range className="bg-blue-500 rounded-full h-full" /></Slider.Track>
                          <Slider.Thumb className="block w-4 h-4 bg-blue-500 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </Slider.Root>
                      </div>

                      <div>
                        <div className="flex justify-between mb-1"><Label.Root className="text-xs font-medium text-gray-800">Tick Rate: {tickRate} Hz</Label.Root></div>
                        <Slider.Root value={[tickRate]} onValueChange={([v]) => setTickRate(v)} min={1} max={60} step={1} className="relative flex items-center w-full h-4">
                          <Slider.Track className="bg-white/40 rounded-full h-1 flex-1"><Slider.Range className="bg-blue-500 rounded-full h-full" /></Slider.Track>
                          <Slider.Thumb className="block w-4 h-4 bg-blue-500 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </Slider.Root>
                      </div>
                    </div>

                    <Separator.Root className="h-px bg-white/30 my-3" />

                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Drone Population</h4>
                    <div className="mb-3">
                      <p className="text-xs text-gray-800 mb-2">Current: {drones.length} drones</p>
                      <div className="flex gap-2 mb-3">
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          value={droneCount}
                          className="w-20 px-2 py-1 border border-white/40 rounded text-xs bg-white/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          onChange={(e) => setDroneCount(Math.min(1000, Math.max(1, +e.target.value)))}
                        />
                      </div>
                    </div>

                    <Separator.Root className="h-px bg-white/30 my-3" />

                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Controls</h4>
                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          seedDrones(droneCount);
                          send({ type: "start" });
                        }}
                        className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 transition-colors"
                      >
                        Start
                      </button>
                      <button onClick={() => send({ type: "pause" })} className="bg-yellow-500 text-white px-3 py-1 rounded text-xs hover:bg-yellow-600 transition-colors">Pause</button>
                      <button onClick={() => send({ type: "reset" })} className="bg-rose-600 text-white px-3 py-1 rounded text-xs hover:bg-rose-700 transition-colors">Reset</button>
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
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-gray-800">UAV Simulation</p>
                  <p className="text-[11px] text-gray-700">v1.0</p>
                </div>
                <div className={`px-2 py-1 rounded-md text-[11px] ${connected ? 'bg-green-500/20 text-green-700' : 'bg-red-500/20 text-red-700'}`}>
                  {connected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
