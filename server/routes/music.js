import { Router } from "express";
import { Readable, Transform } from "node:stream";
import { ytdlpEnabled, ytdlpDown, resolveAudio, ytdlpStatus, signAudio, verifyAudio, ensureYtdlp, dropAudio, QUALITIES } from "../ytdlp.js";

const router = Router();

// Open-source YouTube front-ends. Public instances come and go, so we use a
// static list plus (when no env override is set) a live list of healthy ones.
const STATIC_PIPED = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
];
const STATIC_INV = ["https://inv.nadeko.net", "https://yewtu.be"];

const list = (v) =>
  (v || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
const uniq = (a) => [...new Set(a)];
const toWords = (t = "") => String(t).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/[^a-z0-9\u0900-\u0dff]+/).filter((w) => w.length > 1 && !/^(official|video|song|lyrical|lyrics|full|audio|hd)$/.test(w));

async function getJSON(url, ms = 8000, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers });
    if (!r.ok) {
      let m = "";
      try {
        const j = await r.json();
        m = typeof j?.error === "string" ? j.error : j?.error?.message || "";
      } catch {}
      throw new Error(`HTTP ${r.status}${m ? ": " + String(m).slice(0, 100) : ""}`);
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

let cache = { at: 0, piped: [], inv: [] };

async function instances() {
  if (cache.at && Date.now() - cache.at < 10 * 60 * 1000) return cache;
  const envP = list(process.env.PIPED_INSTANCES);
  const envI = list(process.env.INVIDIOUS_INSTANCES);
  let piped = envP;
  let inv = envI;

  if (!envP.length) {
    let found = [];
    try {
      const l = await getJSON("https://piped-instances.kavin.rocks/", 4000);
      found = l
        .filter((i) => i.api_url && i.up_to_date !== false)
        .map((i) => i.api_url.replace(/\/$/, ""));
    } catch {}
    piped = uniq([...STATIC_PIPED, ...found]).slice(0, 8);
  }
  if (!envI.length) {
    let found = [];
    try {
      const l = await getJSON("https://api.invidious.io/instances.json?sort_by=health", 4000);
      found = l
        .filter(([, i]) => i.api === true && i.type === "https" && i.uri)
        .map(([, i]) => i.uri.replace(/\/$/, ""));
    } catch {}
    inv = uniq([...STATIC_INV, ...found]).slice(0, 5);
  }
  cache = { at: Date.now(), piped, inv };
  return cache;
}

// Run all tasks in parallel, return the first success.
async function any(tasks) {
  try {
    return await Promise.any(
      tasks.map(([name, fn]) =>
        fn().catch((e) => {
          throw new Error(`${name}: ${e.message}`);
        })
      )
    );
  } catch (e) {
    const err = new Error("all instances failed");
    err.details = (e.errors || []).map((x) => x.message);
    throw err;
  }
}

const idFromUrl = (u = "") => (u.match(/[?&]v=([^&]+)/) || [])[1] || "";

/* ---------- stream URL helpers ---------- */

// Piped returns raw googlevideo URLs that are locked to the instance's IP.
// The Piped frontend rewrites them to the instance's proxy; we do the same.
function fixUrl(u, base, proxy) {
  const url = new URL(u, base);
  if (proxy && url.hostname.endsWith("googlevideo.com")) {
    url.searchParams.set("host", url.host);
    url.host = proxy.host;
    url.protocol = proxy.protocol;
  }
  if (url.protocol === "http:" && !/^(localhost|127\.)/.test(url.hostname)) {
    url.protocol = "https:"; // browsers block http audio on https pages
  }
  return url.toString();
}

// Prefer AAC/mp4 (plays everywhere, incl. iPhone), about 128kbps (small data use).
function rankAudio(items) {
  const score = (s) =>
    (/mp4|m4a|aac/.test(s.mime) ? 0 : 1) * 1e9 +
    (s.bitrate <= 140000 ? 140000 - s.bitrate : 1e6 + s.bitrate);
  return [...items].sort((a, b) => score(a) - score(b)).slice(0, 3);
}

// Check from the server that the proxied URL really serves bytes.
async function reachable(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-1" }, signal: ctrl.signal });
    const ok = r.status === 200 || r.status === 206;
    try {
      await r.body?.cancel();
    } catch {}
    if (!ok) throw new Error(`audio HTTP ${r.status}`);
    return true;
  } finally {
    clearTimeout(t);
  }
}

