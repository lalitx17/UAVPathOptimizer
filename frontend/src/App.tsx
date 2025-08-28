import { useEffect } from "react";
import { connectWs } from "./api/ws";
import Controls from "./components/Controls";
import DeckScene from "./components/DeckScene";

export default function App() {
  useEffect(()=> { connectWs(); }, []);
  return (
    <div className="w-screen h-screen relative">
      <DeckScene />
      <Controls />
    </div>
  );
}
