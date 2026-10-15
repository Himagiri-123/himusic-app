import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "./store.jsx";

const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

export function PlayerProvider({ children }) {
  const { addHistory } = useApp();
  const mediaRef = useRef(null);
  const queueRef = useRef([]); // upcoming
  const prevRef = useRef([]); // already played
  const relatedRef = useRef([]); // autoplay suggestions
  const playedIds = useRef(new Set());
  const streamRef = useRef(null);
  const modeRef = useRef("audio");
  const errCount = useRef(0);
  const pendingRef = useRef(null);

  const [current, setCurrent] = useState(null);
  const [mode, setModeState] = useState("audio");
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState({ cur: 0, dur: 0 });
  const [expanded, setExpanded] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [queueLen, setQueueLen] = useState(0);

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

  const load = useCallback(
    async (song) => {
      setCurrent(song);
      setLoading(true);
      setError("");
      setTime({ cur: 0, dur: song.duration || 0 });
      playedIds.current.add(song.id);
      try {
        const s = await api.stream(song.id);
        streamRef.current = s;
        relatedRef.current = s.related || [];
        setHasVideo(!!s.videoUrl);
        if (modeRef.current === "video" && !s.videoUrl) {
          modeRef.current = "audio";
          setModeState("audio");
        }
        applySource(s, modeRef.current);
        addHistory(song);
      } catch (e) {
        setError(e.message || "Could not play");
        setPlaying(false);
        if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1200);
      } finally {
        setLoading(false);
      }
    },
    [applySource, addHistory]
  );

  const nextRef = useRef(null);

  const next = useCallback(() => {
    if (current) prevRef.current.push(current);
    let song = queueRef.current.shift();
    if (!song) {
      const idx = relatedRef.current.findIndex((r) => r.id && !playedIds.current.has(r.id));
      if (idx >= 0) song = relatedRef.current[idx];
    }
    setQueueLen(queueRef.current.length);
    if (song) load(song);
    else setPlaying(false);
  }, [current, load]);
  nextRef.current = next;

  const previous = useCallback(() => {
    const el = mediaRef.current;
    if (el && el.currentTime > 4) {
      el.currentTime = 0;
      return;
    }
    const song = prevRef.current.pop();
    if (song) {
      if (current) queueRef.current.unshift(current);
      setQueueLen(queueRef.current.length);
      load(song);
    }
  }, [current, load]);

  // play a song, optionally with the list it came from
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
    const el = mediaRef.current;
    if (!el || !el.src) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  }, []);

  const seek = useCallback((t) => {
    const el = mediaRef.current;
    if (el) el.currentTime = t;
  }, []);

  const toggleMode = useCallback(() => {
    const s = streamRef.current;
    const el = mediaRef.current;
    if (!s || !el) return;
    const target = modeRef.current === "audio" ? "video" : "audio";
    if (target === "video" && !s.videoUrl) {
      setError("Video not available for this song");
      return;
    }
    modeRef.current = target;
    setModeState(target);
    applySource(s, target, el.currentTime);
  }, [applySource]);

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
        playing,
        loading,
        error,
        time,
        expanded,
        hasVideo,
        queueLen,
        setExpanded,
        play,
        toggle,
        next,
        previous,
        seek,
        toggleMode,
      }}
    >
      {children}
      <video
        ref={mediaRef}
        className={showVideo ? "media show" : "media"}
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
          setError(`Playback failed (code ${el.error?.code ?? "?"}). Skipping...`);
          if (errCount.current++ < 3) setTimeout(() => nextRef.current?.(), 1500);
        }}
      />
    </Ctx.Provider>
  );
}