async function pipedResolve(base, id) {
  const d = await getJSON(`${base}/streams/${id}`, 9000);
  if (d.error) throw new Error(String(d.error).slice(0, 80));
  const proxy = d.proxyUrl ? new URL(d.proxyUrl) : null;
  const audio = (d.audioStreams || [])
    .filter((s) => s.url && !s.videoOnly && (s.mimeType || "").startsWith("audio"))
    .map((s) => ({ url: s.url, bitrate: s.bitrate || 0, mime: s.mimeType }));
  if (!audio.length) throw new Error("no audio streams");
  const video = (d.videoStreams || []).find(
    (s) => s.url && !s.videoOnly && (s.mimeType || "").startsWith("video")
  );
  return {
    audioCandidates: rankAudio(audio).map((s) => fixUrl(s.url, base, proxy)),
    videoUrl: video ? fixUrl(video.url, base, proxy) : null,
    related: (d.relatedStreams || [])
      .filter((r) => r.type === "stream" && r.url)
      .slice(0, 15)
      .map((r) => ({
        id: idFromUrl(r.url),
        title: r.title,
        artist: r.uploaderName,
        thumbnail: r.thumbnail,
        duration: r.duration,
      })),
  };
}

async function invResolve(base, id) {
  // local=true makes the instance proxy the media (otherwise IP-locked)
  const d = await getJSON(`${base}/api/v1/videos/${id}?local=true`, 9000);
  if (d.error) throw new Error(String(d.error).slice(0, 80));
  const audio = (d.adaptiveFormats || [])
    .filter((f) => f.url && (f.type || "").startsWith("audio"))
    .map((f) => ({ url: f.url, bitrate: Number(f.bitrate) || 0, mime: f.type }));
  if (!audio.length) throw new Error("no audio streams");
  const muxed = (d.formatStreams || []).find((f) => f.url);
  return {
    audioCandidates: rankAudio(audio).map((s) => fixUrl(s.url, base, null)),
    videoUrl: muxed ? fixUrl(muxed.url, base, null) : null,
    related: (d.recommendedVideos || []).slice(0, 15).map((r) => ({
      id: r.videoId,
      title: r.title,
      artist: r.author,
      thumbnail: r.videoThumbnails?.[3]?.url || r.videoThumbnails?.[0]?.url,
      duration: r.lengthSeconds,
    })),
  };
}

function withVerify(resolve, base, id) {
  return async () => {
    const r = await resolve(base, id);
    let lastErr;
    for (const url of r.audioCandidates) {
      try {
        await reachable(url);
        return { audioUrl: url, videoUrl: r.videoUrl, related: r.related };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("no reachable audio");
  };
}

function streamTasks(id, inst) {
  return [
    ...inst.piped.slice(0, 6).map((b) => [b, withVerify(pipedResolve, b, id)]),
    ...inst.inv.slice(0, 4).map((b) => [b, withVerify(invResolve, b, id)]),
  ];
}

/* ---------- routes ---------- */

/* ---------- search (3 tiers, first one that returns results wins) ---------- */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const parseClock = (t = "") => t.split(":").reduce((a, n) => a * 60 + Number(n), 0) || 0;
const parseISO = (d = "") => {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
};
const decode = (s = "") =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// Tier 1: official YouTube Data API v3 (needs a free YOUTUBE_API_KEY)
async function searchDataApi(q) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY not set");
  const base = process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3";
  const s = await getJSON(
    `${base}/search?part=snippet&type=video&videoEmbeddable=true&maxResults=20&q=${encodeURIComponent(
      q
    )}&key=${key}`
  );
  const items = (s.items || []).filter((i) => i.id?.videoId);
  if (!items.length) throw new Error("no results");
  const dur = {};
  try {
    const v = await getJSON(
      `${base}/videos?part=contentDetails&id=${items.map((i) => i.id.videoId).join(",")}&key=${key}`
    );
    for (const x of v.items || []) dur[x.id] = parseISO(x.contentDetails?.duration);
  } catch {}
  return items.map((i) => ({
    id: i.id.videoId,
    title: decode(i.snippet?.title),
    artist: decode(i.snippet?.channelTitle),
    thumbnail: i.snippet?.thumbnails?.medium?.url || thumb(i.id.videoId),
    duration: dur[i.id.videoId] || 0,
  }));
}

// Tier 2: YouTube's own web search endpoint (no key needed)
async function searchInnerTube(q) {
  const url =
    process.env.INNERTUBE_URL ||
    "https://www.youtube.com/youtubei/v1/search?prettyPrint=false&key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: process.env.INNERTUBE_CLIENT_VERSION || "2.20260101.00.00",
            hl: "en",
            gl: "IN",
          },
        },
        query: q,
        params: "EgIQAQ==", // videos only
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const sections =
      d?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ||
      [];
    const out = [];
    for (const sec of sections) {
      for (const it of sec.itemSectionRenderer?.contents || []) {
        const v = it.videoRenderer;
        if (!v?.videoId || !v.lengthText?.simpleText) continue; // skip live streams
        out.push({
          id: v.videoId,
          title: (v.title?.runs || []).map((x) => x.text).join(""),
          artist: v.ownerText?.runs?.[0]?.text || "",
          thumbnail: thumb(v.videoId),
          duration: parseClock(v.lengthText.simpleText),
        });
      }
    }
    if (!out.length) throw new Error("no results (blocked or format changed)");
    return out;
  } finally {
    clearTimeout(t);
  }
}

