import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "./store.jsx";
import { getOfflineBlob, listOffline, removeOffline, saveOffline } from "./offline.js";

const Ctx = createContext(null);
export const useDownloads = () => useContext(Ctx);

export function DownloadsProvider({ children }) {
  const { user, showToast } = useApp();
  const uid = user?.id;
  const [items, setItems] = useState([]); // meta rows, newest first
  const [progress, setProgress] = useState({}); // id -> 0..1 while downloading
  const busy = useRef(new Set());
  const blobUrls = useRef(new Map()); // id -> object URL (revoked when removed / user changes)

  const dropUrls = () => {
    for (const u of blobUrls.current.values()) URL.revokeObjectURL(u);
    blobUrls.current.clear();
  };

  useEffect(() => {
    dropUrls();
    setItems([]);
    if (!uid) return;
    let dead = false;
    listOffline(uid).then((l) => !dead && setItems(l)).catch(() => {});
    return () => {
      dead = true;
    };
  }, [uid]);

  const ids = useMemo(() => new Set(items.map((m) => m.id)), [items]);
  const isDownloaded = (id) => ids.has(id);

  const download = useCallback(
    async (song) => {
      if (!uid || busy.current.has(song.id) || ids.has(song.id)) return;
      busy.current.add(song.id);
      setProgress((p) => ({ ...p, [song.id]: 0.01 }));
      try {
        const s = await api.stream(song.id, "normal");
        // Download in 1 MB pieces (same way the player streams). One big request is often refused or cut off.
        const parts = [];
        let got = 0, total = 0, type = "";
        for (;;) {
          let res;
          for (let attempt = 0; ; attempt++) {
            try {
              res = await fetch(s.audioUrl, { headers: { Range: `bytes=${got}-` } });
              if (res.ok) break;
              throw new Error(`server answered ${res.status}`);
            } catch (e) {
              if (attempt >= 2) throw e;
              await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            }
          }
          type ||= res.headers.get("content-type") || "audio/mp4";
          const buf = new Uint8Array(await res.arrayBuffer());
          if (res.status === 200) {
            // server ignored Range and sent the whole file
            parts.length = 0;
            parts.push(buf);
            got = buf.length;
            break;
          }
          parts.push(buf);
          got += buf.length;
          const m = /\/(\d+)$/.exec(res.headers.get("content-range") || "");
          if (m) total = Number(m[1]);
          if (total) setProgress((p) => ({ ...p, [song.id]: Math.min(0.99, got / total) }));
          if (!buf.length || (total && got >= total)) break;
        }
        const blob = new Blob(parts, { type });
        if (blob.size < 10_000) throw new Error("download failed");
        const meta = await saveOffline(uid, song, blob);
        setItems((l) => [meta, ...l.filter((m) => m.id !== meta.id)]);
        showToast("Downloaded for offline");
      } catch (e) {
        const why = e?.name === "QuotaExceededError" ? "not enough storage on this device"
          : e?.message === "Failed to fetch" ? "blocked by the network or server settings (CORS)" : e?.message || "unknown error";
        showToast(`Download failed: ${why}`);
      } finally {
        busy.current.delete(song.id);
        setProgress((p) => {
          const { [song.id]: _, ...rest } = p;
          return rest;
        });
      }
    },
    [uid, ids, showToast]
  );

  const downloadMany = useCallback(
    async (songs) => {
      const todo = songs.filter((s) => !ids.has(s.id));
      if (!todo.length) return showToast("Already downloaded");
      showToast(`Downloading ${todo.length} song${todo.length > 1 ? "s" : ""}...`);
      for (const s of todo) await download(s); // one at a time, gentle on data + server
    },
    [ids, download, showToast]
  );

  const remove = useCallback(
    async (song) => {
      if (!uid) return;
      await removeOffline(uid, song.id).catch(() => {});
      const u = blobUrls.current.get(song.id);
      if (u) URL.revokeObjectURL(u), blobUrls.current.delete(song.id);
      setItems((l) => l.filter((m) => m.id !== song.id));
      showToast("Removed download");
    },
    [uid, showToast]
  );

  // object URL for playing a saved song without any network
  const getUrl = useCallback(
    async (id) => {
      if (!uid) return null;
      const have = blobUrls.current.get(id);
      if (have) return have;
      const blob = await getOfflineBlob(uid, id).catch(() => null);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      blobUrls.current.set(id, u);
      return u;
    },
    [uid]
  );

  const value = { items, songs: items.map((m) => m.song), progress, isDownloaded, download, downloadMany, remove, getUrl,
    bytes: items.reduce((a, m) => a + (m.size || 0), 0) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
