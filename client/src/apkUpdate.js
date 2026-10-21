// In-app Android update: checks GitHub Releases, downloads the new APK with a % progress, then opens the installer.
import { useSyncExternalStore } from "react";
import { Installer, installedBuild, isNative } from "./native.js";

const REPO = import.meta.env.VITE_GITHUB_REPO || "";

// release tags look like v1.0.12 or v1.0.0-b12: the last number is the build number (= Android versionCode)
const buildOf = (tag) => {
  const t = String(tag || "");
  const b = /-b(\d+)$/.exec(t);
  if (b) return Number(b[1]);
  const p = t.replace(/^v/, "").split(".");
  return Number(p[2]) || 0;
};

let state = { available: null, phase: "idle", percent: 0, error: "", checked: 0, dismissed: false };
const subs = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const useApkUpdate = () => useSyncExternalStore(subscribe, () => state);
export const dismissApkUpdate = () => set({ dismissed: true });

// returns "update" | "latest" | "error"
export async function checkApkUpdate({ force = false } = {}) {
  if (!isNative || !REPO) return "error";
  if (!force && Date.now() - state.checked < 15 * 60 * 1000) return state.available ? "update" : "latest";
  set({ checked: Date.now() });
  try {
    const have = await installedBuild();
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const rel = await r.json();
    const asset = (rel.assets || []).find((a) => a.name.endsWith(".apk"));
    const latest = buildOf(rel.tag_name);
    if (asset && have && latest > have) {
      set({ available: { version: rel.tag_name, url: asset.browser_download_url, size: asset.size }, dismissed: force ? false : state.dismissed });
      return "update";
    }
    set({ available: null });
    return "latest";
  } catch {
    return "error";
  }
}

export async function startApkUpdate() {
  const a = state.available;
  if (!a || !Installer || state.phase === "downloading") return;
  set({ phase: "downloading", percent: 0, error: "" });
  let h;
  try {
    h = await Installer.addListener("progress", (p) => set({ percent: Math.max(0, p.percent ?? 0) }));
    await Installer.download({ url: a.url });
    set({ phase: "ready", percent: 100 });
    await installApk();
  } catch (e) {
    set({ phase: "idle", error: String(e?.message || e) });
  } finally {
    h?.remove();
  }
}

export async function installApk() {
  try {
    const r = await Installer.install();
    // first time Android asks: "Allow HiMusic to install apps" -> after allowing, tap Install again
    if (r?.needsPermission) set({ phase: "ready", error: "Allow \"Install unknown apps\" for HiMusic in the screen that opened, come back and tap Install." });
  } catch (e) {
    set({ phase: "ready", error: String(e?.message || e) });
  }
}
