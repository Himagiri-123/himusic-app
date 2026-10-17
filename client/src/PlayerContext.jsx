import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "./store.jsx";
import { useDownloads } from "./downloads.jsx";
import { SILENT_WAV } from "./silent.js";
import { pushEntry, goBack } from "./historyStack.js";

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
  const { addHistory } = useApp();

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
  const preloadingId = useRef(null);
  const preloadTried = useRef(false);
  const unlocked = useRef(false);
  const expandedRef = useRef(false);
  const currentRef = useRef(null);
  const lastPos = useRef(0);
  const dl = useDownloads();
  const getLocalRef = useRef(null);
  getLocalRef.current = dl?.getUrl;

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
  const syncQueue = () => setQueue([...userQ.current, ...ctxQ.current]);
  const curTime = () =>
    engineRef.current === "embed" ? ytRef.current?.getCurrentTime?.() || 0 : getEl()?.currentTime || 0;

  /* ---------- direct engine ---------- */
  const applySource = useCallback((s, m, resumeAt = 0) => {
    const el = elsRef.current[activeRef.current];
    if (!el || !s) return;
    if (pendingRef.current) pendingRef.current.el.removeEventListener("loadedmetadata", pendingRef.current.fn);
    el.src = m === "video" && s.videoUrl ? s.videoUrl : s.audioUrl;
    const fn = () => {
      if (resumeAt) el.currentTime = resumeAt;
      el.play().catch(() => {});
    };
    pendingRef.current = { el, fn };
    el.addEventListener("loadedmetadata", fn, { once: true });
    el.load();
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
            setError("This song can't be played in the YouTube player. Skipping...");
            if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1200);
          },
        },
      });
    });
  }, []); // eslint-disable-line

  /* ---------- gapless preloading ---------- */
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
    if (engineRef.current !== "direct") return;
    const song = peekNext();
    if (!song || preloadRef.current?.id === song.id || preloadingId.current === song.id) return;
    preloadingId.current = song.id;
    try {
      const s = await api.stream(song.id);
      const still = peekNext();
      const idle = getIdle();
      if (!still || still.id !== song.id || !idle) return;
      idle.src = modeRef.current === "video" && s.videoUrl ? s.videoUrl : s.audioUrl;
      idle.preload = "auto";
      idle.load();
      preloadRef.current = { id: song.id, stream: s };
    } catch {
    } finally {
      preloadingId.current = null;
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

  /* ---------- load a song with the best engine ---------- */
  const load = useCallback(
    async (song, resumeAt = 0) => {
      const token = ++loadToken.current;
      setCurrent(song);
      currentRef.current = song;
      setLoading(true);
      setError("");
      setTime({ cur: resumeAt, dur: song.duration || 0 });
      playedIds.current.add(song.id);
      preloadTried.current = false;

      // gapless: the next song is already buffered in the spare element
      const pre = preloadRef.current;
      if (pre && pre.id === song.id && resumeAt === 0 && engineRef.current === "direct" && prefRef.current !== "embed") {
        preloadRef.current = null;
        const old = getEl();
        const idle = getIdle();
        streamRef.current = pre.stream;
        relatedRef.current = pre.stream.related || [];
        setHasVideo(!!pre.stream.videoUrl);
        activeRef.current = 1 - activeRef.current;
        setActiveIdx(activeRef.current);
        try {
          idle.currentTime = 0;
        } catch {}
        idle.play().catch(() => applySource(pre.stream, modeRef.current, 0));
        try {
          old.pause();
        } catch {}
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
          relatedRef.current = [];
          setHasVideo(false);
          if (modeRef.current === "video") {
            modeRef.current = "audio";
            setModeState("audio");
          }
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

      const skipDirect = prefRef.current === "embed" || Date.now() - directFailedAt.current < 10 * 60 * 1000;

      if (!skipDirect) {
        try {
          const s = await api.stream(song.id);
          if (token !== loadToken.current) return;
          streamRef.current = s;
          relatedRef.current = s.related || [];
          setHasVideo(!!s.videoUrl);
          if (modeRef.current === "video" && !s.videoUrl) {
            modeRef.current = "audio";
            setModeState("audio");
          }
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
        setError(e.message || "Could not load the YouTube player");
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
    if (!song) song = relatedRef.current.find((r) => r.id && !playedIds.current.has(r.id));
    const cur = currentRef.current;
    if (!song && cur) {
      try {
        const r = await api.search(cur.artist || cur.title);
        const more = (r.results || []).filter((s) => s.id && !playedIds.current.has(s.id));
        song = more[0];
        ctxQ.current = more.slice(1, 15);
      } catch {}
    }
    return song;
  };

  const next = useCallback(async () => {
    const cur = currentRef.current;
    if (cur) prevRef.current.push(cur);
    const song = await popNext();
    syncQueue();
    if (song) load(song);
    else setPlaying(false);
  }, [load]); // eslint-disable-line
  nextRef.current = next;

  const seek = useCallback((t) => {
    if (engineRef.current === "embed") {
      ytRef.current?.seekTo?.(t, true);
      setTime((x) => ({ ...x, cur: t }));
    } else {
      const el = elsRef.current[activeRef.current];
      if (el) el.currentTime = t;
    }
  }, []);

  const handleEnded = () => {
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
  }, []);

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
    modeRef.current = target;
    setModeState(target);
    preloadRef.current = null;
    applySource(s, target, el.currentTime);
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
    }, 500);
    return () => clearInterval(t);
  }, [engine]);

  // lock-screen / notification controls
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    const art = current.thumbnail
      ? [96, 192, 256, 384, 512].map((n) => ({ src: current.thumbnail, sizes: `${n}x${n}` }))
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
    set("nexttrack", () => nextRef.current?.());
    set("previoustrack", previous);
    set("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    set("seekbackward", () => seek(Math.max(0, curTime() - 10)));
    set("seekforward", () => seek(curTime() + 10));
  }, [current, toggle, previous, seek]); // eslint-disable-line

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

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
    setError(`Playback failed (code ${el.error?.code ?? "?"}). Skipping...`);
    if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1500);
  };

  const onTimeUpdate = (e) => {
    if (!isActive(e)) return;
    const el = e.currentTarget;
    const d = el.duration;
    setTime({ cur: el.currentTime, dur: d || currentRef.current?.duration || 0 });
    if (
      d &&
      isFinite(d) &&
      !preloadTried.current &&
      engineRef.current === "direct" &&
      (el.currentTime / d > 0.6 || d - el.currentTime < 45)
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
