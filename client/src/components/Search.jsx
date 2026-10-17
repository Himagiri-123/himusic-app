import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useNav } from "../nav.jsx";
import { useSettings } from "../settings.jsx";
import { useDownloads } from "../downloads.jsx";
import { useApp } from "../store.jsx";
import Icon from "./Icon.jsx";
import Cover from "./Cover.jsx";
import SongRow from "./SongRow.jsx";

const CATEGORIES = [
  ["Telugu", "top telugu songs", "#E13300"],
  ["Hindi", "latest hindi songs", "#1E3264"],
  ["Tamil", "top tamil songs", "#8D67AB"],
  ["Devotional", "telugu devotional songs", "#BC5900"],
  ["Podcasts", "telugu podcast", "#006450"],
  ["Genres", "popular music genres mix", "#477D95"],
  ["Moods", "mood songs playlist", "#E8115B"],
  ["Chill", "chill lofi songs", "#503750"],
  ["Party", "party songs dance", "#AF2896"],
  ["Workout", "workout songs", "#B49BC8"],
  ["Romance", "romantic songs", "#D84000"],
  ["Focus", "focus instrumental music", "#608108"],
  ["Melody", "melody hits", "#148A08"],
  ["Hip-Hop", "hip hop songs", "#BA5D07"],
  ["Classical", "classical music", "#8C1932"],
  ["Old is Gold", "evergreen old songs", "#7D4B32"],
];

export default function Search() {
  const nav = useNav();
  const [q, setQ] = useState("");
  const [songs, setSongs] = useState(null);
  const [artists, setArtists] = useState([]);
  const [sugg, setSugg] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const reqId = useRef(0);
  const inputRef = useRef();
  const settings = useSettings();
  const dl = useDownloads();
  const { showToast } = useApp();
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  // voice search (Chrome / Android). Language is chosen in Settings.
  const listen = () => {
    if (!SR) return showToast("Voice search is not supported in this browser");
    if (listening) return recRef.current?.stop();
    const r = new SR();
    r.lang = settings.voiceLang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => setQ(Array.from(e.results).map((x) => x[0].transcript).join(" "));
    r.onerror = (e) => showToast(e.error === "not-allowed" ? "Allow the microphone to use voice search" : e.error === "no-speech" ? "Didn't hear anything" : "Voice search failed");
    r.onend = () => setListening(false);
    recRef.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  };

  // category cards / suggestions from other screens
  useEffect(() => {
    if (nav.pendingQuery) {
      setQ(nav.pendingQuery.text);
      nav.clearQuery();
    }
  }, [nav.pendingQuery]); // eslint-disable-line

  // live search while typing
  useEffect(() => {
    const text = q.trim();
    if (!text) {
      reqId.current++;
      setSongs(null);
      setArtists([]);
      setSugg([]);
      setBusy(false);
      setErr("");
      return;
    }
    const id = ++reqId.current;
    if (settings.offlineOnly) {
      // offline mode: search only inside downloaded songs
      const w = text.toLowerCase();
      setSongs(dl.songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(w)));
      setArtists([]);
      setSugg([]);
      setBusy(false);
      setErr("");
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      setErr("");
      const [s, a, g] = await Promise.allSettled([api.search(text), api.artists(text), api.suggest(text)]);
      if (id !== reqId.current) return;
      setBusy(false);
      if (s.status === "fulfilled") setSongs(s.value.results);
      else {
        setSongs([]);
        setErr(s.reason?.message || "Search failed");
      }
      setArtists(a.status === "fulfilled" ? a.value.results.slice(0, 8) : []);
      setSugg(g.status === "fulfilled" ? g.value.suggestions.filter((x) => x.toLowerCase() !== text.toLowerCase()).slice(0, 6) : []);
    }, 350);
    return () => clearTimeout(t);
  }, [q, settings.offlineOnly, dl.songs]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Search</h1>
      </header>

      <div className="searchbar">
        <Icon name="search" size={24} />
        <input
          ref={inputRef}
          placeholder="What do you want to listen to?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          enterKeyHint="search"
          autoComplete="off"
        />
        {q && (
          <button className="ic" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear">
            <Icon name="close" size={20} />
          </button>
        )}
        <button className={"ic mic" + (listening ? " on" : "")} onClick={listen} aria-label="Voice search">
          <Icon name="mic" size={22} />
        </button>
      </div>

      {!q.trim() && (
        <>
          <h2 className="pad-h">Browse all</h2>
          <div className="cats">
            {CATEGORIES.map(([name, query, color]) => (
              <button key={name} className="cat" style={{ background: color }} onClick={() => setQ(query)}>
                <span>{name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {q.trim() && (
        <div className="results">
          {sugg.length > 0 && (
            <div className="chips">
              {sugg.map((s) => (
                <button key={s} className="chip" onClick={() => setQ(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {artists.length > 0 && (
            <>
              <h2 className="pad-h">Artists</h2>
              <div className="shelf-row">
                {artists.map((a) => (
                  <button key={a.id} className="card artist" onClick={() => nav.push({ type: "artist", artist: a })}>
                    <Cover src={a.thumbnail} round />
                    <div className="card-title center">{a.name}</div>
                    <div className="card-sub center">Artist</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {busy && !songs && <p className="sub center pad">Searching...</p>}
          {err && <div className="error pad">{err}</div>}
          {songs && songs.length > 0 && (
            <>
              <h2 className="pad-h">Songs</h2>
              <div className="list">
                {songs.map((s) => (
                  <SongRow key={s.id} song={s} list={songs} />
                ))}
              </div>
            </>
          )}
          {songs && songs.length === 0 && !busy && !err && <p className="sub center pad">No results for "{q}"</p>}
        </div>
      )}
    </div>
  );
}
