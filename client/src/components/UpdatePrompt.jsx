import { useEffect, useState } from "react";
import { isNative } from "../native.js";
import { checkApkUpdate, dismissApkUpdate, installApk, startApkUpdate, useApkUpdate } from "../apkUpdate.js";

const REPO = import.meta.env.VITE_GITHUB_REPO || ""; // "owner/repo" that publishes the Android APK
export const apkUrl = () =>
  import.meta.env.VITE_APK_URL || (REPO ? `https://github.com/${REPO}/releases/latest/download/HiMusic.apk` : "");

// Popup when a new version of the site is ready, or (Android app) when a newer APK is published.
export default function UpdatePrompt() {
  const [web, setWeb] = useState(false);
  const apk = useApkUpdate();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const h = () => setWeb(true);
    window.addEventListener("hm-update-ready", h);
    return () => window.removeEventListener("hm-update-ready", h);
  }, []);

  // look for a newer APK when the app opens and every time it comes back to the front
  useEffect(() => {
    if (!isNative) return;
    checkApkUpdate();
    const h = () => document.visibilityState === "visible" && checkApkUpdate();
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  const showApk = isNative && apk.available && !apk.dismissed;
  if (hidden && !showApk) return null;
  if (!web && !showApk) return null;
  if (!web && showApk) {
    const busy = apk.phase === "downloading";
    const size = apk.available.size ? ` (${(apk.available.size / 1048576).toFixed(0)} MB)` : "";
    return (
      <div className="modal-bg" style={{ zIndex: 300 }}>
        <div className="modal">
          <h3>Update available</h3>
          <p className="sub center">
            {busy ? "Downloading the new version..." : apk.phase === "ready" ? "Downloaded. Tap Install to finish." : `HiMusic ${apk.available.version}${size} is ready.`}
          </p>
          {(busy || apk.phase === "ready") && (
            <div className="upd-bar" aria-label="progress">
              <i style={{ width: `${apk.percent}%` }} />
              <span>{busy ? `${apk.percent}%` : "100%"}</span>
            </div>
          )}
          {apk.error && <p className="sub small center" style={{ color: "#ff8a8a" }}>{apk.error}</p>}
          <div className="modal-actions">
            {!busy && <button className="link" onClick={dismissApkUpdate}>Later</button>}
            {apk.phase === "ready" ? (
              <button className="btn-green small" onClick={installApk}>Install</button>
            ) : (
              <button className="btn-green small" disabled={busy} onClick={startApkUpdate}>{busy ? "Downloading..." : "Update"}</button>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="modal-bg" style={{ zIndex: 300 }}>
      <div className="modal">
        <h3>New version available</h3>
        <p className="sub center">Update now to get the latest features and fixes. The app will reload.</p>
        <div className="modal-actions">
          <button className="link" onClick={() => setHidden(true)}>Later</button>
          <button className="btn-green small" onClick={() => window.__hmUpdate?.(true)}>Update now</button>
        </div>
      </div>
    </div>
  );
}