// Tier 3: Piped / Invidious public instances
async function searchInstances(q) {
  const inst = await instances();
  const tasks = [
    ...inst.piped.slice(0, 4).map((base) => [
      base,
      async () => {
        const d = await getJSON(`${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`);
        const items = (d.items || []).filter((i) => i.url?.includes("watch"));
        if (!items.length) throw new Error("empty");
        return items.map((i) => ({
          id: idFromUrl(i.url),
          title: i.title,
          artist: i.uploaderName,
          thumbnail: i.thumbnail,
          duration: i.duration,
        }));
      },
    ]),
    ...inst.inv.slice(0, 3).map((base) => [
      base,
      async () => {
        const d = await getJSON(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`);
        if (!d.length) throw new Error("empty");
        return d.map((i) => ({
          id: i.videoId,
          title: i.title,
          artist: i.author,
          thumbnail: i.videoThumbnails?.[3]?.url || i.videoThumbnails?.[0]?.url,
          duration: i.lengthSeconds,
        }));
      },
    ]),
  ];
  return any(tasks);
}

// Free tiers first so the YouTube API quota is only spent when they fail.
const SEARCH_TIERS = [
  ["innertube", searchInnerTube],
  ["youtube-api", searchDataApi],
  ["instances", searchInstances],
];

const errText = (e) => `${e.message}${e.details ? ` [${e.details.slice(0, 3).join(" | ")}]` : ""}`;

// tiny in-memory TTL cache (saves quota + makes repeat searches instant)
const memo = new Map();
async function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  if (memo.size > 600) memo.clear();
  memo.set(key, { at: Date.now(), v });
  return v;
}

// a tier that just failed is skipped for 3 minutes so typing stays fast
const tierDownAt = {};

// Only single songs: no jukeboxes, mashups, albums or anything longer than 8 minutes
// (unless the user typed such a word on purpose, e.g. "jukebox")
const MIX_WORDS = /\b(jukebox|juke box|nonstop|non-stop|non stop|mashup|mega ?mix|full album|back to back|all songs|audio jukebox|video jukebox|songs collection|hit songs collection|\d{1,3}\s*(best )?songs|top\s*\d{2,3}|playlist|live stream|24\/7)\b/i;
export function onlySingles(results, query = "") {
  const wantsMix = MIX_WORDS.test(query) || /\b(mix|album|mashup)\b/i.test(query);
  if (wantsMix) return results;
  return results.filter((r) => {
    if (MIX_WORDS.test(r.title || "")) return false;
    if (/\b(whatsapp status|status video|reels?|shorts?|edit)\b/i.test(r.title || "")) return false; // fan edits, not the song
    return true;
  });
}

async function runSearch(q) {
  return cached(`s:${q.toLowerCase()}`, 60 * 60 * 1000, async () => {
    const errors = [];
    let tiers = SEARCH_TIERS.filter(([n]) => !(tierDownAt[n] && Date.now() - tierDownAt[n] < 3 * 60 * 1000));
    if (!tiers.length) tiers = SEARCH_TIERS;
    for (const [name, fn] of tiers) {
      try {
        const results = onlySingles(await fn(q), q);
        if (results?.length) {
          delete tierDownAt[name];
          return { results, source: name };
        }
      } catch (e) {
        tierDownAt[name] = Date.now();
        errors.push(`${name}: ${errText(e)}`);
      }
    }
    const err = new Error("all search tiers failed");
    err.details = errors;
    throw err;
  });
}

// GET /api/music/search?q=...
router.get("/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ results: [] });
  try {
    const { results, source } = await runSearch(q);
    res.json({ results, source });
  } catch (e) {
    console.error("search failed", e.details);
    res.status(502).json({
      error: "Search failed. Set YOUTUBE_API_KEY on the server (see README) or try again.",
      details: e.details,
    });
  }
});

// GET /api/music/debug/search?q=... -> shows what each search tier returns on THIS server
router.get("/debug/search", async (req, res) => {
  const q = (req.query.q || "arijit singh").toString();
  const out = [];
  for (const [name, fn] of SEARCH_TIERS) {
    const t = Date.now();
    try {
      const r = await fn(q);
      out.push({ tier: name, ok: true, count: r.length, ms: Date.now() - t });
    } catch (e) {
      out.push({ tier: name, ok: false, ms: Date.now() - t, error: errText(e) });
    }
  }
  res.json({ query: q, hasApiKey: !!process.env.YOUTUBE_API_KEY, tiers: out });
});

const streamCache = new Map();
const TTL = 20 * 60 * 1000;

// GET /api/music/stream/:id -> playable audio/video URLs + related songs
router.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: "bad id" });
  const q = QUALITIES.includes(req.query.q) ? req.query.q : "normal";
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const ckey = `${id}|${q}`;
  const hit = streamCache.get(ckey);
  if (hit && Date.now() - hit.at < TTL) return res.json(hit.data);
  try {
    let data;
    // Tier 0: our own yt-dlp engine, streamed through /audio/:id (best for lock-screen playback)
    if (ytdlpEnabled() && !ytdlpDown()) {
      try {
        const hint = req.query.t ? { title: String(req.query.t).slice(0, 160), artist: String(req.query.a || "").slice(0, 100), duration: Number(req.query.d) || 0 } : null;
        await resolveAudio(id, q, "audio", { hint });
        const a = signAudio(id, "audio", q);
        const v = signAudio(id, "video", "normal"); // video is only resolved if the user actually opens it
        data = {
          audioUrl: `${base}/api/music/audio/${id}?k=audio&q=${q}&exp=${a.exp}&sig=${a.sig}`,
          videoUrl: `${base}/api/music/audio/${id}?k=video&q=normal&exp=${v.exp}&sig=${v.sig}`,
          related: [], // fetched separately (/related) so playback starts without waiting
          engine: "ytdlp",
          quality: q,
        };
      } catch (e) {
        console.error("yt-dlp tier failed:", id, e.message);
      }
    }
    if (!data) data = await any(streamTasks(id, await instances()));
    if (streamCache.size > 200) streamCache.clear();
    streamCache.set(ckey, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error("stream failed", id, e.details || e.message);
    res.status(502).json({
      error: "Could not get a playable stream (instances busy or blocked). Try another song.",
      details: e.details,
    });
  }
});


// POST /api/music/links { songs: [{id,title,artist,duration}], q } -> signed play links WITHOUT looking the songs up.
// The lookup happens when the player really asks for the audio, so the phone can queue a whole list at once
// (and keep playing it with the screen off) without waiting for one slow lookup per song.
router.post("/links", (req, res) => {
  const q = QUALITIES.includes(req.body?.q) ? req.body.q : "normal";
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const songs = (Array.isArray(req.body?.songs) ? req.body.songs : []).slice(0, 40);
  const links = [];
  for (const s of songs) {
    const id = String(s?.id || "");
    if (!/^[\w-]{6,15}$/.test(id)) continue;
    const a = signAudio(id, "audio", q);
    const v = signAudio(id, "video", "normal");
    const h = `&t=${encodeURIComponent(String(s.title || "").slice(0, 160))}&a=${encodeURIComponent(String(s.artist || "").slice(0, 100))}&d=${Math.round(Number(s.duration) || 0)}`;
    links.push({
      id,
      audioUrl: `${base}/api/music/audio/${id}?k=audio&q=${q}&exp=${a.exp}&sig=${a.sig}${h}`,
      videoUrl: `${base}/api/music/audio/${id}?k=video&q=normal&exp=${v.exp}&sig=${v.sig}${h}`,
    });
  }
  // start looking up the first songs right away so they are ready when the player asks
  if (ytdlpEnabled() && !ytdlpDown())
    songs.slice(0, 5).forEach((s) => {
      if (s?.title && /^[\w-]{6,15}$/.test(String(s.id))) resolveAudio(s.id, q, "audio", { hint: { title: String(s.title).slice(0, 160), artist: String(s.artist || "").slice(0, 100), duration: Number(s.duration) || 0 } }).catch(() => {});
    });
  res.json({ links });
});

// Signed audio proxy: the <audio> tag requests this, we fetch the real file (with Range) and pipe it back.
// When the song is not in the Saavn catalogue, fall back to the YouTube (Piped / Invidious) streams and pipe them
// through this server too, so the phone never talks to those hosts directly (no CORS / 403 on the client).
const ytFallback = new Map(); // id -> { at, info }
async function resolveWithFallback(id, q, kind, hint) {
  try {
    return await resolveAudio(id, q, kind, { hint });
  } catch (e) {
    const hit = ytFallback.get(`${id}|${kind}`);
    if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.info;
    const data = await any(streamTasks(id, await instances())).catch(() => null);
    const url = kind === "video" ? data?.videoUrl || data?.audioUrl : data?.audioUrl;
    if (!url) throw e;
    const info = { url, mime: "audio/mp4", source: "yt-fallback" };
    if (ytFallback.size > 100) ytFallback.clear();
    ytFallback.set(`${id}|${kind}`, { at: Date.now(), info });
    return info;
  }
}

router.get("/audio/:id", async (req, res) => {
  const { id } = req.params;
  const kind = req.query.k === "video" ? "video" : "audio";
  const q = QUALITIES.includes(req.query.q) ? req.query.q : "normal";
  if (!/^[\w-]{6,15}$/.test(id) || !verifyAudio(id, kind, q, req.query.exp, req.query.sig)) return res.status(403).end();
  try {
    const hint = req.query.t ? { title: String(req.query.t).slice(0, 160), artist: String(req.query.a || "").slice(0, 100), duration: Number(req.query.d) || 0 } : null;
    const info = await resolveWithFallback(id, q, kind, hint);
    const headers = { "User-Agent": UA };
    // Range requests are capped per response. The default (8 MB) is a whole song, so the phone buffers it fully
    // and keeps playing in the background / with the screen off even if the network is throttled.
    // Requests with no Range header (offline downloads) get the full file.
    const CAP = Number(process.env.CHUNK_BYTES) || 8 * 1024 * 1024;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    // the Android player (nocap=1) streams the whole file itself, so it gets uncapped ranges
    if (m && req.query.nocap !== "1") {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), start + CAP - 1) : start + CAP - 1;
      headers.Range = `bytes=${start}-${end}`;
    } else if (req.headers.range) headers.Range = req.headers.range;
    let up = await fetch(info.url, { headers });
    if (!up.ok && up.status !== 206) {
      // link went bad (expired / moved): look the song up again once and retry
      dropAudio(id, q, kind);
      ytFallback.delete(`${id}|${kind}`);
      try {
        const fresh = await resolveWithFallback(id, q, kind, hint);
        up = await fetch(fresh.url, { headers });
      } catch {}
      if (!up.ok && up.status !== 206) return res.status(502).end();
    }
    res.set("Accept-Ranges", "bytes");
    const asked = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const total = Number(up.headers.get("content-length")) || 0;
    let slice = null;
    if (asked && up.status === 200 && total) {
      // the file server ignored our Range header: cut the requested part out ourselves, otherwise a seek
      // would restart from byte 0 and land on the wrong time (or fail)
      const start = Number(asked[1]);
      if (start >= total) return res.status(416).set("Content-Range", `bytes */${total}`).end();
      const end = asked[2] ? Math.min(Number(asked[2]), total - 1) : total - 1;
      slice = { start, end };
      res.status(206);
      res.set("Content-Range", `bytes ${start}-${end}/${total}`);
      res.set("Content-Length", String(end - start + 1));
      const ct = up.headers.get("content-type");
      if (ct) res.set("Content-Type", ct);
    } else {
      res.status(up.status);
      for (const h of ["content-type", "content-length", "content-range"]) {
        const v = up.headers.get(h);
        if (v) res.set(h, v);
      }
    }
    res.set("Cache-Control", "private, max-age=21600");
    let body = Readable.fromWeb(up.body);
    if (slice) {
      let skip = slice.start;
      let left = slice.end - slice.start + 1;
      body = body.pipe(
        new Transform({
          transform(chunk, _enc, cb) {
            if (skip > 0) {
              if (chunk.length <= skip) {
                skip -= chunk.length;
                return cb();
              }
              chunk = chunk.subarray(skip);
              skip = 0;
            }
            if (left <= 0) return cb();
            if (chunk.length > left) chunk = chunk.subarray(0, left);
            left -= chunk.length;
            cb(null, chunk);
          },
        })
      );
    }
    req.on("close", () => body.destroy());
    body.on("error", () => res.end());
    body.pipe(res);
  } catch (e) {
    console.error("audio proxy failed", id, e.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ---------- radio / auto-queue: keep the language and the mood of the song that was played ---------- */
const LANGS = [
  ["telugu", /[\u0C00-\u0C7F]|\b(telugu|tollywood|tfi)\b|aditya music|lahari music|mango music|volga videos|saregama telugu|geetha arts|shreyas media/i],
  ["tamil", /[\u0B80-\u0BFF]|\b(tamil|kollywood)\b|think music|sony music south/i],
  ["kannada", /[\u0C80-\u0CFF]|\b(kannada|sandalwood)\b|anand audio|pm audio/i],
  ["malayalam", /[\u0D00-\u0D7F]|\b(malayalam|mollywood)\b|manorama music|satyam audios/i],
  ["punjabi", /[\u0A00-\u0A7F]|\b(punjabi)\b|speed records|white hill/i],
  ["hindi", /[\u0900-\u097F]|\b(hindi|bollywood)\b|t-series|t series|zee music|tips official|tips music|yrf|sony music india/i],
];
const detectLang = (t = "") => (LANGS.find(([, re]) => re.test(t)) || [])[0] || "";
const DEITY = /\b(ayyappa|ayyappan|shiva|siva|venkateswara|venkatesa|balaji|govinda|hanuman|krishna|rama|ganesh|ganapati|durga|lakshmi|annamayya|sai ?baba|subramanya|murugan|narasimha|saraswati|vishnu)\b/i;
const MOODS = [
  ["devotional", /devotional|bhakti|bhakthi|bhajan|aarti|arati|stotram|stotra|suprabhatam|keerthana|kirtan|mantra|chalisa|ashtakam|namah|namaha|swamy|swami|ayyappa|venkateswara|govinda|hanuman|ganapati|ganesh|annamayya|\bom\b|\b(shiva|siva|durga|lakshmi)\b/i],
  ["sad", /\b(sad|breakup|heartbreak|viraham|judai|bewafa|dard|pain|tears)\b/i],
  ["dance", /\b(mass|dj|dance|item|folk|party|banger|peppy|jathara|dhamaka|kuthu|thaggede)\b/i],
  ["love", /\b(love|prema|premalo|premiste|romantic|melody|ishq|pyar|mohabbat|dil|hrudayam|kanulu|priya|sakhi)\b/i],
];
const detectMood = (t = "") => (MOODS.find(([, re]) => re.test(t)) || [])[0] || "";
const MOOD_WORD = { devotional: "devotional", sad: "sad", dance: "mass dance", love: "love" };

// GET /api/music/related?title=&artist=&exclude=a,b,c
router.get("/related", async (req, res) => {
  const title = String(req.query.title || "").slice(0, 160);
  const artist = String(req.query.artist || "").replace(/ - Topic$/i, "").slice(0, 80);
  const exclude = new Set(String(req.query.exclude || "").split(",").filter(Boolean));
  if (!title && !artist) return res.json({ results: [] });
  const seedText = `${title} ${artist}`;
  // the app is Telugu-first: the radio stays Telugu unless the song the user chose is clearly in another language
  const okLang = (x) => (LANGS.some(([n]) => n === x) ? x : "");
  const okMood = (x) => (MOOD_WORD[x] ? x : "");
  const lang = okLang(String(req.query.lang || "")) || detectLang(seedText) || "telugu";
  const mood = okMood(String(req.query.mood || "")) || detectMood(title) || detectMood(artist);
  const deity = (title.match(DEITY) || [])[0] || "";
  const moodWord = MOOD_WORD[mood] || "";
  const L = lang ? `${lang} ` : "";
  const queries = [];
  if (mood && moodWord) {
    if (artist) queries.push(`${artist} ${L}${moodWord} songs`.trim());
    if (deity) queries.push(`${deity} ${L}${moodWord} songs`.trim());
    queries.push(`${L}${moodWord} songs`.trim());
  }
  if (artist) queries.push(`${artist} ${L}songs`.trim());
  if (!mood) queries.push(`${L}songs like ${title}`.trim());
  const seenQ = new Set();
  const out = [];
  const seedSet = new Set(toWords(title));
  // which moods may sit next to the seed's mood (devotional never mixes with the others)
  const MOOD_OK = { devotional: ["devotional"], dance: ["dance"], love: ["love", "sad"], sad: ["sad", "love"] };
  const moodFits = (rm) => {
    if (!mood) return rm !== "devotional"; // an unlabelled seed: never drift into god songs
    if (!rm) return mood !== "devotional"; // an unlabelled song is fine except inside a devotional queue
    return MOOD_OK[mood].includes(rm);
  };
  const accept = (r, strict) => {
    if (!r.id || exclude.has(r.id) || out.some((o) => o.id === r.id)) return false;
    if (toWords(r.title).join(" ") === [...seedSet].join(" ")) return false; // same song re-uploaded
    const txt = `${r.title} ${r.artist}`;
    const rl = detectLang(txt);
    if (rl && rl !== lang) return false; // never another language
    if (strict && !rl) return false; // 1st pass: positively the same language
    const rm = detectMood(txt);
    if (!moodFits(rm)) return false;
    if (strict && mood && rm !== mood) return false; // 1st pass: positively the same mood
    return true;
  };
  const pool = [];
  for (const qq of queries) {
    if (seenQ.has(qq)) continue;
    seenQ.add(qq);
    try {
      const { results } = await runSearch(qq);
      pool.push(...results);
    } catch {}
    if (pool.length >= 40) break;
  }
  // 1st pass: same language AND same mood; 2nd pass (only if too few): same language
  for (const r of pool) if (accept(r, true)) out.push(r);
  if (out.length < 12) for (const r of pool) if (accept(r, false)) out.push(r);
  // songs of the same mood first
  if (mood) out.sort((x, y) => (detectMood(`${y.title} ${y.artist}`) === mood) - (detectMood(`${x.title} ${x.artist}`) === mood));
  res.json({ results: out.slice(0, 20), lang, mood });
});

router.get("/debug/ytdlp", async (req, res) => {
  const id = /^[\w-]{6,15}$/.test(req.query.id || "") ? req.query.id : "jNQXAC9IVRw";
  const t = Date.now();
  try {
    await ensureYtdlp();
    await resolveAudio(id, "normal", "audio", { force: true, hint: req.query.t ? { title: String(req.query.t).slice(0, 160), artist: String(req.query.a || "").slice(0, 100), duration: 0 } : { title: "Butta Bomma", artist: "Armaan Malik", duration: 0 } });
    res.json({ ok: true, ms: Date.now() - t, ...ytdlpStatus() });
  } catch (e) {
    res.json({ ok: false, error: e.message, ms: Date.now() - t, ...ytdlpStatus() });
  }
});

// GET /api/music/debug?id=VIDEO_ID -> shows which instances work from THIS server
router.get("/debug", async (req, res) => {
  const id = /^[\w-]{6,15}$/.test(req.query.id || "") ? req.query.id : "jNQXAC9IVRw";
  const inst = await instances();
  const results = await Promise.all(
    streamTasks(id, inst).map(async ([name, fn]) => {
      const t = Date.now();
      try {
        await fn();
        return { instance: name, ok: true, ms: Date.now() - t };
      } catch (e) {
        return { instance: name, ok: false, ms: Date.now() - t, error: e.message };
      }
    })
  );
  res.json({ videoId: id, instances: inst, results });
});

/* ---------- artists ---------- */

async function innerTubePost(q, params) {
  const url =
    process.env.INNERTUBE_URL ||
    "https://www.youtube.com/youtubei/v1/search?prettyPrint=false&key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: process.env.INNERTUBE_CLIENT_VERSION || "2.20260101.00.00",
            hl: "en",
            gl: "IN",
          },
        },
        query: q,
        params,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const fixImg = (u = "") => (u.startsWith("//") ? "https:" + u : u);

async function artistsInnerTube(q) {
  const d = await innerTubePost(q, "EgIQAg=="); // channels only
  const sections =
    d?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const out = [];
  for (const sec of sections) {
    for (const it of sec.itemSectionRenderer?.contents || []) {
      const c = it.channelRenderer;
      if (!c?.channelId) continue;
      const th = c.thumbnail?.thumbnails || [];
      out.push({
        id: c.channelId,
        name: c.title?.simpleText || c.title?.runs?.[0]?.text || "",
        thumbnail: fixImg(th[th.length - 1]?.url),
      });
    }
  }
  if (!out.length) throw new Error("no artists");
  return out.slice(0, 10);
}

async function artistsDataApi(q) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY not set");
  const base = process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3";
  const s = await getJSON(
    `${base}/search?part=snippet&type=channel&maxResults=8&q=${encodeURIComponent(q)}&key=${key}`
  );
  const out = (s.items || [])
    .filter((i) => i.id?.channelId)
    .map((i) => ({
      id: i.id.channelId,
      name: decode(i.snippet?.title),
      thumbnail: fixImg(i.snippet?.thumbnails?.medium?.url || i.snippet?.thumbnails?.default?.url),
    }));
  if (!out.length) throw new Error("no artists");
  return out;
}

function searchArtists(q, { noApi = false } = {}) {
  return cached(`a:${q.toLowerCase()}`, 24 * 60 * 60 * 1000, async () => {
    try {
      return await artistsInnerTube(q);
    } catch (e) {
      if (noApi || !process.env.YOUTUBE_API_KEY) throw e;
      return await artistsDataApi(q);
    }
  });
}

// GET /api/music/artists?q=...
router.get("/artists", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ results: [] });
  try {
    res.json({ results: await searchArtists(q) });
  } catch (e) {
    res.json({ results: [], error: e.message });
  }
});

/* ---------- autocomplete ---------- */

// GET /api/music/suggest?q=...
router.get("/suggest", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ suggestions: [] });
  try {
    const suggestions = await cached(`g:${q.toLowerCase()}`, 10 * 60 * 1000, async () => {
      const base = process.env.SUGGEST_URL || "https://suggestqueries.google.com/complete/search";
      const d = await getJSON(`${base}?client=firefox&ds=yt&hl=en&q=${encodeURIComponent(q)}`, 3000);
      return (d[1] || []).slice(0, 8);
    });
    res.json({ suggestions });
  } catch {
    res.json({ suggestions: [] });
  }
});

/* ---------- home rows ---------- */

const TOP_HEROES = [
  "Ram Charan",
  "Allu Arjun",
  "Mahesh Babu",
  "Jr NTR",
  "Prabhas",
  "Pawan Kalyan",
  "Chiranjeevi",
  "Nani",
  "Vijay Deverakonda",
  "Balakrishna",
  "Venkatesh",
  "Nagarjuna",
];
const TOP_ARTISTS = [
  "Sid Sriram",
  "Devi Sri Prasad",
  "Thaman S",
  "S. P. Balasubrahmanyam",
  "Anurag Kulkarni",
  "M. M. Keeravani",
  "Shreya Ghoshal",
  "Chinmayi",
  "Armaan Malik",
  "Anirudh Ravichander",
  "Arijit Singh",
  "A. R. Rahman",
];

// GET /api/music/home?artist=NAME  -> Telugu first (new releases, top charts, love, devotional ...), other languages last
const homeCache = new Map(); // artist -> { at, rows }
async function buildHome(artist) {
  const year = new Date().getFullYear();
  const jobs = [
    ["new", "New Telugu Releases", `new telugu songs ${year}`],
    ["telugu", "Top Telugu Songs", "top telugu songs"],
    ["charts", "Telugu Top Charts", "telugu top 50 chart songs"],
    ["made", "Made for You", artist ? `${artist} telugu songs` : "telugu melody songs"],
    ["love", "Telugu Love Songs", "telugu love songs"],
    ["dance", "Telugu Mass & Dance", "telugu mass dance songs"],
    ["devotional", "Telugu Devotional", "telugu devotional songs"],
    ["classics", "Telugu Evergreen Hits", "telugu evergreen hit songs"],
    ["trending", "Trending in India", "trending songs india"],
    ["hindi", "Hindi Hits", "latest hindi songs"],
  ];
  const rows = (
    await Promise.all(
      jobs.map(async ([id, title, q]) => {
        try {
          const r = await runSearch(q);
          return { id, title, type: "songs", items: r.results.slice(0, 15) };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  try {
    const items = await cached("top-artists-v2", 24 * 60 * 60 * 1000, async () => {
      const found = (
        await Promise.all(TOP_ARTISTS.map((n) => searchArtists(n, { noApi: true }).then((a) => a[0]).catch(() => null)))
      ).filter(Boolean);
      if (!found.length) throw new Error("none");
      return found;
    });
    rows.splice(Math.min(3, rows.length), 0, { id: "artists", title: "Popular Artists", type: "artists", items });
  } catch {}

  try {
    const heroes = await cached("heroes-v1", 24 * 60 * 60 * 1000, async () => {
      const found = await Promise.all(
        TOP_HEROES.map(async (name) => {
          const query = `${name} telugu hit songs`;
          let thumb = "";
          try {
            thumb = (await searchArtists(name, { noApi: true }))[0]?.thumbnail || "";
          } catch {}
          if (!thumb) {
            try {
              thumb = (await runSearch(query)).results[0]?.thumbnail || "";
            } catch {}
          }
          return { id: `hero-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, thumbnail: thumb, query };
        })
      );
      return found;
    });
    const at = rows.findIndex((r) => r.id === "artists");
    rows.splice(at >= 0 ? at + 1 : Math.min(4, rows.length), 0, { id: "heroes", title: "Popular Heroes", type: "artists", items: heroes });
  } catch {}

  return rows;
}
async function refreshHome(artist) {
  const rows = await buildHome(artist);
  if (rows.length) homeCache.set(artist, { at: Date.now(), rows });
  return rows;
}
router.get("/home", async (req, res) => {
  const artist = (req.query.artist || "").toString().trim().slice(0, 80);
  const hit = homeCache.get(artist) || homeCache.get("");
  if (hit) {
    if (Date.now() - hit.at > 20 * 60 * 1000 && homeCache.get(artist)) refreshHome(artist).catch(() => {});
    return res.json({ rows: hit.rows });
  }
  res.json({ rows: await refreshHome(artist) });
});
setTimeout(() => refreshHome("").catch(() => {}), 2000);
setInterval(() => refreshHome("").catch(() => {}), 20 * 60 * 1000).unref?.();

