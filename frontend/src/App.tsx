import { useEffect } from "react";
import { connectWs } from "./api/ws";
import CityLoader from "./components/CityLoader";
import Controls from "./components/Controls";
import DeckScene from "./components/DeckScene";

export default function App() {
  useEffect(()=> { connectWs(); }, []);
  return (
    <div style={{width:"100vw", height:"100vh"}}>
      <DeckScene />
      <Controls />
      <CityLoader />
    </div>
  );
}
