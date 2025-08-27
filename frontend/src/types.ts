export type Vec3 = { x:number; y:number; z:number };
export type Building = { id:string; center:Vec3; size:Vec3 };
export type World = { size:[number,number,number]; obstacles:Building[] };

export type Drone = { id:string; pos:Vec3; vel:Vec3; path?:Vec3[]; target?:Vec3|null };

export type StateMsg = { type:"state"; tick:number; drones:Drone[]; done:boolean };
export type MetaMsg  = { type:"meta"; algorithms:string[]; world:World; worlds:string[] };
export type ErrorMsg = { type:"error"; message:string };

export type OutMsg =
  | { type:"start" } | { type:"pause" } | { type:"reset" }
  | { type:"set_algorithm"; algorithm:string }
  | { type:"set_params"; params:Record<string,unknown> }
  | { type:"set_drones"; drones:Drone[] }
  | { type:"tick_rate"; tick_rate_hz:number }
  | { type:"init"; world:World }
  | { type:"set_world"; world?:World; params?:{ name:string } };
