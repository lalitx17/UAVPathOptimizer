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
  setConnected(v:boolean): void;
  setStateFrame(tick:number, drones:Drone[]): void;
  setAlgorithms(list:string[]): void;
  setSelectedAlgorithm(name:string): void;
  setWorld(w:World): void;
  setWorldPresets(list:string[]): void;
};

export const useSimStore = create<SimState>((set) => ({
  connected: false,
  tick: 0,
  drones: [],
  algorithms: [],
  selectedAlgorithm: null,
  world: { size:[1000,1000,100], obstacles:[] },
  worldPresets: [],
  setConnected: (v)=> set({ connected:v }),
  setStateFrame: (tick,drones)=> set({ tick, drones }),
  setAlgorithms: (list)=> set({ algorithms:list, selectedAlgorithm:list[0] ?? null }),
  setSelectedAlgorithm: (name)=> set({ selectedAlgorithm:name }),
  setWorld: (w)=> set({ world:w }),
  setWorldPresets: (list)=> set({ worldPresets:list }),
}));
