import { create } from "zustand";
import type { Drone } from "../types";

type SimState = {
  connected: boolean;
  tick: number;
  drones: Drone[];
  algorithms: string[];
  selectedAlgorithm: string | null;
  worldSize: [number,number,number];
  setConnected(v:boolean): void;
  setStateFrame(tick:number, drones:Drone[]): void;
  setAlgorithms(list:string[]): void;
  setSelectedAlgorithm(name:string): void;
  setWorldSize(sz:[number,number,number]): void;
};

export const useSimStore = create<SimState>((set) => ({
  connected: false,
  tick: 0,
  drones: [],
  algorithms: [],
  selectedAlgorithm: null,
  worldSize: [1000,1000,100],
  setConnected: (v) => set({ connected:v }),
  setStateFrame: (tick, drones) => set({ tick, drones }),
  setAlgorithms: (list) => set({ algorithms: list, selectedAlgorithm: list[0] ?? null }),
  setSelectedAlgorithm: (name) => set({ selectedAlgorithm: name }),
  setWorldSize: (sz) => set({ worldSize: sz })
}));
