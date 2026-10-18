// Own audio engine: yt-dlp resolves a YouTube video to a direct audio URL, and our server
// streams it to the app's <audio> element (range requests supported).
// Includes automatic fallback to Piped & Invidious APIs when YouTube blocks datacenter IPs.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "bin");
const bin = () => process.env.YTDLP_PATH || path.join(dir, "yt-dlp");
const DL = process.env.YTDLP_DOWNLOAD_URL || "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let ready = null;
let lastError = "";

export function ytdlpEnabled() {
  return process.env.YTDLP_DISABLE !== "true";
}

export function ensureYtdlp() {
  if (!ytdlpEnabled()) return Promise.reject(new Error("yt-dlp disabled"));
  if (ready) return ready;
  ready = (async () => {
    if (fs.existsSync(bin())) return bin();
    fs.mkdirSync(dir, { recursive: true });
    const r = await fetch(DL, { redirect: "follow" });
    if (!r.ok) throw new Error(`yt-dlp download failed (${r.status})`);
    const tmp = bin() + ".part";
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, bin());
    return bin();
  })().catch((e) => {
    lastError = e.message;
    ready = null;
    throw e;
  });
  return ready;
}

const SECRET_COOKIE_PATHS = [
  "/etc/secrets/cookies.txt",
  path.resolve(process.cwd(), "cookies.txt"),
];

function findSecretCookieFile() {
  for (const p of SECRET_COOKIE_PATHS) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    } catch {}
  }
  return null;
}

function cookieFile() {
  let raw = process.env.YT_COOKIES;
  if (!raw && process.env.YT_COOKIES_B64) {
    try {
      raw = Buffer.from(process.env.YT_COOKIES_B64.trim(), "base64").toString("utf8");
    } catch {}
  }
  if (!raw) {
    const secretPath = findSecretCookieFile();
    if (secretPath) {
      try {
        raw = fs.readFileSync(secretPath, "utf8");
      } catch {}
    }
  }
  if (!raw) return null;
  const f = path.join(dir, "cookies.txt");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n"), { mode: 0o600 });
    return f;
  } catch {
    return null;
  }
}

const hasCookies = () => !!(process.env.YT_COOKIES || process.env.YT_COOKIES_B64 || findSecretCookieFile());

const cache = new Map();
const inflight = new Map();
const TTL = 30 * 60 * 1000;

const FORMATS = {
  audio: {
    low: "ba[abr<=70]/wa",
    normal: "ba[ext=m4a][abr<=140]/ba[abr<=140]/ba",
    high: "ba",
  },
  video: {
    low: "18/b[ext=mp4][height<=480]/b",
    normal: "18/b[ext=mp4][height<=480]/b",
    high: "18/b[ext=mp4][height<=480]/b",
  },
};
export const QUALITIES = ["low", "normal", "high"];

const CLIENTS = (process.env.YTDLP_CLIENTS || "android_vr,mweb").split(",").map((x) => x.trim()).filter(Boolean);
let goodClient = null;
let downUntil = 0;
let lastAttempts = [];

export function ytdlpDown() {
  return Date.now() < downUntil;
}

/* ---- Fallback Audio Engine (Piped & Invidious APIs) ---- */
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.drgns.space",
  "https://pipedapi.smnz.de",
  "https://piped-api.garudalinux.org",
];

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.jing.rocks",
  "https://invidious.privacyredirect.com",
  "https://iv.datura.network",
];

