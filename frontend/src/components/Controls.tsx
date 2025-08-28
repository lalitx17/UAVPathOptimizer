import { useEffect, useState } from "react";
import { send } from "../api/ws";
import { useSimStore } from "../state/simStore";

const API = import.meta.env.VITE_HTTP_API ?? "http://localhost:8000";

type BBox = { north:number; south:number; east:number; west:number };

const PRESETS: Record<string, BBox> = {
  "NYC – Times Sq (tiny)": { north: 40.75890, south: 40.75790, east: -73.98400, west: -73.98620 },
  "Boston – Kendall (small)": { north: 42.36730, south: 42.36470, east: -71.08750, west: -71.09150 },
  "SF – FiDi (small)": { north: 37.79260, south: 37.79000, east: -122.39850, west: -122.40200 },
};

export default function Controls() {
  const algorithms = useSimStore(s=>s.algorithms);
  const selected   = useSimStore(s=>s.selectedAlgorithm);
  const setSelected= useSimStore(s=>s.setSelectedAlgorithm);
  const tick       = useSimStore(s=>s.tick);

  const [speed, setSpeed] = useState(30);
  const [tickRate, setTickRate] = useState(20);

  // A* params
  const [cell, setCell] = useState(10);
  const [clearance, setClearance] = useState(5);
  const [cruise, setCruise] = useState(60);

  // City loader state
  const [north, setNorth] = useState(PRESETS["NYC – Times Sq (tiny)"].north);
  const [south, setSouth] = useState(PRESETS["NYC – Times Sq (tiny)"].south);
  const [east, setEast] = useState(PRESETS["NYC – Times Sq (tiny)"].east);
  const [west, setWest] = useState(PRESETS["NYC – Times Sq (tiny)"].west);
  const [maxB, setMaxB] = useState(200);

  useEffect(()=> { if (selected) send({type:"set_algorithm", algorithm:selected}); }, [selected]);
  useEffect(()=> { send({type:"set_params", params:{ speed: speed }}); }, [speed]);
  useEffect(()=> { send({type:"tick_rate", tick_rate_hz: tickRate}); }, [tickRate]);

  useEffect(()=> {
    // continuous sync of planner params (algorithms decide what to use)
    send({ type:"set_params", params:{
      grid_cell_m: cell, clearance_m: clearance, cruise_alt_m: cruise, allow_diagonal: true
    }});
  }, [cell, clearance, cruise]);

  const applyPreset = (name: keyof typeof PRESETS) => {
    const b = PRESETS[name];
    setNorth(b.north); setSouth(b.south); setEast(b.east); setWest(b.west);
  };

  const loadCity = async () => {
    const body = { north, south, east, west, fast: true, max_buildings: maxB, default_height_m: 15, floor_height_m: 3 };
    const r = await fetch(`${API}/world_from_osm`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const text = await r.text().catch(()=> "");
      console.error("OSM load failed", r.status, text);
      alert(`OSM load failed (${r.status}). ${text || "Check server logs."}`);
      return;
    }
    const world = await r.json();
    send({ type: "set_world", world });
  };


function seedDrones(count = 200) {
  const world = useSimStore.getState().world;

  // Use backend world.size when available; else derive from obstacles
  const hasSize = world.size && world.size[0] > 0 && world.size[1] > 0 && world.size[2] > 0;
  const W = hasSize ? world.size[0] : Math.max(100, Math.max(...world.obstacles.map(o => o.center.x + o.size.x/2) ?? [100]));
  const H = hasSize ? world.size[1] : Math.max(100, Math.max(...world.obstacles.map(o => o.center.y + o.size.y/2) ?? [100]));
  const Z = hasSize ? world.size[2] : Math.max(50, Math.max(...world.obstacles.map(o => o.size.z) ?? [50]) + 20);

  const maxBuildingZ = world.obstacles.length ? Math.max(...world.obstacles.map(o => o.size.z)) : 0;

  const margin = 5;                         // keep away from edges
  const zMin = Math.min(Z - 2, maxBuildingZ + 5);
  const zMax = Math.min(Z - 1, Math.max(zMin + 1, maxBuildingZ + 20));
  const rnd = (lo:number, hi:number) => lo + Math.random()*(hi - lo);

  const drones = Array.from({length: count}, (_, i) => ({
    id: String(i),
    pos: {
      x: rnd(margin, Math.max(margin, W - margin)),
      y: rnd(margin, Math.max(margin, H - margin)),
      z: rnd(zMin, zMax),
    },
    vel: { x: 0, y: 0, z: 0 },
    target: {
      x: rnd(margin, Math.max(margin, W - margin)),
      y: rnd(margin, Math.max(margin, H - margin)),
      z: rnd(zMin, zMax),
    },
    path: [],
  }));

  send({ type: "set_drones", drones });
}


  return (
    <div style={{position:"absolute", top:12, left:12, padding:12, background:"rgba(20,22,25,0.7)", borderRadius:12, zIndex: 2}}>
      <div style={{color:"#fff", fontWeight:600, marginBottom:8}}>Controls</div>

      <label style={{color:"#ddd"}}>Algorithm</label><br/>
      <select value={selected ?? ""} onChange={e=> setSelected(e.target.value)} style={{width:240, marginBottom:6}}>
        {algorithms.map(a => <option key={a} value={a}>{a}</option>)}
      </select>

      <div style={{color:"#ddd", marginTop:6}}>Speed: {speed} m/s</div>
      <input type="range" min={5} max={120} value={speed} onChange={e=>setSpeed(+e.target.value)} style={{width:240}}/>

      <div style={{color:"#ddd", marginTop:6}}>Tick rate: {tickRate} Hz</div>
      <input type="range" min={1} max={60} value={tickRate} onChange={e=>setTickRate(+e.target.value)} style={{width:240}}/>

      <div style={{marginTop:10, color:"#aaa"}}>A* Grid Params</div>
      <div style={{color:"#ddd"}}>Cell: {cell} m</div>
      <input type="range" min={4} max={30} value={cell} onChange={e=>setCell(+e.target.value)} style={{width:240}}/>
      <div style={{color:"#ddd"}}>Clearance: {clearance} m</div>
      <input type="range" min={0} max={20} value={clearance} onChange={e=>setClearance(+e.target.value)} style={{width:240}}/>
      <div style={{color:"#ddd"}}>Cruise Alt: {cruise} m</div>
      <input type="range" min={20} max={200} value={cruise} onChange={e=>setCruise(+e.target.value)} style={{width:240}}/>

      <div style={{marginTop:8, display:"flex", gap:8}}>
        <button onClick={()=> { seedDrones(200); send({type:"start"}); }}>Start</button>
        <button onClick={()=> send({type:"pause"})}>Pause</button>
        <button onClick={()=> send({type:"reset"})}>Reset</button>
        <button onClick={()=> seedDrones(200)}>Seed 200 drones</button>
      </div>

      <div style={{color:"#aaa", marginTop:8}}>Tick: {tick}</div>

      {/* City Loader Section */}
      <div style={{marginTop:12, paddingTop:12, borderTop:"1px solid rgba(255,255,255,0.1)"}}>
        <div style={{color:"#fff", fontWeight:600, marginBottom:6}}>City Patch (OSM)</div>

        <div style={{display:"flex", gap:6, flexWrap:"wrap", marginBottom:8}}>
          {Object.keys(PRESETS).map(name => (
            <button key={name} onClick={()=>applyPreset(name as keyof typeof PRESETS)}>{name}</button>
          ))}
        </div>

        <div style={{display:"grid", gridTemplateColumns:"auto auto", gap:6}}>
          <label>north</label><input value={north} onChange={e=>setNorth(+e.target.value)} />
          <label>south</label><input value={south} onChange={e=>setSouth(+e.target.value)} />
          <label>east</label><input value={east} onChange={e=>setEast(+e.target.value)} />
          <label>west</label><input value={west} onChange={e=>setWest(+e.target.value)} />
          <label>max buildings</label><input value={maxB} onChange={e=>setMaxB(+e.target.value)} />
        </div>

        <button onClick={loadCity} style={{marginTop:8, width:"100%"}}>Load City Patch</button>
        <div style={{marginTop:6, fontSize:12, color:"#bbb"}}>
          Tip: keep bboxes under ~0.5 km × 0.5 km for quick Overpass queries.
        </div>
      </div>
    </div>
  );
}
