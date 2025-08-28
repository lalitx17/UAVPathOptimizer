// src/components/CityLoader.tsx
import { useState } from "react";
import { send } from "../api/ws";
const API = import.meta.env.VITE_HTTP_API ?? "http://localhost:8000";

type BBox = { north:number; south:number; east:number; west:number };

const PRESETS: Record<string, BBox> = {
  // ~220m x 220m — very small, loads quickly
  "NYC – Times Sq (tiny)": { north: 40.75890, south: 40.75790, east: -73.98400, west: -73.98620 },
  // ~350m x 300m near MIT/Cambridge
  "Boston – Kendall (small)": { north: 42.36730, south: 42.36470, east: -71.08750, west: -71.09150 },
  // ~300m x 300m in SF FiDi
  "SF – FiDi (small)": { north: 37.79260, south: 37.79000, east: -122.39850, west: -122.40200 },
};

export default function CityLoader() {
  // default to the tiny Times Square block
  const [north, setNorth] = useState(PRESETS["NYC – Times Sq (tiny)"].north);
  const [south, setSouth] = useState(PRESETS["NYC – Times Sq (tiny)"].south);
  const [east,  setEast ] = useState(PRESETS["NYC – Times Sq (tiny)"].east);
  const [west,  setWest ] = useState(PRESETS["NYC – Times Sq (tiny)"].west);
  const [maxB,  setMaxB ] = useState(200); // tighter cap for snappy loads

  const applyPreset = (name: keyof typeof PRESETS) => {
    const b = PRESETS[name];
    setNorth(b.north); setSouth(b.south); setEast(b.east); setWest(b.west);
  };

  const load = async () => {
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

  return (
    <div style={{position:"absolute", bottom:12, right:12, padding:10, background:"rgba(20,22,25,0.7)", borderRadius:10, color:"#eee", width: 320, zIndex: 3}}>
      <div style={{fontWeight:600, marginBottom:6}}>City Patch (OSM)</div>

      <div style={{display:"flex", gap:6, flexWrap:"wrap", marginBottom:8}}>
        {Object.keys(PRESETS).map(name => (
          <button key={name} onClick={()=>applyPreset(name as keyof typeof PRESETS)}>{name}</button>
        ))}
      </div>

      <div style={{display:"grid", gridTemplateColumns:"auto auto", gap:6}}>
        <label>north</label><input value={north} onChange={e=>setNorth(+e.target.value)} />
        <label>south</label><input value={south} onChange={e=>setSouth(+e.target.value)} />
        <label>east</label><input  value={east}  onChange={e=>setEast(+e.target.value)} />
        <label>west</label><input  value={west}  onChange={e=>setWest(+e.target.value)} />
        <label>max buildings</label><input value={maxB} onChange={e=>setMaxB(+e.target.value)} />
      </div>

      <button onClick={load} style={{marginTop:8, width:"100%"}}>Load City Patch</button>
      <div style={{marginTop:6, fontSize:12, color:"#bbb"}}>
        Tip: keep bboxes under ~0.5 km × 0.5 km for quick Overpass queries.
      </div>
    </div>
  );
}
