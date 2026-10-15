import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "./store.jsx";

const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

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
  const mediaRef = useRef(null); // <video> used by the direct engine
  const ytHost = useRef(null); // container for the YouTube iframe
  const ytRef = useRef(null);
  const ytReady = useRef(false);
  const pendingEmbed = useRef(null);

  const queueRef = useRef([]); // upcoming
  const prevRef = useRef([]); // already played
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

  const [current, setCurrent] = useState(null);
  const [mode, setModeState] = useState("audio");
  const [engine, setEngine] = useState("direct"); // what is playing right now
  const [pref, setPrefState] = useState(prefRef.current); // auto | embed
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState({ cur: 0, dur: 0 });
  const [expanded, setExpanded] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [queueLen, setQueueLen] = useState(0);

  const curTime = () =>
    engineRef.current === "embed"
      ? ytRef.current?.getCurrentTime?.() || 0
      : mediaRef.current?.currentTime || 0;

  /* ---------- direct engine (our own audio player) ---------- */
  const applySource = useCallback((s, m, resumeAt = 0) => {
    const el = mediaRef.current;
    if (!el || !s) return;
    if (pendingRef.current) el.removeEventListener("loadedmetadata", pendingRef.current);
    el.src = m === "video" && s.videoUrl ? s.videoUrl : s.audioUrl;
    const start = () => {
      if (resumeAt) el.currentTime = resumeAt;
      el.play().catch(() => {});
    };
    pendingRef.current = start;
    el.addEventListener("loadedmetadata", start, { once: true });
    el.load();
  }, []);

  /* ---------- embed engine (YouTube IFrame player) ---------- */
  const loadEmbed = useCallback(async (song, resumeAt = 0) => {
    const YT = await loadYT();
    const el = mediaRef.current;
    if (el) {
      el.pause();
      if (el.getAttribute("src")) {
        el.removeAttribute("src");
        el.load();
      }
    }
    const start = Math.floor(resumeAt);
    if (ytRef.current && ytReady.current) {
      ytRef.current.loadVideoById({ videoId: song.id, startSeconds: start });
      return;
    }
    pendingEmbed.current = { id: song.id, start };
    if (ytRef.current) return; // created, waiting for onReady
    await new Promise((resolve) => {
      const holder = document.createElement("div");
      ytHost.current.appendChild(holder);
      ytRef.current = new YT.Player(holder, {
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
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
              nextRef.current?.();
            }
          },
          onError: () => {
            setError("This song can't be played in the YouTube player. Skipping...");
            if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1200);
          },
        },
      });
    });
  }, []);

  /* ---------- load a song with the best engine ---------- */
  const load = useCallback(
    async (song, resumeAt = 0) => {
      const token = ++loadToken.current;
      setCurrent(song);
      setLoading(true);
      setError("");
      setTime({ cur: resumeAt, dur: song.duration || 0 });
      playedIds.current.add(song.id);

      const skipDirect =
        prefRef.current === "embed" || Date.now() - directFailedAt.current < 10 * 60 * 1000;

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
          directFailedAt.current = Date.now(); // go straight to YouTube player for a while
        }
      }

      // YouTube player fallback
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

  /* ---------- controls ---------- */
  const next = useCallback(async () => {
    const cur = current;
    if (cur) prevRef.current.push(cur);
    let song = queueRef.current.shift();
    if (!song) song = relatedRef.current.find((r) => r.id && !playedIds.current.has(r.id));
    if (!song && cur) {
      // no related list (YouTube player engine): find more by the same artist
      try {
        const r = await api.search(cur.artist || cur.title);
        const more = (r.results || []).filter((s) => s.id && !playedIds.current.has(s.id));
        song = more[0];
        queueRef.current = more.slice(1, 15);
      } catch {}
    }
    setQueueLen(queueRef.current.length);
    if (song) load(song);
    else setPlaying(false);
  }, [current, load]);
  nextRef.current = next;

  const seek = useCallback((t) => {
    if (engineRef.current === "embed") {
      ytRef.current?.seekTo?.(t, true);
      setTime((x) => ({ ...x, cur: t }));
    } else if (mediaRef.current) {
      mediaRef.current.currentTime = t;
    }
  }, []);

  const previous = useCallback(() => {
    if (curTime() > 4) {
      seek(0);
      return;
    }
    const song = prevRef.current.pop();
    if (song) {
      if (current) queueRef.current.unshift(current);
      setQueueLen(queueRef.current.length);
      load(song);
    }
  }, [current, load, seek]);

  const play = useCallback(
    (song, list = []) => {
      const i = list.findIndex((s) => s.id === song.id);
      queueRef.current = i >= 0 ? list.slice(i + 1) : [];
      prevRef.current = i > 0 ? list.slice(0, i) : [];
      playedIds.current = new Set();
      setQueueLen(queueRef.current.length);
      load(song);
    },
    [load]
  );

  const toggle = useCallback(() => {
    if (engineRef.current === "embed") {
      const p = ytRef.current;
      if (!p?.getPlayerState) return;
      p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo();
      return;
    }
    const el = mediaRef.current;
    if (!el || !el.src) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  }, []);

  const toggleMode = useCallback(() => {
    const target = modeRef.current === "audio" ? "video" : "audio";
    if (engineRef.current === "embed") {
      modeRef.current = target; // just show/hide the YouTube player
      setModeState(target);
      return;
    }
    const s = streamRef.current;
    const el = mediaRef.current;
    if (!s || !el) return;
    if (target === "video" && !s.videoUrl) {
      setError("Video not available for this song");
      return;
    }
    modeRef.current = target;
    setModeState(target);
    applySource(s, target, el.currentTime);
  }, [applySource]);

  // Engine preference: auto (direct, falls back to YouTube) or always YouTube player
  const setPref = useCallback(
    (p) => {
      prefRef.current = p;
      setPrefState(p);
      localStorage.setItem("hm_engine", p);
      if (p === "auto") directFailedAt.current = 0;
      if (current) load(current, curTime());
    },
    [current, load]
  );

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

  // Media Session (lock screen / notification controls)
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title || "",
      artist: current.artist || "",
      artwork: current.thumbnail ? [{ src: current.thumbnail, sizes: "512x512" }] : [],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", toggle);
    ms.setActionHandler("pause", toggle);
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("previoustrack", previous);
    ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
  }, [current, toggle, next, previous, seek]);

  const showVideo = expanded && mode === "video";

  return (
    <Ctx.Provider
      value={{
        current,
        mode,
        engine,
        pref,
        playing,
        loading,
        error,
        time,
        expanded,
        hasVideo,
        queueLen,
        setExpanded,
        setPref,
        play,
        toggle,
        next,
        previous,
        seek,
        toggleMode,
      }}
    >
      {children}
      <div ref={ytHost} className={showVideo && engine === "embed" ? "yt show" : "yt"} />
      <video
        ref={mediaRef}
        className={showVideo && engine === "direct" ? "media show" : "media"}
        playsInline
        preload="auto"
        controls={false}
        referrerPolicy="no-referrer"
        onPlaying={() => {
          errCount.current = 0;
          setError("");
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => nextRef.current?.()}
        onTimeUpdate={(e) =>
          setTime({
            cur: e.currentTarget.currentTime,
            dur: e.currentTarget.duration || current?.duration || 0,
          })
        }
        onError={(e) => {
          const el = e.currentTarget;
          if (!el.getAttribute("src")) return;
          // video failed -> fall back to audio at the same position
          if (modeRef.current === "video" && streamRef.current?.audioUrl) {
            setError("Video failed, switched to audio");
            modeRef.current = "audio";
            setModeState("audio");
            applySource(streamRef.current, "audio", el.currentTime);
            return;
          }
          // direct stream failed -> switch this song to the YouTube player
          if (prefRef.current === "auto" && current) {
            directFailedAt.current = Date.now();
            load(current, el.currentTime);
            return;
          }
          setError(`Playback failed (code ${el.error?.code ?? "?"}). Skipping...`);
          if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1500);
        }}
      />
    </Ctx.Provider>
  );
}
