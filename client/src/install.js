import { useEffect, useState } from "react";

// "Add to Home Screen" support. Chrome/Edge/Brave on Android + desktop fire
// `beforeinstallprompt`; iPhone Safari has no such event (manual Share > Add to Home Screen).
let deferred = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return {
    installed: standalone(),
    canPrompt: !!deferred,
    showIosTip: ios() && !standalone(),
    install: async () => {
      if (!deferred) return;
      deferred.prompt();
      try {
        await deferred.userChoice;
      } catch {}
      deferred = null;
      emit();
    },
  };
}
