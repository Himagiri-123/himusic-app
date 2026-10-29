// Bridge to the Android app shell (Capacitor). On the normal website these are all no-ops.
import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
const MC = isNative ? registerPlugin("MediaControls") : null;
const AppPlugin = isNative ? registerPlugin("App") : null;
export const Installer = isNative ? registerPlugin("ApkInstaller") : null;
const LocalPlugin = isNative ? registerPlugin("LocalMusic") : null;
// music files stored on the phone (asks for permission the first time)
export const scanLocalMusic = () => (LocalPlugin ? LocalPlugin.scan() : Promise.reject(new Error("Local music works in the Android app")));

export const nativeMedia = {
  // show / update the notification + lock-screen controls (title, artist, artwork, play state, position)
  update(info) {
    MC?.update(info).catch(() => {});
  },
  stop() {
    MC?.stop().catch(() => {});
  },
  // heart on the notification / lock screen
  setLiked(liked) {
    MC?.setLiked?.({ liked: !!liked })?.catch?.(() => {});
  },
  onAction(cb) {
    let h;
    MC?.addListener("action", cb).then((x) => (h = x));
    return () => h?.remove();
  },
};

// self-test: can this phone find the YouTube audio address of a song by itself?
export const nativeResolveTest = (id) => (MC?.resolveTest ? MC.resolveTest({ id }).then((r) => r?.result || "").catch((e) => "FAIL " + (e?.message || e)) : Promise.resolve("not in this app version"));

export const requestBattery = () => (MC ? MC.requestBattery().catch(() => {}) : Promise.resolve());
export const nativeStatus = () => (MC ? MC.status().catch((e) => ({ error: String(e?.message || e) })) : Promise.resolve(null));

// The Android app plays music with its own native engine (ExoPlayer), outside the WebView.
// On the website, or in an older APK without the engine, available() is false and the normal player is used.
const EVENTS = ["state", "time", "advanced", "ended", "error", "skip"];
export const nativePlayer = isNative
  ? {
      available: () => MC.playerPing().then((r) => !!r?.ok).catch(() => false),
      play: (tracks, startMs = 0) => MC.playerPlay({ tracks, startMs }),
      upcoming: (afterId, tracks) => MC.playerUpcoming({ afterId, tracks }).catch(() => {}),
      next: () => MC.playerNext().then((r) => !!r?.ok).catch(() => false),
      pause: () => MC.playerPause().catch(() => {}),
      resume: () => MC.playerResume().catch(() => {}),
      seek: (ms) => MC.playerSeek({ ms }).catch(() => {}),
      volume: (v) => MC.playerVolume({ v }).catch(() => {}),
      repeatOne: (on) => MC.playerRepeatOne({ on }).catch(() => {}),
      stop: () => MC.playerStop().catch(() => {}),
      state: () => MC.playerState().catch(() => null),
      cacheInfo: () => MC.cacheInfo().catch(() => null),
      cacheLimit: (mb) => MC.cacheLimit({ mb }).catch(() => {}),
      cacheClear: () => MC.cacheClear().catch(() => {}),
      // handlers = { state, time, advanced, ended, error }; returns a function that removes them
      on(handlers) {
        const subs = [];
        for (const e of EVENTS) if (handlers[e]) MC.addListener("p_" + e, (d) => handlers[e](d || {})).then((h) => subs.push(h));
        return () => subs.forEach((h) => h.remove());
      },
    }
  : null;

export async function installedBuild() {
  try {
    return Number((await AppPlugin.getInfo()).build) || 0;
  } catch {
    return 0;
  }
}

export async function installedVersion() {
  try {
    return (await AppPlugin.getInfo()).version;
  } catch {
    return null;
  }
}
