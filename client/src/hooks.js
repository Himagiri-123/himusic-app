import { useEffect, useState } from "react";

/* ---------- dominant color of a cover (for gradients) ---------- */
const colorCache = new Map();

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

// deterministic fallback color when the image can't be read (CORS) or is missing
function hashColor(str) {
  let h = 7;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return hslToRgb(h % 360, 0.5, 0.38);
}

export function useDominantColor(url, key = "") {
  const [c, setC] = useState(() => (url && colorCache.get(url)) || hashColor(url || key || "x"));
  useEffect(() => {
    if (!url) {
      setC(hashColor(key || "x"));
      return;
    }
    if (colorCache.has(url)) {
      setC(colorCache.get(url));
      return;
    }
    setC(hashColor(url));
    let dead = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const N = 24;
        const cv = document.createElement("canvas");
        cv.width = cv.height = N;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = (mx - mn) / (mx || 1);
          const lum = (R + G + B) / 3;
          const wt = 0.05 + sat * sat * 2 + (lum > 30 && lum < 220 ? 0.5 : 0);
          r += R * wt; g += G * wt; b += B * wt; w += wt;
        }
        const col = [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
        colorCache.set(url, col);
        if (!dead) setC(col);
      } catch {}
    };
    img.src = url;
    return () => {
      dead = true;
    };
  }, [url, key]);
  return c;
}

export const rgb = (c, k = 1, a = 1) => `rgba(${c.map((v) => Math.round(v * k)).join(",")},${a})`;

/* ---------- misc ---------- */
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener("online", a);
    window.addEventListener("offline", b);
    return () => {
      window.removeEventListener("online", a);
      window.removeEventListener("offline", b);
    };
  }, []);
  return on;
}

export const fmt = (s) => {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export const cleanArtist = (a = "") => a.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();

// square, small JPEG data URL for playlist photos
export async function fileToCover(file, size = 320) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  cv.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return cv.toDataURL("image/jpeg", 0.82);
}
