import { useState } from "react";
import { API_BASE } from "../api.js";
import { isNative, nativeStatus } from "../native.js";
import { usePlayer } from "../PlayerContext.jsx";

const TEST_ID = "dQw4w9WgXcQ";
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms))]);

// Step-by-step self test: shows exactly where playback / download fails on this device.
export default function Diagnostics({ onClose }) {
  const p = usePlayer();
  const [lines, setLines] = useState([]);
  const [running, setRunning] = useState(false);
  const log = (t) => setLines((l) => [...l, t]);

  const run = async () => {
    setLines([]);
    setRunning(true);
    try {
      log(`app: ${isNative ? "Android app" : "browser"} v${__APP_VERSION__}`);
      log(`page: ${location.origin}`);
      log(`api: ${API_BASE}`);
      log(`online: ${navigator.onLine}`);
      if (isNative) {
        const st = await nativeStatus();
        log(`native: ${JSON.stringify(st)}`);
      }

      let t = Date.now();
      try {
        const r = await withTimeout(fetch(`${API_BASE}/api/music/debug/ytdlp`), 40000, "engine check");
        const j = await r.json();
        log(`1 engine: HTTP ${r.status}, ok=${j.ok}, client=${j.workingClient}, ${Date.now() - t} ms`);
      } catch (e) {
        log(`1 engine: FAIL ${e.message} (cannot reach the server)`);
        return;
      }

      const id = p.current?.id && /^[\w-]{11}$/.test(p.current.id) ? p.current.id : TEST_ID;
      t = Date.now();
      let stream;
      try {
        const token = localStorage.getItem("hm_token");
        const r = await withTimeout(
          fetch(`${API_BASE}/api/music/stream/${id}?q=normal`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
          40000,
          "stream"
        );
        stream = await r.json();
        log(`2 stream: HTTP ${r.status}, engine=${stream.engine || "other"}, ${Date.now() - t} ms${r.ok ? "" : " " + (stream.error || "")}`);
        if (!r.ok) return;
      } catch (e) {
        log(`2 stream: FAIL ${e.message}`);
        return;
      }

      t = Date.now();
      try {
        const r = await withTimeout(fetch(stream.audioUrl, { headers: { Range: "bytes=0-65535" } }), 30000, "audio fetch");
        const buf = await r.arrayBuffer();
        log(`3 audio bytes: HTTP ${r.status}, ${buf.byteLength} bytes, type=${r.headers.get("content-type")}, range=${r.headers.get("content-range")}, ${Date.now() - t} ms`);
      } catch (e) {
        log(`3 audio bytes: FAIL ${e.message}`);
      }

      try {
        const a = new Audio();
        a.preload = "auto";
        a.src = stream.audioUrl;
        t = Date.now();
        const result = await withTimeout(
          new Promise((resolve) => {
            a.addEventListener("playing", () => resolve("playing"), { once: true });
            a.addEventListener("error", () => resolve(`error code ${a.error?.code} ${a.error?.message || ""}`), { once: true });
            a.play().catch((e) => resolve(`play() rejected: ${e.name} ${e.message}`));
          }),
          15000,
          "audio element"
        );
        log(`4 audio element: ${result}, ${Date.now() - t} ms, readyState=${a.readyState}`);
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch (e) {
        log(`4 audio element: FAIL ${e.message}`);
      }
      log("done");
    } finally {
      setRunning(false);
    }
  };

  const text = lines.join("\n");
  return (
    <div className="modal-bg" style={{ zIndex: 320 }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <h3>Playback self-test</h3>
        <p className="sub small center">Tap Run, wait until it says "done", then Copy and send the text to the developer.</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, maxHeight: "40vh", overflow: "auto", textAlign: "left" }}>{text || "Not run yet"}</pre>
        <div className="modal-actions">
          <button className="link" onClick={onClose}>Close</button>
          <button className="link" disabled={!text} onClick={() => navigator.clipboard?.writeText(text).catch(() => {})}>Copy</button>
          <button className="btn-green small" disabled={running} onClick={run}>{running ? "Running..." : "Run"}</button>
        </div>
      </div>
    </div>
  );
}
