// Own audio engine: yt-dlp resolves a YouTube video to a direct audio URL, and our server
// streams it to the app's <audio> element (range requests supported). This is what makes
// lock-screen / background playback work, because the browser sees a normal audio file.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "bin");
const bin = () => process.env.YTDLP_PATH || path.join(dir, "yt-dlp");
const DL = process.env.YTDLP_DOWNLOAD_URL || "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

let ready = null;
let lastError = "";

export function ytdlpEnabled() {
  return process.env.YTDLP_DISABLE !== "true";
}

// download the standalone binary once (first use); a custom YTDLP_PATH skips the download
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
    ready = null; // allow a retry later
    throw e;
  });
  return ready;
}

function cookieFile() {
  let raw = "";
  const secretPath = "/etc/secrets/cookies.txt";

  // 1. Read from Render Secret (Best method)
  if (fs.existsSync(secretPath)) {
    raw = fs.readFileSync(secretPath, "utf8");
  } 
  // 2. Fallback to Env Variables
  else if (process.env.YT_COOKIES) {
    raw = process.env.YT_COOKIES;
  } else if (process.env.YT_COOKIES_B64) {
    try {
      raw = Buffer.from(process.env.YT_COOKIES_B64.trim(), "base64").toString("utf8");
    } catch {}
  }

  if (!raw || raw.trim() === "") return null;

  // 3. Fix Formatting and write safe file
  const f = path.join(dir, "cookies.txt");
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Remove bad line breaks
    raw = raw.replace(/\r\n/g, "\n");
    // Ensure the Netscape header exists (yt-dlp crashes without this)
    if (!raw.includes("# Netscape HTTP Cookie File")) {
      raw = "# Netscape HTTP Cookie File\n# https://curl.haxx.se/rfc/cookie_spec.html\n# This is a generated file! Do not edit.\n\n" + raw;
    }
    fs.writeFileSync(f, raw, { mode: 0o600 });
    return f;
  } catch {
    return null;
  }
}

const hasCookies = () => fs.existsSync("/etc/secrets/cookies.txt") || !!(process.env.YT_COOKIES || process.env.YT_COOKIES_B64);

const cache = new Map(); // id -> { at, data }
const inflight = new Map();
const TTL = 30 * 60 * 1000;

// quality -> yt-dlp format selector. low ~48-70 kbps (saves mobile data), normal ~128 kbps, high = best audio
const FORMATS = {
  audio: {
    low: "ba[abr<=70]/wa",
    normal: "ba[ext=m4a][abr<=140]/ba[abr<=140]/ba",
    high: "ba",
  },
  // video = 360p-480p muxed file (audio + picture in one), small and simple to proxy
  video: { low: "18/b[ext=mp4][height<=480]/b", normal: "18/b[ext=mp4][height<=480]/b", high: "18/b[ext=mp4][height<=480]/b" },
};
export const QUALITIES = ["low", "normal", "high"];

// YouTube sometimes answers "Sign in to confirm you're not a bot" to server IPs. Different player
// "clients" are checked differently, so we try several and remember the one that works.
const CLIENTS = (process.env.YTDLP_CLIENTS || "default,android_vr,tv,mweb,ios").split(",").map((x) => x.trim()).filter(Boolean);
let goodClient = null;
let downUntil = 0; // circuit breaker: after a bot block, skip yt-dlp for a few minutes so playback falls back fast
let lastAttempts = [];
const isBlock = (m) => /sign in|not a bot|confirm you|HTTP Error 403|429|Too Many Requests|player response|unavailable on this app/i.test(m);
const isFinal = (m) => /private video|video unavailable|removed|copyright|age|members-only|premiere/i.test(m) && !isBlock(m);

export function ytdlpDown() {
  return Date.now() < downUntil;
}

function execOnce(b, id, q, kind, client) {
  return new Promise((resolve, reject) => {
    const args = ["-f", FORMATS[kind][q], "--no-playlist", "--no-warnings", "-j", "--no-cache-dir", "--socket-timeout", "10"];
    if (client && client !== "default") args.push("--extractor-args", `youtube:player_client=${client}`);
    const c = cookieFile();
    if (c) args.push("--cookies", c);
    if (process.env.YTDLP_PROXY) args.push("--proxy", process.env.YTDLP_PROXY);
    args.push(`https://www.youtube.com/watch?v=${id}`);
    execFile(b, args, { timeout: 15_000, maxBuffer: 20 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) return reject(new Error(String(errOut || err.message).split("\n").filter(Boolean).pop()?.slice(0, 220) || err.message));
      try {
        const j = JSON.parse(out);
        if (!j.url) throw new Error("no url");
        resolve({ url: j.url, mime: j.ext === "webm" ? "audio/webm" : "audio/mp4", abr: j.abr || 0, size: j.filesize || j.filesize_approx || 0, headers: j.http_headers || {} });
      } catch {
        reject(new Error("could not parse yt-dlp output"));
      }
    });
  });
}

async function run(id, q, kind, { force = false } = {}) {
  if (!force && ytdlpDown()) throw new Error(lastError || "yt-dlp is paused after a YouTube block");
  const b = await ensureYtdlp();
  const order = goodClient ? [goodClient, ...CLIENTS.filter((c) => c !== goodClient)] : CLIENTS;
  const started = Date.now();
  const attempts = [];
  let last = "";
  for (const client of order) {
    if (Date.now() - started > 24_000) break;
    try {
      const r = await execOnce(b, id, q, kind, client);
      goodClient = client;
      lastError = "";
      downUntil = 0;
      attempts.push({ client, ok: true });
      lastAttempts = attempts;
      return r;
    } catch (e) {
      last = e.message;
      attempts.push({ client, ok: false, error: e.message.slice(0, 120) });
      if (isFinal(e.message)) break; // this video itself cannot be played, other clients will not help
    }
  }
  lastAttempts = attempts;
  lastError = last;
  if (isBlock(last)) downUntil = Date.now() + (hasCookies() ? 3 : 10) * 60 * 1000;
  throw new Error(last || "yt-dlp failed");
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
  return { enabled: ytdlpEnabled(), installed: fs.existsSync(bin()), lastError, cookies: hasCookies(), proxy: !!process.env.YTDLP_PROXY, workingClient: goodClient, pausedForSeconds: Math.max(0, Math.round((downUntil - Date.now()) / 1000)), attempts: lastAttempts };
}

/* ---- signed URLs for the <audio> element (it cannot send an Authorization header) ---- */
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

// list the songs of a public YouTube playlist (no download), used by "import playlist"
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
              thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
              duration: Math.round(e.duration || 0),
            })),
        });
      } catch {
        reject(new Error("could not read playlist"));
      }
    })
  );
}