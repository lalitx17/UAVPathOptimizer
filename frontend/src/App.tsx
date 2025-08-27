import { useEffect } from "react";
import { connectWs } from "./api/ws";
import Controls from "./components/Controls";
import DeckScene from "./components/DeckScene";
import HUD from "./components/HUD";



export default function App() {
  useEffect(() => {connectWs();}, []);
  return (
    <div style={{width:"100vw", height:"100vh"}}>
      <DeckScene />
      <Controls />
      <HUD />
    </div>
  );
}
