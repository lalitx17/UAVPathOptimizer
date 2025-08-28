import { create } from "zustand";
import type { Drone, World } from "../types";

type SimState = {
  connected: boolean;
  tick: number;
  drones: Drone[];
  algorithms: string[];
  selectedAlgorithm: string | null;
  world: World;
  worldPresets: string[];

  // actions
  setConnected(v: boolean): void;
  setStateFrame(tick: number, drones: Drone[]): void;
  setAlgorithms(list: string[]): void;
  setSelectedAlgorithm(name: string): void;
  setWorld(w: World): void;
  setWorldPresets(list: string[]): void;

  // selectors/helpers
  worldSize(): [number, number, number]; // <- compute from obstacles if needed
};

function sizeFromObstacles(w: World): [number, number, number] {
  // If backend already provided size and it's > 0, trust it
  if (w.size && w.size[0] > 0 && w.size[1] > 0 && w.size[2] > 0) {
    return w.size;
  }
  // Otherwise, compute tight bounds from obstacles (center ± size/2)
  if (!w.obstacles || w.obstacles.length === 0) {
    return [100, 100, 50]; // tiny safe default
  }
  const minX = Math.min(...w.obstacles.map(o => o.center.x - o.size.x * 0.5));
  const maxX = Math.max(...w.obstacles.map(o => o.center.x + o.size.x * 0.5));
  const minY = Math.min(...w.obstacles.map(o => o.center.y - o.size.y * 0.5));
  const maxY = Math.max(...w.obstacles.map(o => o.center.y + o.size.y * 0.5));
  const maxZ = Math.max(...w.obstacles.map(o => o.size.z));
  const W = Math.max(0.1, maxX - minX);
  const H = Math.max(0.1, maxY - minY);
  const Z = Math.max(5, maxZ + 10);
  return [W, H, Z];
}

export const useSimStore = create<SimState>((set, get) => ({
  connected: false,
  tick: 0,
  drones: [],
  algorithms: [],
  selectedAlgorithm: null,

  // start with an *empty* world; size will be derived from obstacles or backend
  world: { size: [0, 0, 0], obstacles: [] },
  worldPresets: [],

  setConnected: (v) => set({ connected: v }),
  setStateFrame: (tick, drones) => set({ tick, drones }),
  setAlgorithms: (list) => set({ algorithms: list, selectedAlgorithm: list[0] ?? null }),
  setSelectedAlgorithm: (name) => set({ selectedAlgorithm: name }),

  setWorld: (w) => {
    // If backend didn't fit size, we still keep it and expose a selector below
    set({ world: w });
  },

  setWorldPresets: (list) => set({ worldPresets: list }),

  worldSize: () => sizeFromObstacles(get().world),
}));
