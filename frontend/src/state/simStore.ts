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

  worldSize(): [number, number, number];
};

function sizeFromObstacles(w: World): [number, number, number] {
  if (w.size && w.size[0] > 0 && w.size[1] > 0 && w.size[2] > 0) {
    return w.size;
  }
  if (!w.obstacles || w.obstacles.length === 0) {
    return [100, 100, 50]; 
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
  world: { size: [0, 0, 0], obstacles: [] },
  worldPresets: [],

  setConnected: (v) => set({ connected: v }),
  setStateFrame: (tick, drones) => set({ tick, drones }),
  setAlgorithms: (list) => set({ algorithms: list, selectedAlgorithm: list[0] ?? null }),
  setSelectedAlgorithm: (name) => set({ selectedAlgorithm: name }),

  setWorld: (w) => {
    set({ world: w });
  },

  setWorldPresets: (list) => set({ worldPresets: list }),

  worldSize: () => sizeFromObstacles(get().world),
}));
