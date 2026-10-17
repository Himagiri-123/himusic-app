import { useState } from "react";
import { api } from "../api";
import { useApp } from "../store.jsx";
import Icon from "./Icon.jsx";

// Paste a YouTube or Spotify playlist link -> becomes a HiMusic playlist
export default function ImportSheet() {
  const { importOpen, setImportOpen, refresh, showToast } = useApp();
  const [url, setUrl] = useState("");
  const [state, setState] = useState({ step: "idle" }); // idle | reading | matching | done | error
  if (!importOpen) return null;

  const close = () => {
    if (state.step === "matching") return;
    setImportOpen(false);
    setState({ step: "idle" });
    setUrl("");
  };

  const run = async (e) => {
    e.preventDefault();
    setState({ step: "reading" });
    try {
      const pre = await api.importPreview(url.trim());
      let songs = pre.tracks;
      if (pre.needsMatch) {
        // Spotify gives titles only: find each one on YouTube (3 at a time)
        const out = new Array(songs.length).fill(null);
        let done = 0, i = 0;
        setState({ step: "matching", done: 0, total: songs.length, name: pre.name });
        await Promise.all(
          Array.from({ length: 3 }, async () => {
            while (i < songs.length) {
              const k = i++;
              const t = songs[k];
              try {
                const r = await api.search(`${t.title} ${t.artist}`);
                const hit = r.results?.[0];
                if (hit) out[k] = { id: hit.id, title: t.title, artist: t.artist || hit.artist, thumbnail: hit.thumbnail, duration: hit.duration };
              } catch {}
              setState({ step: "matching", done: ++done, total: songs.length, name: pre.name });
            }
          })
        );
        songs = out.filter(Boolean);
      }
      if (!songs.length) throw new Error("No songs could be imported");
      const created = await api.createPlaylist(pre.name.slice(0, 80), "");
      const pid = created.playlists[created.playlists.length - 1]._id;
      for (let k = 0; k < songs.length; k += 100) await api.bulkAdd(pid, songs.slice(k, k + 100));
      await refresh();
      setState({ step: "done", name: pre.name, count: songs.length, total: pre.tracks.length });
      showToast("Playlist imported");
    } catch (err) {
      setState({ step: "error", message: err.message || "Import failed" });
    }
  };

  const s = state;
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import a playlist</h3>
        {(s.step === "idle" || s.step === "error") && (
          <form onSubmit={run} className="import-form">
            <p className="sub small">Paste a public YouTube or Spotify playlist link.</p>
            <input placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoFocus />
            {s.step === "error" && <div className="error">{s.message}</div>}
            <div className="modal-actions">
              <button type="button" className="link" onClick={close}>Cancel</button>
              <button className="btn-green small" disabled={!url.trim()}><Icon name="importList" size={18} /> Import</button>
            </div>
          </form>
        )}
        {s.step === "reading" && <p className="sub pad">Reading the playlist...</p>}
        {s.step === "matching" && (
          <div className="pad">
            <p>Finding "{s.name}" songs on YouTube... {s.done}/{s.total}</p>
            <div className="bar"><i style={{ width: `${(s.done / s.total) * 100}%` }} /></div>
          </div>
        )}
        {s.step === "done" && (
          <div className="pad">
            <p>Imported <b>{s.count}</b> of {s.total} songs into "{s.name}".</p>
            <div className="modal-actions"><button className="btn-green small" onClick={close}>Done</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
