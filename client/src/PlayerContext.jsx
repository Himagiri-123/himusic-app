import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "./store.jsx";
import { useDownloads } from "./downloads.jsx";
import { useSettings, resolveQuality, connectionKind, EQ_PRESETS } from "./settings.jsx";
import { SILENT_WAV } from "./silent.js";
import { pushEntry, goBack } from "./historyStack.js";
import { isNative, nativeMedia, nativePlayer } from "./native.js";

// Android app: the native engine (ExoPlayer in a foreground service) plays the music so it never depends
// on the WebView. NATIVE_OK is false on the website and in old APKs, which keep using the web player.
let NATIVE_OK = false;
const nativeProbe = nativePlayer ? nativePlayer.available().then((v) => (NATIVE_OK = v)) : Promise.resolve(false);
const withNocap = (u) => (/[?&]nocap=1/.test(u) ? u : u + (u.includes("?") ? "&" : "?") + "nocap=1");
import { cacheGet, cachePut, fetchSong } from "./cache.js";

const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

const shuffleArr = (a) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

// YouTube IFrame Player API loader (fallback engine)
let ytPromise;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytPromise) {
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => {
        ytPromise = null;
        reject(new Error("YouTube player is blocked on this network"));
      };
      document.head.appendChild(s);
      setTimeout(() => {
        if (!window.YT?.Player) {
          ytPromise = null;
          reject(new Error("YouTube player timed out"));
        }
      }, 12000);
    });
  }
  return ytPromise;
}

