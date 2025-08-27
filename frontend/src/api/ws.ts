import { useSimStore } from "../state/simStore";
import type { ErrorMsg, MetaMsg, OutMsg, StateMsg } from "../types";

let ws: WebSocket | null = null;
let queue: OutMsg[] = [];       

export function connectWs() {
  const url = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws";
  ws = new WebSocket(url);

  ws.onopen = () => {
    useSimStore.getState().setConnected(true);
    // flush any queued messages
    queue.forEach(m => ws!.send(JSON.stringify(m)));
    queue = [];
  };

  ws.onclose = () => {
    useSimStore.getState().setConnected(false);
  };

  ws.onerror = (e) => {
    console.error("WebSocket error:", e);
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as MetaMsg | StateMsg | ErrorMsg;
    if (msg.type === "meta") {
      useSimStore.getState().setAlgorithms(msg.algorithms);
      useSimStore.getState().setWorldSize(msg.world.size);
    } else if (msg.type === "state") {
      useSimStore.getState().setStateFrame(msg.tick, msg.drones);
      console.log(msg);
    } else if (msg.type === "error") {
      console.error("Server error:", msg.message);
    }
  };
}

export function send(msg: OutMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    queue.push(msg);                  
  }
}
