import { useEffect, useMemo, useState } from "react";
import { useNav } from "../nav.jsx";
import { usePlayer } from "../PlayerContext.jsx";
import { isNative, scanLocalMusic } from "../native.js";
import Icon from "./Icon.jsx";

const KEY = "hm_local_songs";
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Music files stored on the phone (Android app only). Plays through the same native player as online songs.
export default function LocalMusic() {
  const nav = useNav();
  const { play, playAll, current, playing } = usePlayer();
  const [songs, setSongs] = useState(load);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const scan = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await scanLocalMusic();
      const list = (r.songs || []).map((s) => ({ ...s, thumbnail: "" }));
      setSongs(list);
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {}
      if (!list.length) setErr("No music files found on this phone.");
    } catch (e) {
      const m = String(e?.message || e);
      setErr(/not implemented/i.test(m) ? "Please update the app to the latest version to use local music." : m);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (isNative && !songs.length) scan();
  }, []); // eslint-disable-line

  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    return w ? songs.filter((s) => `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(w)) : songs;
  }, [songs, q]);

  return (
    <div className="page">
      <button className="ic back" onClick={nav.back} aria-label="Back">
        <Icon name="back" />
      </button>
      <div className="coll-head" style={{ paddingTop: 70 }}>
        <h1 className="coll-title">On this device</h1>
        <div className="sub">Music stored on your phone · {songs.length} songs</div>
      </div>

      {!isNative ? (
        <p className="sub center pad">Local music is available in the HiMusic Android app.</p>
      ) : (
        <>
          <div className="coll-actions">
            <button className="btn-green small" disabled={!shown.length} onClick={() => playAll(shown)}>Play</button>
            <button className="ic" disabled={!shown.length} onClick={() => playAll(shown, { shuffled: true })} aria-label="Shuffle play">
              <Icon name="shuffle" size={28} />
            </button>
            <button className="btn-ghost small" disabled={busy} onClick={scan}>{busy ? "Scanning..." : "Rescan"}</button>
          </div>
          {songs.length > 8 && (
            <div className="pad-s">
              <input className="local-search" placeholder="Search your music" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {err && <p className="error">{err}</p>}
          <div className="list">
            {shown.map((s) => (
              <div key={s.id} className={"song-row" + (current?.id === s.id ? " active" : "")}>
                <button className="song-main" onClick={() => play(s, shown)}>
                  <div className="cover local-cover" style={{ width: 48, height: 48 }}>
                    <Icon name="library" size={22} />
                  </div>
                  <div className="meta">
                    <div className="title">{s.title}</div>
                    <div className="sub">
                      {current?.id === s.id && playing && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                      {[s.artist, s.duration ? fmt(s.duration) : ""].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
