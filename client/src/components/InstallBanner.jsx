import { useState } from "react";
import { useInstall } from "../install.js";
import Icon from "./Icon.jsx";

const KEY = "hm_install_dismissed";

// "Install HiMusic" prompt shown at the top of the app until installed or dismissed
export default function InstallBanner() {
  const { installed, canPrompt, showIosTip, install } = useInstall();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  if (installed || hidden || (!canPrompt && !showIosTip)) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };

  return (
    <div className="install">
      <img src="/pwa-192x192.png" alt="" width="40" height="40" />
      <div className="meta">
        <div className="title">Install HiMusic</div>
        <div className="sub">
          {canPrompt ? "Open it like a real app from your home screen" : "Tap Share, then Add to Home Screen"}
        </div>
      </div>
      {canPrompt && (
        <button className="btn-green small" onClick={install}>
          <Icon name="install" size={18} /> Install
        </button>
      )}
      <button className="ic" onClick={dismiss} aria-label="Dismiss">
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}
