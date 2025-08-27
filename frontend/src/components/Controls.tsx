import { useEffect, useState } from "react";
import { send } from "../api/ws";
import { useSimStore } from "../state/simStore";

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

  useEffect(()=> { if (selected) send({type:"set_algorithm", algorithm:selected}); }, [selected]);
  useEffect(()=> { send({type:"set_params", params:{ speed: speed }}); }, [speed]);
  useEffect(()=> { send({type:"tick_rate", tick_rate_hz: tickRate}); }, [tickRate]);

  useEffect(()=> {
    // continuous sync of planner params (algorithms decide what to use)
    send({ type:"set_params", params:{
      grid_cell_m: cell, clearance_m: clearance, cruise_alt_m: cruise, allow_diagonal: true
    }});
  }, [cell, clearance, cruise]);

  const seedDrones = () => {
    const drones = Array.from({length: 200}, (_,i)=>({
      id: String(i),
      pos: {x: Math.random()*900+50, y: Math.random()*900+50, z: Math.random()*30+5},
      vel: {x:0,y:0,z:0},
      target: {x: Math.random()*900+50, y: Math.random()*900+50, z: Math.random()*30+5},
      path: []
    }));
    send({type:"set_drones", drones});
  };

  return (
    <div style={{position:"absolute", top:12, left:12, padding:12, background:"rgba(20,22,25,0.7)", borderRadius:12}}>
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
        <button onClick={()=> send({type:"start"})}>Start</button>
        <button onClick={()=> send({type:"pause"})}>Pause</button>
        <button onClick={()=> send({type:"reset"})}>Reset</button>
        <button onClick={seedDrones}>Seed 200 drones</button>
      </div>

      <div style={{color:"#aaa", marginTop:8}}>Tick: {tick}</div>
    </div>
  );
}
