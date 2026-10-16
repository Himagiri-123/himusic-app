import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usePlayer } from "../PlayerContext.jsx";
import { useApp } from "../store.jsx";
import { cleanArtist, fmt, rgb, useDominantColor } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

/* ---------- lyrics ---------- */

function parseLRC(text = "") {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const line = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: line });
  }
  return out.sort((a, b) => a.t - b.t);
}

function Lyrics({ song, cur, seek }) {
  const [st, setSt] = useState({ loading: true });
  const box = useRef(null);

  useEffect(() => {
    let dead = false;
    setSt({ loading: true });
    api
      .lyrics(song)
      .then((r) => {
        if (dead) return;
        const lines = r.synced ? parseLRC(r.synced) : [];
        setSt({ loading: false, lines, plain: r.plain, found: lines.length > 0 || !!r.plain });
      })
      .catch(() => !dead && setSt({ loading: false, found: false }));
    return () => {
      dead = true;
    };
  }, [song.id]); // eslint-disable-line

  const idx = useMemo(() => {
    const L = st.lines || [];
    let a = -1;
    for (let i = 0; i < L.length; i++) {
      if (L[i].t <= cur + 0.25) a = i;
      else break;
    }
    return a;
  }, [st.lines, cur]);

  useEffect(() => {
    const b = box.current;
    if (!b || idx < 0) return;
    const el = b.querySelector(`[data-i="${idx}"]`);
    if (el) b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [idx]);

  if (st.loading) return <p className="sub center pad">Searching lyrics...</p>;
  if (!st.found)
    return (
      <div className="lyrics-empty">
        <p>No lyrics found for this song.</p>
        <p className="sub">Lyrics come from a free community database, so some songs (many Telugu ones) are not there yet.</p>
      </div>
    );
  return (
    <div className="lyrics" ref={box}>
      {st.lines.length > 0 ? (
        st.lines.map((l, i) => (
          <p key={i} data-i={i} className={"ly" + (i === idx ? " act" : i < idx ? " past" : "")} onClick={() => seek(l.t)}>
            {l.text || "♪"}
          </p>
        ))
      ) : (
        <p className="ly plain">{st.plain}</p>
      )}
    </div>
  );
}

/* ---------- queue ---------- */

function QueueView({ p }) {
  const { current } = p;
  return (
    <div className="qv">
      <div className="qv-h">Now playing</div>
      <div className="q-row now">
        <Cover src={current.thumbnail} size={44} />
        <div className="meta">
          <div className="title green">{current.title}</div>
          <div className="sub">{cleanArtist(current.artist)}</div>
        </div>
      </div>
      <div className="qv-h">
        <span>Next in queue</span>
        {p.queue.length > 0 && (
          <button className="link" onClick={p.clearQueue}>
            Clear queue
          </button>
        )}
      </div>
      {p.queue.length === 0 && (
        <p className="sub pad-s">Nothing queued. Similar songs play automatically. Use the ⋯ menu on any song to add it here.</p>
      )}
      {p.queue.map((s, i) => (
        <div className="q-row" key={s.id + ":" + i}>
          <button className="q-main" onClick={() => p.playFromQueue(i)}>
            <Cover src={s.thumbnail} size={44} />
            <div className="meta">
              <div className="title">{s.title}</div>
              <div className="sub">{cleanArtist(s.artist)}</div>
            </div>
          </button>
          <button className="ic" onClick={() => p.removeFromQueue(i)} aria-label="Remove from queue">
            <Icon name="close" size={20} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- mini + full player ---------- */

export default function Player() {
  const p = usePlayer();
  const { isLiked, toggleLike, setMenu } = useApp();
  const { current } = p;
  const [view, setView] = useState("main"); // main | queue | lyrics
  const col = useDominantColor(current?.thumbnail, current?.id || "x");

  useEffect(() => {
    if (!p.expanded) setView("main");
  }, [p.expanded]);

  if (!current) return null;
  const liked = isLiked(current.id);
  const pct = p.time.dur ? Math.min(100, (p.time.cur / p.time.dur) * 100) : 0;
  const status = p.error || (p.loading ? "Loading..." : cleanArtist(current.artist));

  if (!p.expanded) {
    return (
      <div className="mini" style={{ background: rgb(col, 0.6, 1) }} onClick={p.openFull} role="button" aria-label="Open player">
        <Cover src={current.thumbnail} size={44} />
        <div className="meta">
          <div className="title">{current.title}</div>
          <div className={"sub" + (p.error ? " err" : "")}>{status}</div>
        </div>
        <button
          className={"ic" + (liked ? " on" : "")}
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(current);
          }}
          aria-label="Like"
        >
          <Icon name={liked ? "heartFill" : "heart"} size={24} />
        </button>
        <button
          className="ic"
          onClick={(e) => {
            e.stopPropagation();
            p.toggle();
          }}
          aria-label={p.playing ? "Pause" : "Play"}
        >
          <Icon name={p.playing ? "pause" : "play"} size={30} />
        </button>
        <div className="mini-bar">
          <i style={{ width: pct + "%" }} />
        </div>
      </div>
    );
  }

  const modeLabel = p.mode === "video" ? "Video" : p.engine === "embed" ? "Audio · YouTube player" : "Audio only · saves data";
  const title = view === "queue" ? "Queue" : view === "lyrics" ? "Lyrics" : "Now playing";

  return (
    <div
      className="full"
      style={{ background: `linear-gradient(180deg, ${rgb(col, 0.95, 1)} 0%, ${rgb(col, 0.5, 1)} 42%, #121212 95%)` }}
    >
      <div className="full-in">
        <div className="full-top">
          <button className="ic" onClick={p.closeFull} aria-label="Close player">
            <Icon name="down" size={32} />
          </button>
          <div className="full-from">
            <small>{title}</small>
            <span>{modeLabel}</span>
          </div>
          <button className="ic" onClick={() => setMenu({ song: current })} aria-label="More">
            <Icon name="more" size={24} />
          </button>
        </div>

        <div className={"full-mid" + (p.mode === "video" && view === "main" ? " top" : "")}>
          {view === "main" && (
            <>
              {p.mode === "video" ? <div className="video-space" /> : <Cover src={current.thumbnail} className="cover-big" />}
              <div className="full-info">
                <div className="meta">
                  <div className="title big">{current.title}</div>
                  <div className="sub">{cleanArtist(current.artist)}</div>
                </div>
                <button className={"ic" + (liked ? " on" : "")} onClick={() => toggleLike(current)} aria-label="Like">
                  <Icon name={liked ? "heartFill" : "heart"} size={28} />
                </button>
              </div>
              {p.error && <div className="error">{p.error}</div>}
            </>
          )}
          {view === "lyrics" && <Lyrics song={current} cur={p.time.cur} seek={p.seek} />}
          {view === "queue" && <QueueView p={p} />}
        </div>

        <div className="full-bottom">
          <input
            className="seek"
            type="range"
            min="0"
            max={p.time.dur || 0}
            step="1"
            value={Math.min(p.time.cur || 0, p.time.dur || 0)}
            onChange={(e) => p.seek(Number(e.target.value))}
            style={{ "--pct": pct + "%" }}
            aria-label="Seek"
          />
          <div className="times">
            <span>{fmt(p.time.cur)}</span>
            <span>{fmt(p.time.dur)}</span>
          </div>

          <div className="controls">
            <button className={"ctl" + (p.shuffle ? " on" : "")} onClick={p.toggleShuffle} aria-label="Shuffle" aria-pressed={p.shuffle}>
              <Icon name="shuffle" size={26} />
            </button>
            <button className="ctl big" onClick={p.previous} aria-label="Previous">
              <Icon name="prev" size={38} />
            </button>
            <button className="play-btn" onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"}>
              {p.loading ? <span className="spin" /> : <Icon name={p.playing ? "pause" : "play"} size={36} />}
            </button>
            <button className="ctl big" onClick={p.next} aria-label="Next">
              <Icon name="next" size={38} />
            </button>
            <button className={"ctl" + (p.repeat !== "off" ? " on" : "")} onClick={p.cycleRepeat} aria-label={"Repeat " + p.repeat}>
              <Icon name={p.repeat === "one" ? "repeat1" : "repeat"} size={26} />
            </button>
          </div>

          <div className="full-row">
            <button className="pill" onClick={p.toggleMode} disabled={!p.hasVideo && p.mode === "audio"}>
              <Icon name="video" size={18} /> {p.mode === "video" ? "Audio only" : "Watch video"}
            </button>
            <button className="pill" onClick={() => p.setPref(p.pref === "auto" ? "embed" : "auto")}>
              Engine: {p.pref === "auto" ? "Auto" : "YouTube"}
            </button>
            <span className="grow" />
            <button
              className={"ic" + (view === "lyrics" ? " on" : "")}
              onClick={() => setView(view === "lyrics" ? "main" : "lyrics")}
              aria-label="Lyrics"
              aria-pressed={view === "lyrics"}
            >
              <Icon name="mic" size={24} />
            </button>
            <button
              className={"ic" + (view === "queue" ? " on" : "")}
              onClick={() => setView(view === "queue" ? "main" : "queue")}
              aria-label="Queue"
              aria-pressed={view === "queue"}
            >
              <Icon name="queue" size={24} />
            </button>
          </div>
          {p.engine === "embed" && (
            <p className="sub small center">Playing via the YouTube player. Ads are blocked only if your browser blocks them (e.g. Brave).</p>
          )}
        </div>
      </div>
    </div>
  );
}