async function tryPipedInstance(api, id, kind) {
  const r = await fetch(`${api}/streams/${id}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`piped ${r.status}`);
  const j = await r.json();
  if (kind === "video") {
    const vStreams = (j.videoStreams || []).filter((s) => s.url && !s.videoOnly);
    if (vStreams.length > 0) {
      return {
        url: vStreams[0].url,
        mime: "video/mp4",
        abr: 128,
        size: 0,
        headers: { "User-Agent": UA },
        source: `piped:${new URL(api).hostname}`,
      };
    }
  }
  const streams = (j.audioStreams || []).filter((s) => s.url);
  if (!streams.length) throw new Error("no audio streams");
  // Prefer m4a/mp4 for smooth mobile background playback, then sort by bitrate
  streams.sort((a, b) => {
    const aM4a = (a.mimeType || "").includes("mp4") ? 1 : 0;
    const bM4a = (b.mimeType || "").includes("mp4") ? 1 : 0;
    if (aM4a !== bM4a) return bM4a - aM4a;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
  const best = streams[0];
  return {
    url: best.url,
    mime: (best.mimeType || "").includes("webm") ? "audio/webm" : "audio/mp4",
    abr: Math.round((best.bitrate || 128000) / 1000),
    size: best.contentLength || 0,
    headers: { "User-Agent": UA },
    source: `piped:${new URL(api).hostname}`,
  };
}

async function tryInvidiousInstance(api, id, kind) {
  const r = await fetch(`${api}/api/v1/videos/${id}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`invidious ${r.status}`);
  const j = await r.json();
  if (kind === "video") {
    const fmt = (j.formatStreams || []).find((s) => s.itag === "18" || s.url);
    if (fmt) {
      return {
        url: `${api}/latest_version?id=${id}&itag=${fmt.itag || 18}&local=true`,
        mime: "video/mp4",
        abr: 128,
        size: 0,
        headers: { "User-Agent": UA },
        source: `invidious:${new URL(api).hostname}`,
      };
    }
  }
  const audios = (j.adaptiveFormats || []).filter((s) => (s.type || "").startsWith("audio/"));
  if (!audios.length) throw new Error("no invidious audio");
  audios.sort((a, b) => {
    const aM4a = (a.type || "").includes("mp4") ? 1 : 0;
    const bM4a = (b.type || "").includes("mp4") ? 1 : 0;
    if (aM4a !== bM4a) return bM4a - aM4a;
    return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
  });
  const best = audios[0];
  const itag = best.itag || "140";
  return {
    url: `${api}/latest_version?id=${id}&itag=${itag}&local=true`,
    mime: (best.type || "").includes("webm") ? "audio/webm" : "audio/mp4",
    abr: Math.round((Number(best.bitrate) || 128000) / 1000),
    size: Number(best.clen) || 0,
    headers: { "User-Agent": UA },
    source: `invidious:${new URL(api).hostname}`,
  };
}

async function fetchFallbackAudio(id, kind) {
  try {
    return await Promise.any(PIPED_INSTANCES.map((api) => tryPipedInstance(api, id, kind)));
  } catch {}
  try {
    return await Promise.any(INVIDIOUS_INSTANCES.map((api) => tryInvidiousInstance(api, id, kind)));
  } catch {}
  return null;
}

function execOnce(b, id, q, kind, client, useCookieAndProxy = true) {
  return new Promise((resolve, reject) => {
    const args = ["-f", FORMATS[kind][q], "--no-playlist", "--no-warnings", "-j", "--no-cache-dir", "--socket-timeout", "8"];
    if (client && client !== "default") args.push("--extractor-args", `youtube:player_client=${client}`);
    if (useCookieAndProxy) {
      const c = cookieFile();
      if (c) args.push("--cookies", c);
      if (process.env.YTDLP_PROXY) args.push("--proxy", process.env.YTDLP_PROXY);
    }
    args.push(`https://www.youtube.com/watch?v=${id}`);
    execFile(b, args, { timeout: 10_000, maxBuffer: 20 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) return reject(new Error(String(errOut || err.message).split("\n").filter(Boolean).pop()?.slice(0, 220) || err.message));
      try {
        const j = JSON.parse(out);
        if (!j.url) throw new Error("no url");
        resolve({
          url: j.url,
          mime: j.ext === "webm" ? "audio/webm" : "audio/mp4",
          abr: j.abr || 0,
          size: j.filesize || j.filesize_approx || 0,
          headers: j.http_headers || {},
        });
      } catch {
        reject(new Error("could not parse yt-dlp output"));
      }
    });
  });
}

