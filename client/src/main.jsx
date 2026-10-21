import "./install.js"; // must load first: captures the browser's install prompt early
import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import { isNative } from "./native.js";
import { API_BASE } from "./api.js";
import "./styles.css";

// Wake the (free) server early so the first song does not wait for a cold start.
const ping = () => fetch(`${API_BASE}/`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
ping();
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && ping());

if (isNative) {
  // The Android app always loads the live site, so a service worker only causes stale versions.
  // Remove any worker/caches left by older versions of the app.
  navigator.serviceWorker?.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  window.caches?.keys?.().then((ks) => ks.forEach((k) => window.caches.delete(k))).catch(() => {});
  window.__hmUpdate = () => location.reload();
} else {
  // New version found -> UpdatePrompt shows "Update now". Also re-check on open / every 20 min.
  window.__hmUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event("hm-update-ready"));
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => navigator.onLine && reg.update().catch(() => {});
      setInterval(check, 20 * 60 * 1000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    },
  });
}

createRoot(document.getElementById("root")).render(<App />);
