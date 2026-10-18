import "./install.js"; // must load first: captures the browser's install prompt early
import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";

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

createRoot(document.getElementById("root")).render(<App />);
