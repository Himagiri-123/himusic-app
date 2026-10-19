import { useState } from "react";
import { useApp } from "../store.jsx";
import { usePlayer } from "../PlayerContext.jsx";
import { useDownloads } from "../downloads.jsx";
import { EQ_PRESETS, connectionKind, resolveQuality, useSettings } from "../settings.jsx";
import Icon from "./Icon.jsx";
import { isNative } from "../native.js";
import { apkUrl } from "./UpdatePrompt.jsx";
import Diagnostics from "./Diagnostics.jsx";

const Seg = ({ value, options, onChange }) => (
  <div className="seg">
    {options.map(([v, label]) => (
      <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
        {label}
      </button>
    ))}
  </div>
);
const Row = ({ title, hint, children }) => (
  <div className="set-row">
    <div className="set-text">
      <div className="set-title">{title}</div>
      {hint && <div className="sub small">{hint}</div>}
    </div>
    {children}
  </div>
);
const Switch = ({ on, onChange, label }) => (
  <button className={"switch" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
    <i />
  </button>
);

const KIND = { wifi: "Wi-Fi", cellular: "mobile data", saver: "Data Saver is on", unknown: "unknown network" };

export default function Settings() {
  const s = useSettings();
  const { user, logout, setWrappedOpen, setImportOpen } = useApp();
  const p = usePlayer();
  const dl = useDownloads();
  const [diag, setDiag] = useState(false);
  if (!s.open) return null;
  const close = () => s.setOpen(false);
  // Check the release first, so the user sees a clear message instead of GitHub's 404 page
  const downloadApk = async (e) => {
    e.preventDefault();
    const url = apkUrl();
    if (!url) return alert("The Android app link is not set up yet. Add VITE_GITHUB_REPO on Vercel (see README: Android app).");
    const repo = import.meta.env.VITE_GITHUB_REPO;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
      if (r.status === 404)
        return alert(`No APK found for "${repo}".\n\nEither the repo is private / the name is wrong, or the APK has not been built yet.\nOn GitHub: Actions -> "Build Android app" -> Run workflow, then wait until it is green.`);
      const rel = r.ok ? await r.json() : null;
      const asset = rel?.assets?.find((a) => a.name.endsWith(".apk"));
      if (r.ok && !asset) return alert("A release exists but has no HiMusic.apk yet. Check the Actions run for errors.");
      window.location.href = asset?.browser_download_url || url;
    } catch {
      window.location.href = url;
    }
  };
  const kind = connectionKind();
  const q = resolveQuality(s.quality);

  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top">
          <h3 className="sheet-title">Settings</h3>
          <button className="ic" onClick={close} aria-label="Close"><Icon name="close" size={22} /></button>
        </div>
        <div className="sheet-scroll big">
          <Row
            title="Streaming quality"
            hint={
              s.quality === "auto"
                ? `Auto: using ${q === "low" ? "Low (saves data)" : q === "high" ? "High" : "Normal"} on ${KIND[kind]}`
                : "Low uses about half the data of Normal."
            }
          >
            <Seg value={s.quality} onChange={(v) => s.set({ quality: v })} options={[["auto", "Auto"], ["low", "Low"], ["normal", "Normal"], ["high", "High"]]} />
          </Row>

          <Row title="Offline only" hint={`Uses no internet at all. Only your ${dl.items.length} downloaded songs play.`}>
            <Switch on={s.offlineOnly} onChange={(v) => s.set({ offlineOnly: v })} label="Offline only" />
          </Row>

          <Row title="Autoplay similar songs" hint="When your playlist ends, keep playing songs with the same mood.">
            <Switch on={s.autoplay} onChange={(v) => s.set({ autoplay: v })} label="Autoplay" />
          </Row>

          <Row title="Crossfade" hint="Songs blend into each other. Needs the next song to be pre-loaded.">
            <Seg value={s.crossfade} onChange={(v) => s.set({ crossfade: v })} options={[[0, "Off"], [3, "3s"], [6, "6s"], [9, "9s"], [12, "12s"]]} />
          </Row>

          <Row title="Equalizer" hint="Boost bass or vocals. On some phones it can stop playback when the screen is off; turn it off if that happens.">
            <Switch on={s.eqOn} onChange={(v) => s.set({ eqOn: v })} label="Equalizer" />
          </Row>
          {s.eqOn && (
            <div className="set-eq">
              <Seg value={s.eqPreset} onChange={(v) => s.set({ eqPreset: v })} options={Object.entries(EQ_PRESETS).map(([k, v]) => [k, v.label])} />
              <label className="slider-row">
                <span>Extra bass</span>
                <input type="range" min="0" max="12" step="1" value={s.bass} onChange={(e) => s.set({ bass: Number(e.target.value) })} />
                <span className="sub">{s.bass} dB</span>
              </label>
              {p.engine === "embed" && <p className="sub small">The equalizer does not work in the YouTube-player fallback.</p>}
            </div>
          )}

          <Row title="Voice search language">
            <Seg value={s.voiceLang} onChange={(v) => s.set({ voiceLang: v })} options={[["te-IN", "తెలుగు"], ["en-IN", "English"], ["hi-IN", "हिन्दी"]]} />
          </Row>

          <Row title="Player engine" hint="Auto is best. YouTube player is a backup if streaming fails.">
            <Seg value={p.pref} onChange={p.setPref} options={[["auto", "Auto"], ["embed", "YouTube"]]} />
          </Row>

          <button className="sheet-item" onClick={() => { close(); setWrappedOpen(true); }}>
            <Icon name="star" size={24} /> <span>Your HiMusic Wrapped</span>
          </button>
          <button className="sheet-item" onClick={() => { close(); setImportOpen(true); }}>
            <Icon name="importList" size={24} /> <span>Import a playlist (YouTube / Spotify)</span>
          </button>
          {!isNative && (
            <a className="sheet-item" href={apkUrl() || undefined} onClick={downloadApk}>
              <Icon name="install" size={24} /> <span>Download Android App</span>
            </a>
          )}
          <button className="sheet-item" onClick={() => setDiag(true)}>
            <Icon name="star" size={24} /> <span>Playback self-test (troubleshoot)</span>
          </button>
          <p className="sub small set-version">HiMusic v{__APP_VERSION__}{isNative ? " (Android app)" : ""}</p>
          <button className="sheet-item danger" onClick={() => { close(); logout(); }}>
            <Icon name="logout" size={24} /> <span>Log out {user?.email ? `(${user.email})` : ""}</span>
          </button>
        </div>
      </div>
      {diag && <Diagnostics onClose={() => setDiag(false)} />}
    </div>
  );
}
