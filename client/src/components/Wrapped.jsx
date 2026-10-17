import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store.jsx";
import { cleanArtist } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STEP = 5200; // ms per slide

// Spotify-Wrapped-style story: tap right/left to move, auto-advances
export default function Wrapped() {
  const { wrappedOpen, setWrappedOpen } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(0);
  const year = new Date().getFullYear();
  const timer = useRef();

  useEffect(() => {
    if (!wrappedOpen) return;
    setData(null);
    setErr("");
    setI(0);
    api.wrapped(year).then(setData).catch((e) => setErr(e.message));
  }, [wrappedOpen, year]);

  const slides = data && data.plays > 0 ? build(data, year) : [];

  useEffect(() => {
    clearTimeout(timer.current);
    if (!slides.length) return;
    timer.current = setTimeout(() => setI((n) => Math.min(n + 1, slides.length - 1)), STEP);
    return () => clearTimeout(timer.current);
  }, [i, slides.length]);

  if (!wrappedOpen) return null;
  const close = () => setWrappedOpen(false);
  const tap = (e) => {
    const x = e.clientX / window.innerWidth;
    setI((n) => (x < 0.3 ? Math.max(0, n - 1) : Math.min(slides.length - 1, n + 1)));
  };

  return (
    <div className="wrapped">
      <button className="ic wrapped-x" onClick={close} aria-label="Close"><Icon name="close" size={26} /></button>
      {!data && !err && <p className="wrapped-msg">Getting your year...</p>}
      {err && <p className="wrapped-msg">{err}</p>}
      {data && !slides.length && (
        <p className="wrapped-msg">
          Nothing to show yet. Listen to a few songs (30 seconds or more each) and come back — your {year} Wrapped will build up here.
        </p>
      )}
      {slides.length > 0 && (
        <div className="wrapped-stage" onClick={tap}>
          <div className="wrapped-bars">
            {slides.map((_, k) => (
              <span key={k}><i className={k < i ? "full" : k === i ? "run" : ""} style={k === i ? { animationDuration: STEP + "ms" } : undefined} /></span>
            ))}
          </div>
          <div className={"wrapped-slide s" + (i % 5)} key={i}>{slides[i]}</div>
        </div>
      )}
    </div>
  );
}

function build(d, year) {
  const top = d.topSongs[0];
  const art = d.topArtists[0];
  const out = [
    <>
      <p className="w-small">Your {year}</p>
      <h1 className="w-big">HiMusic<br />Wrapped</h1>
      <p className="w-small">Let's see what you played.</p>
    </>,
    <>
      <p className="w-small">You listened for</p>
      <h1 className="w-huge pop-in">{d.minutes.toLocaleString()}</h1>
      <p className="w-small">minutes across {d.plays.toLocaleString()} plays and {d.uniqueSongs.toLocaleString()} different songs.</p>
    </>,
  ];
  if (top)
    out.push(
      <>
        <p className="w-small">Your top song</p>
        <Cover src={top.thumbnail} size={200} className="pop-in" />
        <h2 className="w-title">{top.title}</h2>
        <p className="w-small">{cleanArtist(top.artist)} · {top.plays} plays</p>
      </>
    );
  if (art)
    out.push(
      <>
        <p className="w-small">Your top artist</p>
        <Cover src={art.thumbnail} size={200} round className="pop-in" />
        <h2 className="w-title">{cleanArtist(art.name)}</h2>
        <p className="w-small">{art.plays} plays</p>
      </>
    );
  out.push(
    <>
      <p className="w-small">Your top 5 songs</p>
      <ol className="w-list">
        {d.topSongs.map((s, k) => (
          <li key={s.id} style={{ animationDelay: k * 0.18 + "s" }}>
            <b>{k + 1}</b>
            <span>{s.title}<small>{cleanArtist(s.artist)}</small></span>
          </li>
        ))}
      </ol>
    </>
  );
  if (d.topMonth)
    out.push(
      <>
        <p className="w-small">You listened the most in</p>
        <h1 className="w-big pop-in">{MONTHS[d.topMonth - 1]}</h1>
      </>
    );
  out.push(
    <>
      <p className="w-small">That's your year in music</p>
      <h1 className="w-big">Keep the<br />music going</h1>
    </>
  );
  return out;
}