async function run(id, q, kind, { force = false } = {}) {
  const attempts = [];
  let last = "";

  // 1. Try yt-dlp quickly (max 12 seconds total)
  if (force || !ytdlpDown()) {
    try {
      const b = await ensureYtdlp();
      const started = Date.now();
      for (const client of CLIENTS) {
        if (Date.now() - started > 12_000) break;
        try {
          const r = await execOnce(b, id, q, kind, client, true);
          goodClient = client;
          lastError = "";
          downUntil = 0;
          attempts.push({ client, ok: true });
          lastAttempts = attempts;
          return r;
        } catch (e) {
          last = e.message;
          attempts.push({ client, ok: false, error: e.message.slice(0, 120) });
        }
      }
    } catch (e) {
      last = e.message;
    }
  }

  // 2. Automatic Fallback to Piped / Invidious APIs when YouTube blocks yt-dlp
  const fallback = await fetchFallbackAudio(id, kind);
  if (fallback) {
    goodClient = fallback.source;
    lastError = "";
    downUntil = 0;
    attempts.push({ client: fallback.source, ok: true });
    lastAttempts = attempts;
    return fallback;
  }

  lastAttempts = attempts;
  lastError = last || "All audio sources failed";
  downUntil = Date.now() + 2 * 60 * 1000;
  throw new Error(lastError);
}

export function resolveAudio(id, q = "normal", kind = "audio", opts) {
  if (!QUALITIES.includes(q)) q = "normal";
  if (kind !== "video") kind = "audio";
  const key = `${id}|${kind}|${q}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
  if (inflight.has(key)) return inflight.get(key);
  const p = run(id, q, kind, opts)
    .then((data) => {
      if (cache.size > 300) cache.clear();
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function dropAudio(id, q = "normal", kind = "audio") {
  cache.delete(`${id}|${kind}|${q}`);
}

export function ytdlpStatus() {
  return {
    enabled: ytdlpEnabled(),
    installed: fs.existsSync(bin()),
    lastError,
    cookies: hasCookies(),
    proxy: !!process.env.YTDLP_PROXY,
    workingClient: goodClient,
    pausedForSeconds: Math.max(0, Math.round((downUntil - Date.now()) / 1000)),
    attempts: lastAttempts,
  };
}

/* ---- signed URLs for the <audio> element ---- */
const mac = (id, kind, q, exp) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`audio|${id}|${kind}|${q}|${exp}`).digest("hex").slice(0, 32);

export function signAudio(id, kind = "audio", q = "normal", ttlMs = 6 * 3600_000) {
  const exp = Date.now() + ttlMs;
  return { exp, sig: mac(id, kind, q, exp) };
}

export function verifyAudio(id, kind, q, exp, sig) {
  if (!(Number(exp) > Date.now()) || typeof sig !== "string") return false;
  const good = mac(id, kind, q, Number(exp));
  const a = Buffer.from(good), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function playlistInfo(url) {
  const b = await ensureYtdlp();
  const args = ["--flat-playlist", "-J", "--no-warnings", "--playlist-end", "200", "--no-cache-dir"];
  const c = cookieFile();
  if (c) args.push("--cookies", c);
  if (process.env.YTDLP_PROXY) args.push("--proxy", process.env.YTDLP_PROXY);
  args.push(url);
  return new Promise((resolve, reject) =>
    execFile(b, args, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) return reject(new Error(String(errOut || err.message).split("\n").filter(Boolean).pop()?.slice(0, 200) || "failed"));
      try {
        const j = JSON.parse(out);
        resolve({
          name: j.title || "Imported playlist",
          tracks: (j.entries || [])
            .filter((e) => e?.id && /^[\w-]{11}$/.test(e.id))
            .map((e) => ({
              id: e.id,
              title: e.title,
              artist: (e.uploader || e.channel || "").replace(/ - Topic$/i, ""),
              duration: Math.round(e.duration || 0),
              thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
            })),
        });
      } catch {
        reject(new Error("could not read playlist"));
      }
    })
  );
}
