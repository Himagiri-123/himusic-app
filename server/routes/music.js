import { Router } from "express";

const router = Router();

// Open-source YouTube front-ends. Public instances go down often,
// so we try them one by one. Override with env vars if you self-host.
const PIPED = (
  process.env.PIPED_INSTANCES ||
  "https://pipedapi.kavin.rocks,https://pipedapi.adminforge.de,https://api.piped.private.coffee"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INVIDIOUS = (process.env.INVIDIOUS_INSTANCES || "https://inv.nadeko.net,https://yewtu.be")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function getJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function firstOk(tasks) {
  let lastErr;
  for (const t of tasks) {
    try {
      return await t();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No instance available");
}

const idFromUrl = (u = "") => (u.match(/[?&]v=([^&]+)/) || [])[1] || "";

// GET /api/music/search?q=...
router.get("/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ results: [] });
  try {
    const tasks = [
      ...PIPED.map((base) => async () => {
        const d = await getJSON(
          `${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`
        );
        const items = (d.items || []).filter((i) => i.url?.includes("watch"));
        if (!items.length) throw new Error("empty");
        return items.map((i) => ({
          id: idFromUrl(i.url),
          title: i.title,
          artist: i.uploaderName,
          thumbnail: i.thumbnail,
          duration: i.duration,
        }));
      }),
      ...INVIDIOUS.map((base) => async () => {
        const d = await getJSON(
          `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`
        );
        if (!d.length) throw new Error("empty");
        return d.map((i) => ({
          id: i.videoId,
          title: i.title,
          artist: i.author,
          thumbnail: i.videoThumbnails?.[3]?.url || i.videoThumbnails?.[0]?.url,
          duration: i.lengthSeconds,
        }));
      }),
    ];
    res.json({ results: await firstOk(tasks) });
  } catch (e) {
    res.status(502).json({ error: "Search failed. Streaming instances busy, try again." });
  }
});

// GET /api/music/stream/:id  -> direct audio + video URLs and related songs
router.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: "bad id" });
  try {
    const tasks = [
      ...PIPED.map((base) => async () => {
        const d = await getJSON(`${base}/streams/${id}`, 10000);
        const audio = (d.audioStreams || [])
          .filter((s) => s.url && s.mimeType?.startsWith("audio"))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (!audio.length) throw new Error("no audio");
        // lowest-ish bitrate that is still decent saves data
        const lite = audio.find((s) => s.bitrate <= 130000) || audio[audio.length - 1];
        const video = (d.videoStreams || []).find(
          (s) => s.url && !s.videoOnly && s.mimeType?.startsWith("video")
        );
        return {
          audioUrl: lite.url,
          videoUrl: video?.url || null,
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
      }),
      ...INVIDIOUS.map((base) => async () => {
        const d = await getJSON(`${base}/api/v1/videos/${id}`, 10000);
        const audio = (d.adaptiveFormats || []).filter((f) =>
          f.type?.startsWith("audio")
        );
        if (!audio.length) throw new Error("no audio");
        audio.sort((a, b) => Number(a.bitrate) - Number(b.bitrate));
        const muxed = (d.formatStreams || [])[0];
        return {
          audioUrl: audio[0].url,
          videoUrl: muxed?.url || null,
          related: (d.recommendedVideos || []).slice(0, 15).map((r) => ({
            id: r.videoId,
            title: r.title,
            artist: r.author,
            thumbnail: r.videoThumbnails?.[3]?.url,
            duration: r.lengthSeconds,
          })),
        };
      }),
    ];
    res.json(await firstOk(tasks));
  } catch (e) {
    res.status(502).json({ error: "Could not get stream. Try another song." });
  }
});

export default router;