export function PlayerProvider({ children }) {
  const { addHistory, user, showToast } = useApp();
  const resumeRef = useRef(null); // position to continue from after the app was closed
  const loadRef = useRef(null);
  const lastSave = useRef(0);

  // two media elements: one plays, the other pre-buffers the next song (gapless)
  const elsRef = useRef([null, null]);
  const activeRef = useRef(0);
  const ytHost = useRef(null);
  const ytRef = useRef(null);
  const ytReady = useRef(false);
  const pendingEmbed = useRef(null);

  const userQ = useRef([]); // "Next in queue" (added by the user)
  const ctxQ = useRef([]); // rest of the playlist/album being played
  const contextRef = useRef([]); // the full list that was started
  const prevRef = useRef([]);
  const relatedRef = useRef([]); // autoplay suggestions
  const playedIds = useRef(new Set());
  const streamRef = useRef(null);
  const modeRef = useRef("audio");
  const engineRef = useRef("direct");
  const errCount = useRef(0);
  const pendingRef = useRef(null);
  const loadToken = useRef(0);
  const directFailedAt = useRef(0);
  const nextRef = useRef(null);
  const prefRef = useRef(localStorage.getItem("hm_engine") === "embed" ? "embed" : "auto");
  const shuffleRef = useRef(false);
  const repeatRef = useRef("off");
  const preloadRef = useRef(null);
  const preloadWait = useRef(null); // promise of the next-song download in progress
  const cacheUrls = useRef([]); // object URLs of cached songs (old ones are released)
  const curSource = useRef("net"); // where the playing song comes from: net | cache | local
  const cachingNow = useRef(null);
  const nativeActive = useRef(false); // the current song is playing in the native engine
  const nativeId = useRef(null); // id of the track the native engine is on
  const nativePos = useRef(0);
  const seekHold = useRef({ until: 0, to: 0 }); // ignore stale position ticks right after a seek
  const nativeFailedAt = useRef(0);
  const syncSeq = useRef(0);
  const syncTimer = useRef(null);
  const syncNativeRef = useRef(null);
  const nativeEvRef = useRef({});
  const preloadingId = useRef(null);
  const preloadTried = useRef(false);
  const unlocked = useRef(false);
  const expandedRef = useRef(false);
  const currentRef = useRef(null);
  const lastPos = useRef(0);
  const dl = useDownloads();
  const getLocalRef = useRef(null);
  getLocalRef.current = dl?.getUrl;
  const dlSongsRef = useRef([]);
  dlSongsRef.current = dl?.songs || [];
  const st = useSettings();
  const stRef = useRef(st);
  stRef.current = st;
  const quality = () => resolveQuality(stRef.current.quality);
  const xfading = useRef(false);
  const fadeTimer = useRef(null);
  const sleepTimer = useRef(null);
  const sleepRef = useRef(null);
  const [sleep, setSleepState] = useState(null); // { mode: "time", endAt } | { mode: "song" } | null
  const listened = useRef(0); // seconds actually heard of the current song (for HiMusic Wrapped)
  const lastTick = useRef(0);
  const radioFor = useRef(null);
  const eqRef = useRef(null);

  const [current, setCurrent] = useState(null);
  const [mode, setModeState] = useState("audio");
  const [engine, setEngine] = useState("direct");
  const [pref, setPrefState] = useState(prefRef.current);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState({ cur: 0, dur: 0 });
  const [expanded, setExpanded] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [queue, setQueue] = useState([]);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off");
  const [activeIdx, setActiveIdx] = useState(0);

  currentRef.current = current;

  const getEl = () => elsRef.current[activeRef.current];
  const getIdle = () => elsRef.current[1 - activeRef.current];
  const isActive = (e) => e.currentTarget === getEl();
  // tell the user which song failed and why, instead of silently skipping it
  const failMsg = (why, skipping) => {
    const t = currentRef.current?.title || "This song";
    const m = `"${t}" ${why}.${skipping ? " Moving to the next song..." : ""}`;
    setError(m);
    showToast?.(m);
  };
  const syncSoon = () => {
    if (!nativeActive.current) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => syncNativeRef.current?.(), 250);
  };
  const syncQueue = () => {
    setQueue([...userQ.current, ...ctxQ.current]);
    syncSoon();
  };
  const webCache = () => stRef.current.cacheOn && !NATIVE_OK; // in the app the native cache is used instead
  const canNative = () =>
    NATIVE_OK && modeRef.current === "audio" && prefRef.current !== "embed" && Date.now() - nativeFailedAt.current > 3 * 60 * 1000;
  const blobUrl = (blob) => {
    const u = URL.createObjectURL(blob);
    cacheUrls.current.push(u);
    while (cacheUrls.current.length > 6) URL.revokeObjectURL(cacheUrls.current.shift());
    return u;
  };
  const curTime = () =>
    nativeActive.current
      ? nativePos.current
      : engineRef.current === "embed" ? ytRef.current?.getCurrentTime?.() || 0 : getEl()?.currentTime || 0;

  /* ---------- direct engine ---------- */
  const applySource = useCallback((s, m, resumeAt = 0) => {
    const el = elsRef.current[activeRef.current];
    if (!el || !s) return;
    if (pendingRef.current) pendingRef.current.el.removeEventListener("loadedmetadata", pendingRef.current.fn);
    el.volume = 1;
    if (stRef.current.eqOn) el.crossOrigin = "anonymous"; // needed so the equalizer may process the audio
    else el.removeAttribute("crossorigin");
    el.src = m === "video" && s.videoUrl ? s.videoUrl : s.audioUrl;
    const fn = () => {
      if (resumeAt) el.currentTime = resumeAt;
      el.play().catch(() => {});
    };
    pendingRef.current = { el, fn };
    el.addEventListener("loadedmetadata", fn, { once: true });
    el.load();
    if (stRef.current.eqOn) {
      ensureEq();
      eqRef.current?.ctx.resume?.().catch(() => {});
    }
  }, []); // eslint-disable-line

  /* ---------- equalizer (only created once the user turns it on) ---------- */
  function ensureEq() {
    if (eqRef.current) return eqRef.current;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !elsRef.current[0]) return null;
    try {
      const ctx = new AC();
      const mk = (type, f, q) => {
        const n = ctx.createBiquadFilter();
        n.type = type;
        n.frequency.value = f;
        if (q) n.Q.value = q;
        return n;
      };
      const bass = mk("lowshelf", 120), mid = mk("peaking", 1000, 1), treble = mk("highshelf", 6000);
      bass.connect(mid);
      mid.connect(treble);
      treble.connect(ctx.destination);
      for (const el of elsRef.current) ctx.createMediaElementSource(el).connect(bass);
      eqRef.current = { ctx, bass, mid, treble };
      applyEq();
    } catch {
      eqRef.current = null;
    }
    return eqRef.current;
  }
  function applyEq() {
    const e = eqRef.current;
    if (!e) return;
    const c = stRef.current;
    const p = c.eqOn ? EQ_PRESETS[c.eqPreset] || EQ_PRESETS.flat : EQ_PRESETS.flat;
    e.bass.gain.value = c.eqOn ? p.bass + (c.bass || 0) : 0;
    e.mid.gain.value = p.mid;
    e.treble.gain.value = p.treble;
  }
  const eqKey = `${st.eqOn}|${st.eqPreset}|${st.bass}`;
  useEffect(() => {
    if (st.eqOn && !eqRef.current) {
      // elements must be re-loaded once with CORS enabled before they can be equalized
      if (currentRef.current && engineRef.current === "direct") load(currentRef.current, curTime());
      else for (const el of elsRef.current) el && (el.crossOrigin = "anonymous");
    }
    applyEq();
  }, [eqKey]); // eslint-disable-line
  useEffect(() => {
    const h = () => eqRef.current?.ctx.state === "suspended" && eqRef.current.ctx.resume().catch(() => {});
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  /* ---------- embed engine ---------- */
  const loadEmbed = useCallback(async (song, resumeAt = 0) => {
    const YT = await loadYT();
    for (const el of elsRef.current) {
      if (el) {
        el.pause();
        if (el.getAttribute("src")) {
          el.removeAttribute("src");
          el.load();
        }
      }
    }
    const start = Math.floor(resumeAt);
    if (ytRef.current && ytReady.current) {
      ytRef.current.loadVideoById({ videoId: song.id, startSeconds: start });
      return;
    }
    pendingEmbed.current = { id: song.id, start };
    if (ytRef.current) return;
    await new Promise((resolve) => {
      const holder = document.createElement("div");
      ytHost.current.appendChild(holder);
      ytRef.current = new YT.Player(holder, {
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, playsinline: 1, controls: 0, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            ytReady.current = true;
            const p = pendingEmbed.current;
            pendingEmbed.current = null;
            if (p) ytRef.current.loadVideoById({ videoId: p.id, startSeconds: p.start });
            resolve();
          },
          onStateChange: (e) => {
            const S = window.YT.PlayerState;
            if (e.data === S.PLAYING) {
              setPlaying(true);
              setLoading(false);
              setError("");
              errCount.current = 0;
            } else if (e.data === S.PAUSED) {
              setPlaying(false);
            } else if (e.data === S.ENDED) {
              setPlaying(false);
              handleEnded();
            }
          },
          onError: () => {
            failMsg("can't be played in the YouTube player");
            if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1200);
          },
        },
      });
    });
  }, []); // eslint-disable-line

  /* ---------- gapless preloading ---------- */
  // radio mode: when the playlist is over, find similar songs (same artist / mood) and keep going
  const fillRadio = async () => {
    const cur = currentRef.current;
    if (!cur || radioFor.current === cur.id) return;
    radioFor.current = cur.id;
    try {
      const r = await api.related(cur, [...playedIds.current]);
      const more = (r.results || []).filter((x) => x.id && !playedIds.current.has(x.id));
      if (more.length) relatedRef.current = more;
    } catch {}
  };

  const peekNext = () => {
    if (repeatRef.current === "one") return null;
    return (
      userQ.current[0] ||
      ctxQ.current[0] ||
      relatedRef.current.find((r) => r.id && !playedIds.current.has(r.id)) ||
      null
    );
  };

  const preloadNext = async () => {
    if (engineRef.current !== "direct" || nativeActive.current) return;
    let song = peekNext();
    if (!song && stRef.current.autoplay && !stRef.current.offlineOnly) {
      await fillRadio();
      song = peekNext();
    }
    if (!song || preloadRef.current?.id === song.id || preloadingId.current === song.id) return;
    preloadingId.current = song.id;
    try {
      const local = await getLocalRef.current?.(song.id);
      if (!local && stRef.current.offlineOnly) return;
      let s = local ? { audioUrl: local, videoUrl: null, related: [] } : null;
      let source = local ? "local" : "net";
      if (!s && webCache()) {
        const hit = await cacheGet(song.id);
        if (hit) {
          s = { audioUrl: blobUrl(hit), videoUrl: null, related: [] };
          source = "cache";
        }
      }
      if (!s) {
        s = await api.stream(song.id, quality(), song);
        if (webCache() && modeRef.current !== "video") {
          // one download of the whole song: it is kept for replays and plays from the phone, so it
          // cannot stall in the background or with the screen off
          const job = (async () => {
            try {
              const blob = await fetchSong(s.audioUrl);
              cachePut(song.id, blob, stRef.current.cacheMB);
              s = { ...s, audioUrl: blobUrl(blob), videoUrl: null };
              source = "cache";
            } catch {}
          })();
          preloadWait.current = { id: song.id, p: job };
          await job;
        }
      }
      const still = peekNext();
      const idle = getIdle();
      if (!still || still.id !== song.id || !idle) return;
      idle.volume = 1;
      if (stRef.current.eqOn) idle.crossOrigin = "anonymous";
      else idle.removeAttribute("crossorigin");
      idle.src = modeRef.current === "video" && s.videoUrl ? s.videoUrl : s.audioUrl;
      idle.preload = "auto";
      idle.load();
      preloadRef.current = { id: song.id, stream: s, source };
    } catch {
    } finally {
      preloadingId.current = null;
      preloadWait.current = null;
    }
  };

  // iOS only lets an element play after a user gesture touched it once
  const unlockIdle = () => {
    if (unlocked.current) return;
    unlocked.current = true;
    const idle = getIdle();
    if (!idle) return;
    try {
      idle.src = SILENT_WAV;
      idle.play()?.then(() => idle.pause()).catch(() => {});
    } catch {}
  };

  /* ---------- native engine (Android app) ---------- */
  const leaveWeb = () => {
    if (pendingRef.current) pendingRef.current.el.removeEventListener("loadedmetadata", pendingRef.current.fn);
    pendingRef.current = null;
    preloadRef.current = null;
    clearInterval(fadeTimer.current);
    for (const el of elsRef.current) {
      if (!el || !el.getAttribute("src")) continue;
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {}
    }
  };
  const leaveNative = () => {
    if (!nativeActive.current) return;
    nativeActive.current = false;
    nativeId.current = null;
    clearTimeout(syncTimer.current);
    nativePlayer?.stop();
  };
  const mkTrack = (song, s) => ({
    id: song.id,
    title: song.title || "",
    artist: song.artist || "",
    artwork: song.id ? `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg` : song.thumbnail || "",
    url: withNocap(s.audioUrl),
    q: quality(),
    duration: song.duration || 0,
  });
  const startNative = async (song, s, resumeAt) => {
    leaveWeb();
    try {
      ytRef.current?.stopVideo?.();
    } catch {}
    nativeActive.current = true;
    nativeId.current = song.id;
    nativePos.current = resumeAt || 0;
    await nativePlayer.repeatOne(repeatRef.current === "one");
    await nativePlayer.play([mkTrack(song, s)], Math.round((resumeAt || 0) * 1000));
    engineRef.current = "direct";
    setEngine("direct");
    setPlaying(true);
    setLoading(false);
    syncSoon();
  };
  // next songs for the native queue, so it moves on by itself even with the screen off
  const peekList = (n) => {
    const cur = currentRef.current;
    if (!cur || repeatRef.current === "one" || sleepRef.current?.mode === "song") return [];
    const out = [];
    const seen = new Set([cur.id]);
    const add = (x) => {
      if (x && x.id && !seen.has(x.id) && out.length < n) {
        seen.add(x.id);
        out.push(x);
      }
    };
    userQ.current.forEach(add);
    ctxQ.current.forEach(add);
    if (!out.length && repeatRef.current === "all") contextRef.current.forEach(add);
    if (!out.length && stRef.current.autoplay && !stRef.current.offlineOnly)
      relatedRef.current.filter((r) => !playedIds.current.has(r.id)).forEach(add);
    return out;
  };
  const syncNative = async () => {
    const cur = currentRef.current;
    if (!nativeActive.current || !cur || nativeId.current !== cur.id) return;
    const seq = ++syncSeq.current;
    let cands = peekList(2);
    if (!cands.length && repeatRef.current !== "one" && sleepRef.current?.mode !== "song" && stRef.current.autoplay && !stRef.current.offlineOnly) {
      await fillRadio();
      if (seq !== syncSeq.current) return;
      cands = peekList(2);
    }
    const tracks = [];
    if (!stRef.current.offlineOnly) {
      const res = await Promise.all(
        cands.map(async (song) => {
          try {
            if (await getLocalRef.current?.(song.id)) return null; // saved songs play through the web player
            return mkTrack(song, await api.stream(song.id, quality(), song));
          } catch {
            return null;
          }
        })
      );
      for (const t of res) {
        if (!t) break;
        tracks.push(t);
      }
    }
    if (seq !== syncSeq.current || !nativeActive.current || nativeId.current !== cur.id || currentRef.current?.id !== cur.id) return;
    nativePlayer.upcoming(cur.id, tracks);
  };
  syncNativeRef.current = syncNative;
  const takeById = (id) => {
    let i = userQ.current.findIndex((x) => x.id === id);
    if (i >= 0) return userQ.current.splice(i, 1)[0];
    i = ctxQ.current.findIndex((x) => x.id === id);
    if (i >= 0) {
      const song = ctxQ.current[i];
      ctxQ.current = ctxQ.current.slice(i + 1);
      return song;
    }
    const rel = relatedRef.current.find((x) => x.id === id);
    if (rel) return rel;
    const j = contextRef.current.findIndex((x) => x.id === id);
    if (j >= 0) {
      ctxQ.current = contextRef.current.slice(j + 1);
      return contextRef.current[j];
    }
    return null;
  };
  // the native engine moved on to the next song by itself
  const onNativeAdvance = (id) => {
    const cur = currentRef.current;
    if (!id || cur?.id === id) return;
    const song = takeById(id);
    if (!song) return;
    if (listened.current >= 30 && cur) {
      api.playStat({ id: cur.id, title: cur.title, artist: cur.artist, thumbnail: cur.thumbnail }, Math.round(listened.current)).catch(() => {});
    }
    listened.current = 0;
    if (cur) prevRef.current.push(cur);
    nativeId.current = id;
    nativePos.current = 0;
    playedIds.current.add(id);
    radioFor.current = null;
    currentRef.current = song;
    setCurrent(song);
    setTime({ cur: 0, dur: song.duration || 0 });
    setError("");
    errCount.current = 0;
    addHistory(song);
    syncQueue();
  };
  nativeEvRef.current = {
    state: (d) => {
      if (!nativeActive.current || (d.id && d.id !== currentRef.current?.id)) return;
      setPlaying(!!d.playing || (!!d.wantsPlay && !!d.buffering));
      setLoading(!!d.buffering && !!d.wantsPlay);
      if (d.duration) setTime((t) => ({ ...t, dur: d.duration }));
      if (d.playing) setError("");
    },
    time: (d) => {
      if (!nativeActive.current || (d.id && d.id !== currentRef.current?.id)) return;
      const h = seekHold.current;
      if (Date.now() < h.until && Math.abs((d.position || 0) - h.to) > 2.5) return; // old tick from before the seek
      nativePos.current = d.position || 0;
      setTime({ cur: d.position || 0, dur: d.duration || currentRef.current?.duration || 0 });
      const now = Date.now();
      const dt = (now - lastTick.current) / 1000;
      lastTick.current = now;
      if (d.playing && dt > 0 && dt < 2.5) listened.current += dt;
      if (now - lastSave.current > 3000) {
        lastSave.current = now;
        saveRef.current?.();
      }
    },
    advanced: (d) => nativeActive.current && onNativeAdvance(d.id),
    ended: () => {
      if (!nativeActive.current) return;
      if (sleepRef.current?.mode === "song") {
        setSleep(null);
        setPlaying(false);
        return;
      }
      nativeActive.current = false;
      nativeId.current = null;
      nextRef.current?.();
    },
    error: (d) => {
      if (!nativeActive.current || (d.id && d.id !== currentRef.current?.id)) return;
      // the native engine could not play this song: continue with the web player
      nativeFailedAt.current = Date.now();
      leaveNative();
      if (currentRef.current) loadRef.current?.(currentRef.current, nativePos.current);
    },
  };
  useEffect(() => {
    if (!nativePlayer) return;
    let off = () => {};
    let dead = false;
    nativeProbe.then((ok) => {
      if (!ok || dead) return;
      off = nativePlayer.on({
        state: (d) => nativeEvRef.current.state(d),
        time: (d) => nativeEvRef.current.time(d),
        advanced: (d) => nativeEvRef.current.advanced(d),
        ended: (d) => nativeEvRef.current.ended(d),
        error: (d) => nativeEvRef.current.error(d),
      });
      nativePlayer.stop(); // a fresh page must not inherit a song from an old session
    });
    // while the screen was off the page may have missed events: catch up when it comes back
    const vis = async () => {
      if (document.visibilityState !== "visible" || !nativeActive.current) return;
      const d = await nativePlayer.state();
      if (!d || !d.id) return;
      if (d.id !== currentRef.current?.id) onNativeAdvance(d.id);
      nativeEvRef.current.state({ ...d, wantsPlay: d.playing });
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      dead = true;
      off();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []); // eslint-disable-line
  // cache size chosen in Settings
  useEffect(() => {
    if (!nativePlayer) return;
    nativeProbe.then((ok) => ok && nativePlayer.cacheLimit(st.cacheOn ? st.cacheMB : 0));
  }, [st.cacheOn, st.cacheMB]);

  /* ---------- load a song with the best engine ---------- */
  const load = useCallback(
    async (song, resumeAt = 0, opts = {}) => {
      resumeRef.current = null;
      if (listened.current >= 30 && currentRef.current && currentRef.current.id !== song.id) {
        const c = currentRef.current;
        api.playStat({ id: c.id, title: c.title, artist: c.artist, thumbnail: c.thumbnail }, Math.round(listened.current)).catch(() => {});
      }
      if (currentRef.current?.id !== song.id) listened.current = 0;
      xfading.current = false;
      radioFor.current = null;
      const token = ++loadToken.current;
      if (nativePlayer) await nativeProbe;
      if (token !== loadToken.current) return;
      setCurrent(song);
      currentRef.current = song;
      setLoading(true);
      setError("");
      setTime({ cur: resumeAt, dur: song.duration || 0 });
      playedIds.current.add(song.id);
      preloadTried.current = false;

      // the next song is still downloading in the background: wait a moment instead of fetching it twice
      if (!opts._retry && preloadWait.current?.id === song.id && resumeAt === 0) {
        await Promise.race([preloadWait.current.p, new Promise((r) => setTimeout(r, 4000))]);
        if (token !== loadToken.current) return;
        if (preloadRef.current?.id === song.id) return load(song, resumeAt, { ...opts, _retry: true });
      }

      // gapless: the next song is already buffered in the spare element
      const pre = preloadRef.current;
      if (pre && pre.id === song.id && resumeAt === 0 && engineRef.current === "direct" && prefRef.current !== "embed") {
        preloadRef.current = null;
        const old = getEl();
        const idle = getIdle();
        streamRef.current = pre.stream;
        curSource.current = pre.source || "net";
        relatedRef.current = pre.stream.related || [];
        setHasVideo(!!pre.stream.videoUrl);
        activeRef.current = 1 - activeRef.current;
        setActiveIdx(activeRef.current);
        try {
          idle.currentTime = 0;
        } catch {}
        const fade = opts.fade || 0;
        if (fade) idle.volume = 0;
        idle.play().catch(() => applySource(pre.stream, modeRef.current, 0));
        if (fade) {
          // crossfade: old song fades out while the new one fades in
          clearInterval(fadeTimer.current);
          const t0 = Date.now();
          fadeTimer.current = setInterval(() => {
            const k = Math.min(1, (Date.now() - t0) / (fade * 1000));
            try {
              old.volume = 1 - k;
              idle.volume = k;
            } catch {}
            if (k >= 1) {
              clearInterval(fadeTimer.current);
              try {
                old.pause();
                old.volume = 1;
              } catch {}
            }
          }, 100);
        } else {
          try {
            old.pause();
          } catch {}
        }
        addHistory(song);
        setLoading(false);
        return;
      }

      // saved for offline? play the local copy (works with no internet)
      try {
        const local = await getLocalRef.current?.(song.id);
        if (token !== loadToken.current) return;
        if (local) {
          const s = { audioUrl: local, videoUrl: null, related: [] };
          streamRef.current = s;
          curSource.current = "local";
          relatedRef.current = [];
          setHasVideo(false);
          if (modeRef.current === "video") {
            modeRef.current = "audio";
            setModeState("audio");
          }
          try {
            ytRef.current?.stopVideo?.();
          } catch {}
          leaveNative();
          engineRef.current = "direct";
          setEngine("direct");
          applySource(s, "audio", resumeAt);
          addHistory(song);
          setLoading(false);
          return;
        }
      } catch {}

      if (stRef.current.offlineOnly) {
        setError("This song is not downloaded. Turn off Offline mode to stream it.");
        setPlaying(false);
        setLoading(false);
        return;
      }

      // played before? the smart cache has it: instant start, no data
      if (webCache() && modeRef.current !== "video") {
        try {
          const hit = await cacheGet(song.id);
          if (token !== loadToken.current) return;
          if (hit) {
            const s = { audioUrl: blobUrl(hit), videoUrl: null, related: [] };
            streamRef.current = s;
            curSource.current = "cache";
            relatedRef.current = [];
            setHasVideo(false);
            try {
              ytRef.current?.stopVideo?.();
            } catch {}
            engineRef.current = "direct";
            setEngine("direct");
            applySource(s, "audio", resumeAt);
            addHistory(song);
            setLoading(false);
            return;
          }
        } catch {}
      }

      const skipDirect = prefRef.current === "embed" || Date.now() - directFailedAt.current < 10 * 60 * 1000;

      if (!skipDirect) {
        try {
          const s = await api.stream(song.id, quality(), song);
          if (token !== loadToken.current) return;
          streamRef.current = s;
          curSource.current = "net";
          relatedRef.current = s.related || [];
          setHasVideo(!!s.videoUrl);
          if (modeRef.current === "video" && !s.videoUrl) {
            modeRef.current = "audio";
            setModeState("audio");
          }
          if (canNative()) {
            try {
              await startNative(song, s, resumeAt);
              if (token !== loadToken.current) return;
              curSource.current = "native";
              addHistory(song);
              return;
            } catch {
              nativeFailedAt.current = Date.now();
              leaveNative();
              if (token !== loadToken.current) return;
            }
          }
          leaveNative();
          try {
            ytRef.current?.stopVideo?.();
          } catch {}
          engineRef.current = "direct";
          setEngine("direct");
          applySource(s, modeRef.current, resumeAt);
          addHistory(song);
          setLoading(false);
          return;
        } catch {
          if (token !== loadToken.current) return;
          directFailedAt.current = Date.now();
        }
      }

      leaveNative();
      streamRef.current = null;
      relatedRef.current = [];
      setHasVideo(true);
      engineRef.current = "embed";
      setEngine("embed");
      try {
        await loadEmbed(song, resumeAt);
        if (token !== loadToken.current) return;
        addHistory(song);
      } catch (e) {
        if (token !== loadToken.current) return;
        failMsg(e.message || "could not be loaded");
        setPlaying(false);
        setLoading(false);
      }
    },
    [applySource, addHistory, loadEmbed]
  );

  /* ---------- queue + controls ---------- */
  const popNext = async () => {
    let song = userQ.current.shift() || ctxQ.current.shift();
    if (!song && repeatRef.current === "all" && contextRef.current.length) {
      const list = shuffleRef.current ? shuffleArr(contextRef.current) : contextRef.current.slice();
      song = list.shift();
      ctxQ.current = list;
    }
    if (!song && stRef.current.offlineOnly) {
      // offline mode: only songs saved on this phone
      return dlSongsRef.current.find((s) => !playedIds.current.has(s.id));
    }
    if (!song && !stRef.current.autoplay) return null;
    if (!song) song = relatedRef.current.find((r) => r.id && !playedIds.current.has(r.id));
    const cur = currentRef.current;
    if (!song && cur) {
      await fillRadio();
      song = relatedRef.current.find((r) => r.id && !playedIds.current.has(r.id));
      if (!song) {
        try {
          const r = await api.search(cur.artist || cur.title);
          song = (r.results || []).find((s) => s.id && !playedIds.current.has(s.id));
        } catch {}
      }
    }
    return song;
  };

  const next = useCallback(async (opts) => {
    const cur = currentRef.current;
    if (cur) prevRef.current.push(cur);
    const song = await popNext();
    syncQueue();
    if (song) load(song, 0, { fade: opts?.fade || 0 });
    else setPlaying(false);
  }, [load]); // eslint-disable-line
  nextRef.current = next;
  loadRef.current = load;

  const seek = useCallback((t) => {
    if (nativeActive.current) {
      nativePos.current = t;
      seekHold.current = { until: Date.now() + 1500, to: t };
      nativePlayer.seek(Math.round(t * 1000));
      setTime((x) => ({ ...x, cur: t }));
    } else if (engineRef.current === "embed") {
      ytRef.current?.seekTo?.(t, true);
      setTime((x) => ({ ...x, cur: t }));
    } else {
      const el = elsRef.current[activeRef.current];
      if (el) el.currentTime = t;
    }
  }, []);

  const handleEnded = () => {
    if (sleepRef.current?.mode === "song") {
      // sleep timer: "end of this song"
      setSleep(null);
      setPlaying(false);
      return;
    }
    if (repeatRef.current === "one") {
      if (engineRef.current === "embed") {
        ytRef.current?.seekTo?.(0, true);
        ytRef.current?.playVideo?.();
      } else {
        const el = getEl();
        if (el) {
          el.currentTime = 0;
          el.play().catch(() => {});
        }
      }
      return;
    }
    nextRef.current?.();
  };

  const previous = useCallback(() => {
    if (curTime() > 4) {
      seek(0);
      return;
    }
    const song = prevRef.current.pop();
    if (song) {
      const cur = currentRef.current;
      if (cur) ctxQ.current.unshift(cur);
      syncQueue();
      load(song);
    }
  }, [load, seek]); // eslint-disable-line

  const play = useCallback(
    (song, list = []) => {
      unlockIdle();
      const i = list.findIndex((s) => s.id === song.id);
      contextRef.current = list;
      let rest = i >= 0 ? list.slice(i + 1) : [];
      if (shuffleRef.current) rest = shuffleArr(i >= 0 ? list.filter((s) => s.id !== song.id) : list);
      ctxQ.current = rest;
      prevRef.current = i > 0 && !shuffleRef.current ? list.slice(0, i) : [];
      playedIds.current = new Set();
      preloadRef.current = null;
      syncQueue();
      load(song);
    },
    [load] // eslint-disable-line
  );

  // play a whole list from the start (optionally shuffled)
  const playAll = useCallback(
    (list, { shuffled = false } = {}) => {
      if (!list.length) return;
      if (shuffled !== shuffleRef.current) {
        shuffleRef.current = shuffled;
        setShuffle(shuffled);
      }
      const first = shuffled ? list[Math.floor(Math.random() * list.length)] : list[0];
      play(first, list);
    },
    [play]
  );

  const toggle = useCallback(() => {
    if (resumeRef.current != null && currentRef.current) {
      // app was reopened: start the last song from where it stopped
      const at = resumeRef.current;
      resumeRef.current = null;
      unlockIdle();
      loadRef.current?.(currentRef.current, at);
      return;
    }
    if (nativeActive.current) {
      playingRef.current ? nativePlayer.pause() : nativePlayer.resume();
      return;
    }
    if (engineRef.current === "embed") {
      const p = ytRef.current;
      if (!p?.getPlayerState) return;
      p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo();
      return;
    }
    const el = elsRef.current[activeRef.current];
    if (!el || !el.src) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  }, []);

  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    shuffleRef.current = on;
    setShuffle(on);
    if (on) {
      ctxQ.current = shuffleArr(ctxQ.current);
    } else {
      const cur = currentRef.current;
      const i = cur ? contextRef.current.findIndex((s) => s.id === cur.id) : -1;
      if (i >= 0) ctxQ.current = contextRef.current.slice(i + 1);
    }
    preloadRef.current = null;
    preloadTried.current = false;
    syncQueue();
  }, []); // eslint-disable-line

  const cycleRepeat = useCallback(() => {
    const n = repeatRef.current === "off" ? "all" : repeatRef.current === "all" ? "one" : "off";
    repeatRef.current = n;
    setRepeat(n);
    preloadTried.current = false;
    if (nativeActive.current) {
      nativePlayer.repeatOne(n === "one");
      syncSoon();
    }
  }, []); // eslint-disable-line

  const addToQueue = useCallback(
    (song) => {
      if (!currentRef.current) return play(song, [song]);
      userQ.current.push(song);
      syncQueue();
    },
    [play] // eslint-disable-line
  );
  const playNext = useCallback(
    (song) => {
      if (!currentRef.current) return play(song, [song]);
      userQ.current.unshift(song);
      preloadRef.current = null;
      preloadTried.current = false;
      syncQueue();
    },
    [play] // eslint-disable-line
  );
  const removeFromQueue = useCallback((i) => {
    const u = userQ.current.length;
    if (i < u) userQ.current.splice(i, 1);
    else ctxQ.current.splice(i - u, 1);
    preloadRef.current = null;
    preloadTried.current = false;
    syncQueue();
  }, []); // eslint-disable-line
  const clearQueue = useCallback(() => {
    userQ.current = [];
    ctxQ.current = [];
    preloadRef.current = null;
    syncQueue();
  }, []); // eslint-disable-line
  const playFromQueue = useCallback(
    (i) => {
      const song = [...userQ.current, ...ctxQ.current][i];
      if (!song) return;
      const u = userQ.current.length;
      if (i < u) userQ.current = userQ.current.slice(i + 1);
      else {
        userQ.current = [];
        ctxQ.current = ctxQ.current.slice(i - u + 1);
      }
      const cur = currentRef.current;
      if (cur) prevRef.current.push(cur);
      preloadRef.current = null;
      syncQueue();
      load(song);
    },
    [load] // eslint-disable-line
  );

  const toggleMode = useCallback(() => {
    const target = modeRef.current === "audio" ? "video" : "audio";
    if (engineRef.current === "embed") {
      modeRef.current = target;
      setModeState(target);
      return;
    }
    const s = streamRef.current;
    const el = getEl();
    if (!s || !el) return;
    if (target === "video" && !s.videoUrl) {
      setError("Video not available for this song");
      return;
    }
    const pos = nativeActive.current ? nativePos.current : el.currentTime;
    leaveNative(); // video needs the web player
    modeRef.current = target;
    setModeState(target);
    preloadRef.current = null;
    applySource(s, target, pos);
  }, [applySource]); // eslint-disable-line

  const setPref = useCallback(
    (p) => {
      prefRef.current = p;
      setPrefState(p);
      localStorage.setItem("hm_engine", p);
      if (p === "auto") directFailedAt.current = 0;
      if (currentRef.current) load(currentRef.current, curTime());
    },
    [load] // eslint-disable-line
  );

  /* ---------- sleep timer ---------- */
  const setSleep = useCallback((opt) => {
    clearTimeout(sleepTimer.current);
    if (!opt) {
      sleepRef.current = null;
      setSleepState(null);
      syncSoon();
      return;
    }
    if (opt === "song") {
      sleepRef.current = { mode: "song" };
      setSleepState(sleepRef.current);
      syncSoon();
      return;
    }
    const ms = opt * 60 * 1000;
    sleepRef.current = { mode: "time", endAt: Date.now() + ms };
    setSleepState(sleepRef.current);
    syncSoon();
    sleepTimer.current = setTimeout(() => {
      // fade out over 4 s, then pause
      sleepRef.current = null;
      setSleepState(null);
      if (nativeActive.current) {
        const t1 = Date.now();
        const iv2 = setInterval(() => {
          const k = Math.min(1, (Date.now() - t1) / 4000);
          nativePlayer.volume(1 - k);
          if (k >= 1) {
            clearInterval(iv2);
            nativePlayer.pause();
            nativePlayer.volume(1);
          }
        }, 200);
        return;
      }
      const el = getEl();
      if (engineRef.current === "embed" || !el) {
        ytRef.current?.pauseVideo?.();
        return;
      }
      const t0 = Date.now();
      const iv = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / 4000);
        try {
          el.volume = 1 - k;
        } catch {}
        if (k >= 1) {
          clearInterval(iv);
          el.pause();
          try {
            el.volume = 1;
          } catch {}
        }
      }, 100);
    }, ms);
  }, []); // eslint-disable-line

  /* ---------- full-screen player open/close (back button closes it) ---------- */
  const openFull = useCallback(() => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    setExpanded(true);
    pushEntry(() => {
      expandedRef.current = false;
      setExpanded(false);
    });
  }, []);
  const closeFull = useCallback(() => {
    if (expandedRef.current) goBack();
  }, []);

  // time polling for the YouTube engine
  useEffect(() => {
    if (engine !== "embed") return;
    const t = setInterval(() => {
      const p = ytRef.current;
      if (!p?.getCurrentTime) return;
      setTime({ cur: p.getCurrentTime() || 0, dur: p.getDuration?.() || 0 });
      if (p.getPlayerState?.() === 1) {
        listened.current += 0.5;
        if (Date.now() - lastSave.current > 3000) {
          lastSave.current = Date.now();
          saveRef.current();
        }
      }
    }, 500);
    return () => clearInterval(t);
  }, [engine]);

  /* ---------- resume where you left off (survives closing the app) ---------- */
  const resumeKey = `hm_resume_${user?.id}`;
  const saveResume = () => {
    const c = currentRef.current;
    if (!c || resumeRef.current != null || !user) return;
    try {
      localStorage.setItem(
        resumeKey,
        JSON.stringify({
          song: { id: c.id, title: c.title, artist: c.artist, thumbnail: c.thumbnail, duration: c.duration },
          pos: curTime(),
          queue: [...userQ.current, ...ctxQ.current].slice(0, 40),
        })
      );
    } catch {}
  };
  const saveRef = useRef(saveResume);
  saveRef.current = saveResume;
  useEffect(() => {
    if (!user || currentRef.current) return;
    try {
      const r = JSON.parse(localStorage.getItem(resumeKey) || "null");
      if (!r?.song?.id) return;
      currentRef.current = r.song;
      setCurrent(r.song);
      setTime({ cur: r.pos || 0, dur: r.song.duration || 0 });
      resumeRef.current = r.pos || 0;
      ctxQ.current = r.queue || [];
      contextRef.current = [r.song, ...(r.queue || [])];
      playedIds.current.add(r.song.id);
      syncQueue();
    } catch {}
  }, [user?.id]); // eslint-disable-line
  useEffect(() => {
    const h = () => document.visibilityState === "hidden" && saveRef.current();
    document.addEventListener("visibilitychange", h);
    window.addEventListener("pagehide", h);
    return () => {
      document.removeEventListener("visibilitychange", h);
      window.removeEventListener("pagehide", h);
    };
  }, []);
  useEffect(() => {
    if (!playing) saveRef.current(); // paused: remember the exact spot
  }, [playing]);

  // lock-screen / notification controls
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    // hqdefault (480x360) is sharper than the small list thumbnail, good for lock screens
    const big = current.id ? `https://i.ytimg.com/vi/${current.id}/hqdefault.jpg` : current.thumbnail;
    const art = big
      ? [
          { src: big, sizes: "480x360", type: "image/jpeg" },
          ...(current.thumbnail && current.thumbnail !== big ? [{ src: current.thumbnail, sizes: "320x180", type: "image/jpeg" }] : []),
        ]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title || "",
      artist: current.artist || "",
      album: "HiMusic",
      artwork: art,
    });
    const ms = navigator.mediaSession;
    const set = (a, f) => {
      try {
        ms.setActionHandler(a, f);
      } catch {}
    };
    set("play", toggle);
    set("pause", toggle);
    set("stop", () => {
      const el = getEl();
      if (engineRef.current === "embed") ytRef.current?.pauseVideo?.();
      else el?.pause();
    });
    set("nexttrack", () => nextRef.current?.());
    set("previoustrack", previous);
    set("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    set("seekbackward", () => seek(Math.max(0, curTime() - 10)));
    set("seekforward", () => seek(curTime() + 10));
  }, [current, toggle, previous, seek]); // eslint-disable-line

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  /* ---------- Android app: native notification / lock-screen / Origin island controls ---------- */
  const playingRef = useRef(false);
  playingRef.current = playing;
  const ctlRef = useRef({});
  ctlRef.current = { toggle, previous, seek };
  useEffect(() => {
    if (!isNative) return;
    return nativeMedia.onAction(({ action, position }) => {
      const c = ctlRef.current;
      if (action === "play" && !playingRef.current) c.toggle();
      else if (action === "pause" && playingRef.current) c.toggle();
      else if (action === "next") nextRef.current?.();
      else if (action === "previous") c.previous();
      else if (action === "seek" && position != null) c.seek(position);
    });
  }, []);
  const durRounded = Math.round(time.dur || 0);
  useEffect(() => {
    if (!isNative) return;
    if (nativeActive.current) return; // the native engine drives its own notification
    if (!current) return nativeMedia.stop();
    nativeMedia.update({
      title: current.title || "",
      artist: current.artist || "",
      artwork: current.id ? `https://i.ytimg.com/vi/${current.id}/hqdefault.jpg` : current.thumbnail || "",
      playing,
      position: Math.round(curTime() * 1000),
      duration: Math.round((durRounded || current.duration || 0) * 1000),
    });
  }, [current?.id, playing, durRounded]); // eslint-disable-line

  const showVideo = expanded && mode === "video";

  const onMediaError = (e) => {
    const el = e.currentTarget;
    if (!isActive(e)) {
      preloadRef.current = null;
      return;
    }
    if (!el.getAttribute("src")) return;
    if (modeRef.current === "video" && streamRef.current?.audioUrl) {
      setError("Video failed, switched to audio");
      modeRef.current = "audio";
      setModeState("audio");
      applySource(streamRef.current, "audio", el.currentTime);
      return;
    }
    if (prefRef.current === "auto" && currentRef.current) {
      directFailedAt.current = Date.now();
      load(currentRef.current, el.currentTime);
      return;
    }
    failMsg(`failed to play (error ${el.error?.code ?? "?"})`, true);
    if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 2500);
  };

  const onTimeUpdate = (e) => {
    if (!isActive(e)) return;
    const el = e.currentTarget;
    const d = el.duration;
    setTime({ cur: el.currentTime, dur: d || currentRef.current?.duration || 0 });
    const now = Date.now();
    const dt = (now - lastTick.current) / 1000;
    lastTick.current = now;
    if (!el.paused && dt > 0 && dt < 2.5) listened.current += dt;
    if (now - lastSave.current > 3000) {
      lastSave.current = now;
      saveRef.current();
    }
    if (
      webCache() && curSource.current === "net" && listened.current >= 30 && cachingNow.current !== currentRef.current?.id &&
      engineRef.current === "direct" && modeRef.current === "audio" && streamRef.current?.audioUrl &&
      !["cellular", "saver"].includes(connectionKind())
    ) {
      const id = currentRef.current?.id;
      const url = streamRef.current.audioUrl;
      cachingNow.current = id;
      fetchSong(url)
        .then((blob) => cachePut(id, blob, stRef.current.cacheMB))
        .catch(() => {});
    }
    const xf = stRef.current.crossfade;
    if (
      xf && d && isFinite(d) && d > xf * 3 && d - el.currentTime <= xf + 0.3 && !xfading.current &&
      preloadRef.current && engineRef.current === "direct" && repeatRef.current !== "one" &&
      sleepRef.current?.mode !== "song" && !el.paused
    ) {
      xfading.current = true;
      nextRef.current?.({ fade: xf });
    }
    if (
      d &&
      isFinite(d) &&
      !preloadTried.current &&
      engineRef.current === "direct" &&
      (el.currentTime / d > 0.45 || d - el.currentTime < 75)
    ) {
      preloadTried.current = true;
      preloadNext();
    }
    if ("mediaSession" in navigator && d && isFinite(d) && Date.now() - lastPos.current > 1000) {
      lastPos.current = Date.now();
      try {
        navigator.mediaSession.setPositionState({ duration: d, position: Math.min(el.currentTime, d), playbackRate: 1 });
      } catch {}
    }
  };

  return (
    <Ctx.Provider
      value={{
        current, mode, engine, pref, playing, loading, error, time, expanded, hasVideo,
        queue, shuffle, repeat, expandedRef,
        openFull, closeFull, setPref, play, playAll, toggle, next, previous, seek, toggleMode,
        sleep, setSleep,
        toggleShuffle, cycleRepeat, addToQueue, playNext, removeFromQueue, clearQueue, playFromQueue,
      }}
    >
      {children}
      <div ref={ytHost} className={showVideo && engine === "embed" ? "yt show" : "yt"} />
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={(el) => (elsRef.current[i] = el)}
          className={"media" + (i === activeIdx && showVideo && engine === "direct" ? " show" : "")}
          playsInline
          preload="auto"
          controls={false}
          referrerPolicy="no-referrer"
          onPlaying={(e) => {
            if (!isActive(e)) return;
            errCount.current = 0;
            setError("");
            setLoading(false);
          }}
          onPlay={(e) => isActive(e) && setPlaying(true)}
          onPause={(e) => isActive(e) && setPlaying(false)}
          onEnded={(e) => isActive(e) && handleEnded()}
          onTimeUpdate={onTimeUpdate}
          onError={onMediaError}
        />
      ))}
    </Ctx.Provider>
  );
}
