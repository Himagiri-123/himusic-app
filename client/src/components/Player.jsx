import { usePlayer } from "../PlayerContext.jsx";
import { useApp } from "../store.jsx";

const fmt = (s) => {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export default function Player() {
  const p = usePlayer();
  const { isLiked, toggleLike } = useApp();
  const { current } = p;
  if (!current) return null;

  const pct = p.time.dur ? (p.time.cur / p.time.dur) * 100 : 0;

  if (!p.expanded) {
    return (
      <div className="mini" onClick={() => p.setExpanded(true)}>
        <div className="mini-bar" style={{ width: pct + "%" }} />
        <img src={current.thumbnail} alt="" />
        <div className="meta">
          <div className="title">{current.title}</div>
          <div className="artist">{p.error || (p.loading ? "Loading..." : current.artist)}</div>
        </div>
        <button
          className="icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            p.toggle();
          }}
        >
          {p.playing ? "⏸" : "▶"}
        </button>
        <button
          className="icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            p.next();
          }}
        >
          ⏭
        </button>
      </div>
    );
  }

  return (
    <div className="full">
      <div className="full-top">
        <button className="icon-btn" onClick={() => p.setExpanded(false)}>⌄</button>
        <span className="muted">
          {p.mode === "video"
            ? "Video mode"
            : p.engine === "embed"
            ? "Audio only (YouTube player)"
            : "Audio only (saves data)"}
        </span>
        <span style={{ width: 40 }} />
      </div>

      {p.mode === "video" ? (
        <div className="video-space" />
      ) : (
        <img className="cover" src={current.thumbnail} alt="" />
      )}

      <div className="full-info">
        <div className="title big">{current.title}</div>
        <div className="artist">{current.artist}</div>
        {p.error && <div className="error">{p.error}</div>}
      </div>

      <input
        className="seek"
        type="range"
        min="0"
        max={p.time.dur || 0}
        step="1"
        value={p.time.cur || 0}
        onChange={(e) => p.seek(Number(e.target.value))}
        style={{ "--pct": pct + "%" }}
      />
      <div className="times">
        <span>{fmt(p.time.cur)}</span>
        <span>{fmt(p.time.dur)}</span>
      </div>

      <div className="controls">
        <button className="icon-btn" onClick={p.previous}>⏮</button>
        <button className="play-btn" onClick={p.toggle}>
          {p.loading ? "…" : p.playing ? "⏸" : "▶"}
        </button>
        <button className="icon-btn" onClick={p.next}>⏭</button>
      </div>

      <div className="extra">
        <button
          className={"icon-btn" + (isLiked(current.id) ? " liked" : "")}
          onClick={() => toggleLike(current)}
        >
          {isLiked(current.id) ? "♥" : "♡"}
        </button>
        <button
          className={"chip" + (p.mode === "video" ? " on" : "")}
          onClick={p.toggleMode}
          disabled={!p.hasVideo && p.mode === "audio"}
        >
          {p.mode === "video" ? "🎧 Switch to audio" : "🎬 Switch to video"}
        </button>
        <button className="chip" onClick={() => p.setPref(p.pref === "auto" ? "embed" : "auto")}>
          Engine: {p.pref === "auto" ? "Auto" : "YouTube"}
        </button>
      </div>
      {p.engine === "embed" && (
        <p className="muted small center">
          Playing via YouTube player. Ads are blocked only if your browser blocks them (e.g. Brave).
        </p>
      )}
    </div>
  );
}
