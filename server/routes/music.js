import { Router } from "express";
import { Readable } from "node:stream";
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

async function runSearch(q) {
  return cached(`s:${q.toLowerCase()}`, 60 * 60 * 1000, async () => {
    const errors = [];
    let tiers = SEARCH_TIERS.filter(([n]) => !(tierDownAt[n] && Date.now() - tierDownAt[n] < 3 * 60 * 1000));
    if (!tiers.length) tiers = SEARCH_TIERS;
    for (const [name, fn] of tiers) {
      try {
        const results = await fn(q);
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
        await resolveAudio(id, q);
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


// Signed audio proxy: the <audio> tag requests this, we fetch the real file (with Range) and pipe it back.
router.get("/audio/:id", async (req, res) => {
  const { id } = req.params;
  const kind = req.query.k === "video" ? "video" : "audio";
  const q = QUALITIES.includes(req.query.q) ? req.query.q : "normal";
  if (!/^[\w-]{6,15}$/.test(id) || !verifyAudio(id, kind, q, req.query.exp, req.query.sig)) return res.status(403).end();
  try {
    const info = await resolveAudio(id, q, kind);
    const headers = { "User-Agent": UA };
    // Range requests are capped (~1 MB per request) so a skipped song never downloads the whole file.
    // Requests with no Range header (offline downloads) get the full file.
    const CAP = Number(process.env.CHUNK_BYTES) || 1024 * 1024;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), start + CAP - 1) : start + CAP - 1;
      headers.Range = `bytes=${start}-${end}`;
    } else if (req.headers.range) headers.Range = req.headers.range;
    const up = await fetch(info.url, { headers });
    if (!up.ok && up.status !== 206) {
      dropAudio(id, q, kind);
      return res.status(502).end();
    }
    res.status(up.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = up.headers.get(h);
      if (v) res.set(h, v);
    }
    res.set("Cache-Control", "private, max-age=3600");
    const body = Readable.fromWeb(up.body);
    req.on("close", () => body.destroy());
    body.on("error", () => res.end());
    body.pipe(res);
  } catch (e) {
    console.error("audio proxy failed", id, e.message);
    if (!res.headersSent) res.status(502).end();
  }
});

// Songs "like this one" for auto-play (radio): other tracks by the same artist / same mood, never repeats the seed
router.get("/related", async (req, res) => {
  const title = String(req.query.title || "").slice(0, 120);
  const artist = String(req.query.artist || "").replace(/ - Topic$/i, "").slice(0, 80);
  const exclude = new Set(String(req.query.exclude || "").split(",").filter(Boolean));
  if (!title && !artist) return res.json({ results: [] });
  const queries = [`${artist} songs`.trim(), `${title} ${artist} similar songs`.trim()];
  const out = [];
  for (const qq of queries) {
    try {
      const { results } = await runSearch(qq);
      for (const r of results) if (r.id && !exclude.has(r.id) && !out.some((o) => o.id === r.id)) out.push(r);
    } catch {}
    if (out.length >= 12) break;
  }
  res.json({ results: out.slice(0, 20) });
});

router.get("/debug/ytdlp", async (req, res) => {
  const id = /^[\w-]{6,15}$/.test(req.query.id || "") ? req.query.id : "jNQXAC9IVRw";
  const t = Date.now();
  try {
    await ensureYtdlp();
    await resolveAudio(id, "normal", "audio", { force: true });
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

const TOP_ARTISTS = [
  "Sid Sriram",
  "Anirudh Ravichander",
  "Arijit Singh",
  "A. R. Rahman",
  "Devi Sri Prasad",
  "Shreya Ghoshal",
  "S. P. Balasubrahmanyam",
  "Thaman S",
];

// GET /api/music/home?artist=NAME
router.get("/home", async (req, res) => {
  const artist = (req.query.artist || "").toString().trim().slice(0, 80);
  const jobs = [
    ["trending", "Trending Hits", "trending songs india"],
    ["made", "Made for You", artist ? `${artist} songs` : "chill telugu songs"],
    ["telugu", "Top Telugu", "top telugu songs"],
    ["devotional", "Devotional", "telugu devotional songs"],
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
    const items = await cached("top-artists", 24 * 60 * 60 * 1000, async () => {
      const found = (
        await Promise.all(TOP_ARTISTS.map((n) => searchArtists(n, { noApi: true }).then((a) => a[0]).catch(() => null)))
      ).filter(Boolean);
      if (!found.length) throw new Error("none");
      return found;
    });
    rows.splice(Math.min(3, rows.length), 0, { id: "artists", title: "Popular Artists", type: "artists", items });
  } catch {}

  res.json({ rows });
});

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
