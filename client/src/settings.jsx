import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Device-level preferences (kept in this browser only)
const KEY = "hm_settings";
export const EQ_PRESETS = {
  flat: { label: "Flat", bass: 0, mid: 0, treble: 0 },
  bass: { label: "Bass boost", bass: 8, mid: 0, treble: 1 },
  vocal: { label: "Vocal", bass: -2, mid: 4, treble: 2 },
  treble: { label: "Treble", bass: 0, mid: 0, treble: 7 },
};
const DEF = {
  quality: "auto", // auto | low | normal | high
  autoplay: true, // keep playing similar songs when the queue ends (radio)
  crossfade: 0, // seconds, 0 = off
  eqOn: false,
  eqPreset: "flat",
  bass: 0, // extra bass dB (0-12) on top of the preset
  offlineOnly: false,
  voiceLang: "te-IN",
};

const read = () => {
  try {
    return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEF;
  }
};

// what "Auto" means right now: mobile data -> low, Wi-Fi/ethernet -> high, unknown -> normal
export function connectionKind() {
  const c = navigator.connection;
  if (!c) return "unknown";
  if (c.saveData) return "saver";
  if (c.type === "cellular") return "cellular";
  if (c.type === "wifi" || c.type === "ethernet") return "wifi";
  if (["slow-2g", "2g", "3g"].includes(c.effectiveType)) return "cellular";
  return "unknown";
}
export function resolveQuality(q) {
  if (q !== "auto") return q;
  const k = connectionKind();
  return k === "wifi" ? "high" : k === "cellular" || k === "saver" ? "low" : "normal";
}

const Ctx = createContext(null);
export const useSettings = () => useContext(Ctx);

export function SettingsProvider({ children }) {
  const [s, setS] = useState(read);
  const [open, setOpen] = useState(false);
  const set = useCallback((patch) => {
    setS((o) => {
      const n = { ...o, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
  }, []);
  // api.js reads this flag to refuse network calls while "Offline only" is on
  useEffect(() => {
    window.__hmOffline = !!s.offlineOnly;
  }, [s.offlineOnly]);
  const value = useMemo(() => ({ ...s, set, open, setOpen }), [s, set, open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
