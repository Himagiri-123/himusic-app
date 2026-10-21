// Smart Audio Engine: turns a YouTube video id into a direct audio stream URL.
// It reads the song title from YouTube's public oEmbed (never blocked, also works from datacenter IPs),
// then looks the song up on JioSaavn. If nothing matches it fails honestly (no random replacement song)
// so the app can fall back to the other sources.
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

// yt-dlp is only needed for importing playlists now (playlistInfo)
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

const SECRET_COOKIE_PATHS = ["/etc/secrets/cookies.txt", path.resolve(process.cwd(), "cookies.txt")];
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
    const p = findSecretCookieFile();
    if (p) {
      try {
        raw = fs.readFileSync(p, "utf8");
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

export const QUALITIES = ["low", "normal", "high"];

let goodClient = "none";
let lastAttempts = [];

export function ytdlpDown() {
  return false;
}

/* ---- Step 1: song title (from the app if it sent one, else YouTube oEmbed) ---- */
async function getYouTubeMeta(id) {
  const urls = [
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.title) return { title: j.title, author: (j.author_name || "").replace(/ - Topic$/i, "").trim() };
    } catch {}
  }
  return null;
}

function buildSearchQueries(meta) {
  if (!meta || !meta.title) return [];
  const cleaned = meta.title
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/\b(official|full|video|audio|lyrical|lyrics|song|hd|4k|8k|hq|mv|teaser|trailer|jukebox|with lyrics)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(/[|\-–—:/]+/).map((s) => s.trim()).filter((s) => s.length > 2);
  const queries = [];
  if (parts.length >= 2) queries.push(`${parts[0]} ${parts[1]}`);
  if (parts.length >= 1) queries.push(parts[0]);
  const shortWords = cleaned.split(" ").slice(0, 5).join(" ").trim();
  if (shortWords && !queries.includes(shortWords)) queries.push(shortWords);
  if (meta.author && parts[0]) queries.push(`${parts[0]} ${meta.author}`);
  return queries.length ? queries : [meta.title];
}

/* ---- Step 2: full-length stream from the JioSaavn CDN ---- */
const SAAVN_WRAPPERS = [
  "https://saavn.sumit.co/api/search/songs?query=",
  "https://saavn.dev/api/search/songs?query=",
  "https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=",
];

async function searchSaavnWrapper(baseUrl, query, q) {
  const r = await fetch(`${baseUrl}${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`wrapper ${r.status}`);
  const j = await r.json();
  const results = j?.data?.results || j?.results || [];
  if (!results.length) throw new Error("no results");
  const dls = results[0]?.downloadUrl || [];
  if (!dls.length) throw new Error("no downloadUrl");
  const targetQ = q === "low" ? "96kbps" : q === "high" ? "320kbps" : "160kbps";
  const picked = dls.find((d) => d.quality === targetQ) || dls.find((d) => d.quality === "160kbps") || dls[dls.length - 1];
  const streamUrl = picked?.url || picked?.link;
  if (!streamUrl) throw new Error("empty stream url");
  return { url: streamUrl, mime: "audio/mp4", abr: q === "low" ? 96 : q === "high" ? 320 : 160, size: 0, headers: { "User-Agent": UA }, source: "saavn-cdn" };
}

async function searchSaavnDirect(query, q) {
  const apiUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&q=${encodeURIComponent(query)}`;
  const r = await fetch(apiUrl, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`saavn direct ${r.status}`);
  const j = await r.json();
  for (const item of j?.results || []) {
    const preview = item?.media_preview_url || item?.more_info?.vlink;
    if (preview && preview.includes("saavncdn.com")) {
      const suffix = q === "low" ? "_96.mp4" : "_160.mp4";
      const fullUrl = preview.replace("preview.saavncdn.com", "aac.saavncdn.com").replace(/_96_p\.mp4$/, suffix);
      return { url: fullUrl, mime: "audio/mp4", abr: q === "low" ? 96 : 160, size: 0, headers: { "User-Agent": UA }, source: "jiosaavn-direct" };
    }
  }
  throw new Error("no direct saavn stream");
}

async function resolveFastAudio(id, q, hint) {
  const meta = hint?.title ? { title: hint.title, author: hint.artist || "" } : await getYouTubeMeta(id);
  const queries = buildSearchQueries(meta);
  if (!queries.length) throw new Error("could not read the song title");
  for (const query of queries) {
    try {
      return await Promise.any([searchSaavnDirect(query, q), ...SAAVN_WRAPPERS.map((w) => searchSaavnWrapper(w, query, q))]);
    } catch {}
  }
  throw new Error("no matching stream found");
}

async function run(id, q, kind, opts) {
  const attempts = [];
  try {
    const res = await resolveFastAudio(id, q, opts?.hint);
    goodClient = res.source || "saavn-cdn";
    lastError = "";
    attempts.push({ client: goodClient, ok: true });
    lastAttempts = attempts;
    return res;
  } catch (e) {
    lastError = e.message;
    attempts.push({ client: "fast-cdn", ok: false, error: String(e.message).slice(0, 120) });
    lastAttempts = attempts;
    throw e;
  }
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
    installed: true,
    lastError,
    cookies: hasCookies(),
    proxy: !!process.env.YTDLP_PROXY,
    workingClient: goodClient,
    pausedForSeconds: 0,
    attempts: lastAttempts,
  };
}

/* ---- signed URLs for the <audio> element ----
   The expiry is rounded to 6-hour slots, so the same song gets the SAME url for hours.
   That lets the phone's own HTTP cache reuse the audio instead of downloading it again. */
const SLOT = 6 * 3600_000;
const mac = (id, kind, q, exp) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`audio|${id}|${kind}|${q}|${exp}`).digest("hex").slice(0, 32);

export function signAudio(id, kind = "audio", q = "normal") {
  const exp = (Math.floor(Date.now() / SLOT) + 2) * SLOT;
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
