// Bridge to the Android app shell (Capacitor). On the normal website these are all no-ops.
import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
const MC = isNative ? registerPlugin("MediaControls") : null;
const AppPlugin = isNative ? registerPlugin("App") : null;

export const nativeMedia = {
  // show / update the notification + lock-screen controls (title, artist, artwork, play state, position)
  update(info) {
    MC?.update(info).catch(() => {});
  },
  stop() {
    MC?.stop().catch(() => {});
  },
  onAction(cb) {
    let h;
    MC?.addListener("action", cb).then((x) => (h = x));
    return () => h?.remove();
  },
};

export async function installedVersion() {
  try {
    return (await AppPlugin.getInfo()).version;
  } catch {
    return null;
  }
}
