import { useSimStore } from "../state/simStore";

export default function HUD() {
  const connected = useSimStore(s=>s.connected);
  return (
    <div style={{position:"absolute", top:12, right:12, padding:"6px 10px", background: connected ? "rgba(0,120,0,0.6)" : "rgba(120,0,0,0.6)", color:"#fff", borderRadius:8}}>
      {connected ? "WS: connected" : "WS: disconnected"}
    </div>
  );
}
