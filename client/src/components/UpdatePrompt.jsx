import { useEffect, useState } from "react";
import { installedVersion, isNative } from "../native.js";

const REPO = import.meta.env.VITE_GITHUB_REPO || ""; // "owner/repo" that publishes the Android APK
export const apkUrl = () =>
  import.meta.env.VITE_APK_URL || (REPO ? `https://github.com/${REPO}/releases/latest/download/HiMusic.apk` : "");

const newer = (a, b) => {
  const x = String(a).replace(/^v/, "").split(".").map(Number), y = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// Popup when a new version of the site is ready, or (Android app) when a newer APK is published.
export default function UpdatePrompt() {
  const [web, setWeb] = useState(false);
  const [apk, setApk] = useState(null); // { version, url }
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const h = () => setWeb(true);
    window.addEventListener("hm-update-ready", h);
    return () => window.removeEventListener("hm-update-ready", h);
  }, []);

  useEffect(() => {
    if (!isNative || !REPO) return;
    (async () => {
      try {
        const have = await installedVersion();
        const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
        if (!have || !r.ok) return;
        const rel = await r.json();
        const asset = (rel.assets || []).find((a) => a.name.endsWith(".apk"));
        if (asset && newer(rel.tag_name, have)) setApk({ version: rel.tag_name, url: asset.browser_download_url });
      } catch {}
    })();
  }, []);

  if (hidden || (!web && !apk)) return null;
  return (
    <div className="modal-bg" style={{ zIndex: 300 }}>
      <div className="modal">
        <h3>{web ? "New version available" : `HiMusic ${apk.version} is out`}</h3>
        <p className="sub center">
          {web ? "Update now to get the latest features and fixes. The app will reload." : "Download the new Android app to update."}
        </p>
        <div className="modal-actions">
          <button className="link" onClick={() => setHidden(true)}>Later</button>
          {web ? (
            <button className="btn-green small" onClick={() => window.__hmUpdate?.(true)}>Update now</button>
          ) : (
            <a className="btn-green small" href={apk.url}>Update</a>
          )}
        </div>
      </div>
    </div>
  );
}
