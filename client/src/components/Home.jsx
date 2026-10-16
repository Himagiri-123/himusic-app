import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store.jsx";
import { usePlayer } from "../PlayerContext.jsx";
import { useNav } from "../nav.jsx";
import { cleanArtist, greeting, rgb, useDominantColor, useOnline } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";
import Shelf from "./Shelf.jsx";

const CACHE_KEY = "hm_home_rows";
const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || [];
  } catch {
    return [];
  }
};

export default function Home() {
  const { lib, libLoaded, user, logout } = useApp();
  const { play, current } = usePlayer();
  const nav = useNav();
  const online = useOnline();
  const [rows, setRows] = useState(readCache);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fetched = useRef(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const artist = cleanArtist(lib.history[0]?.artist || lib.liked[0]?.artist || "");
      const r = await api.home(artist);
      if (r.rows?.length) {
        setRows(r.rows);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(r.rows));
        } catch {}
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!libLoaded || fetched.current) return;
    fetched.current = true;
    load();
  }, [libLoaded]); // eslint-disable-line

  useEffect(() => {
    if (online && failed) load();
  }, [online]); // eslint-disable-line

  // 6 quick-access boxes: recently played, then liked, then trending
  const quick = useMemo(() => {
    const seen = new Set();
    const out = [];
    const trending = rows.find((r) => r.id === "trending")?.items || [];
    for (const s of [...lib.history, ...lib.liked, ...trending]) {
      if (!s?.id || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      if (out.length === 6) break;
    }
    return out;
  }, [lib.history, lib.liked, rows]);

  const accent = useDominantColor((current || lib.history[0])?.thumbnail, "home");

  return (
    <div className="page">
      <div className="page-grad" style={{ background: `linear-gradient(180deg, ${rgb(accent, 0.8, 0.75)} 0%, #121212 340px)` }} />
      <header className="page-head">
        <h1>{greeting()}</h1>
        <div className="head-actions">
          <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Account">
            {(user?.name || "U").trim()[0].toUpperCase()}
          </button>
          {menuOpen && (
            <div className="pop" onClick={() => setMenuOpen(false)}>
              <div className="pop-name">{user?.name}</div>
              <div className="pop-sub">{user?.email}</div>
              <button className="pop-btn" onClick={logout}>
                <Icon name="logout" size={18} /> Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="quick">
        {quick.length === 0 && loading && Array.from({ length: 6 }).map((_, i) => <div key={i} className="quick-tile skeleton" />)}
        {quick.map((s) => (
          <button key={s.id} className={"quick-tile" + (current?.id === s.id ? " active" : "")} onClick={() => play(s, quick)}>
            <Cover src={s.thumbnail} size={56} />
            <span>{s.title}</span>
          </button>
        ))}
      </div>

      {rows.map((r) => (
        <Shelf key={r.id} title={r.title} items={r.items} type={r.type} />
      ))}

      {loading && rows.length === 0 && (
        <div className="shelf">
          <h2 className="skeleton-h" />
          <div className="shelf-row">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card">
                <div className="cover skeleton" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="empty">
          <p>{online ? "Could not load recommendations right now." : "You're offline."}</p>
          <button className="btn-green" onClick={load}>
            Try again
          </button>
          <p className="sub">Use Search to find any song.</p>
        </div>
      )}
    </div>
  );
}