/* ---------- lyrics (LRCLIB, free, no key) ---------- */

const cleanTitle = (t = "") =>
  t
    .split("|")[0]
    .replace(/[([][^)\]]*[)\]]/g, "")
    .replace(/\b(official|video|lyrical|lyric|lyrics|full|song|audio|hd|4k|hq|with|music)\b/gi, "")
    .replace(/[-–—]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

// GET /api/music/lyrics?title=&artist=&duration=
router.get("/lyrics", async (req, res) => {
  const title = (req.query.title || "").toString();
  const duration = Number(req.query.duration) || 0;
  const q = cleanTitle(title);
  if (!q) return res.json({ synced: null, plain: null });
  try {
    const out = await cached(`l:${q.toLowerCase()}:${duration}`, 24 * 60 * 60 * 1000, async () => {
      const base = process.env.LRCLIB_URL || "https://lrclib.net";
      const list = await getJSON(`${base}/api/search?q=${encodeURIComponent(q)}`, 7000, {
        "user-agent": "HiMusic/1.0",
      });
      const ok = (Array.isArray(list) ? list : []).filter((x) => x.syncedLyrics || x.plainLyrics);
      const near = duration ? ok.filter((x) => Math.abs((x.duration || 0) - duration) <= 20) : ok;
      const pool = near.length ? near : duration ? [] : ok;
      const pick = pool.find((x) => x.syncedLyrics) || pool[0];
      return pick
        ? { synced: pick.syncedLyrics || null, plain: pick.plainLyrics || null, title: pick.trackName, artist: pick.artistName }
        : { synced: null, plain: null };
    });
    res.json(out);
  } catch {
    res.json({ synced: null, plain: null });
  }
});

export default router;
