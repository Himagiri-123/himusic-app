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
  const raw = process.env.YT_COOKIES; // Netscape cookies.txt content (optional; helps when YouTube blocks the server IP)
  if (!raw) return null;
  const f = path.join(dir, "cookies.txt");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, raw.replace(/\\n/g, "\n"), { mode: 0o600 });
    return f;
  } catch {
    return null;
  }
}

const cache = new Map(); // id -> { at, data }
const inflight = new Map();
const TTL = 30 * 60 * 1000;

function run(id) {
  return new Promise((resolve, reject) => {
    ensureYtdlp().then((b) => {
      const args = ["-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist", "--no-warnings", "-j", "--no-cache-dir"];
      const c = cookieFile();
      if (c) args.push("--cookies", c);
      if (process.env.YTDLP_PROXY) args.push("--proxy", process.env.YTDLP_PROXY);
      args.push(`https://www.youtube.com/watch?v=${id}`);
      execFile(b, args, { timeout: 25_000, maxBuffer: 20 * 1024 * 1024 }, (err, out, errOut) => {
        if (err) {
          lastError = String(errOut || err.message).split("\n").filter(Boolean).pop()?.slice(0, 200) || err.message;
          return reject(new Error(lastError));
        }
        try {
          const j = JSON.parse(out);
          if (!j.url) throw new Error("no url");
          lastError = "";
          resolve({ url: j.url, mime: j.ext === "webm" ? "audio/webm" : "audio/mp4", size: j.filesize || j.filesize_approx || 0, headers: j.http_headers || {} });
        } catch (e) {
          reject(new Error("could not parse yt-dlp output"));
        }
      });
    }, reject);
  });
}

export function resolveAudio(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
  if (inflight.has(id)) return inflight.get(id);
  const p = run(id)
    .then((data) => {
      if (cache.size > 300) cache.clear();
      cache.set(id, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export function dropAudio(id) {
  cache.delete(id);
}

export function ytdlpStatus() {
  return { enabled: ytdlpEnabled(), installed: fs.existsSync(bin()), lastError, cookies: !!process.env.YT_COOKIES, proxy: !!process.env.YTDLP_PROXY };
}

/* ---- signed URLs for the <audio> element (it cannot send an Authorization header) ---- */
export function signAudio(id, ttlMs = 6 * 3600_000) {
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`audio|${id}|${exp}`).digest("hex").slice(0, 32);
  return { exp, sig };
}
export function verifyAudio(id, exp, sig) {
  if (!(Number(exp) > Date.now()) || typeof sig !== "string") return false;
  const good = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`audio|${id}|${Number(exp)}`).digest("hex").slice(0, 32);
  const a = Buffer.from(good), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
