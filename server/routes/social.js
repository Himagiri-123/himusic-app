import { Router } from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import User from "../models/User.js";
import { Share, Collab, Play } from "../models/Social.js";
import { playlistInfo } from "../ytdlp.js";

const router = Router();
router.use(auth);

const clean = (s) => ({ id: String(s.id || ""), title: String(s.title || "").slice(0, 200), artist: String(s.artist || "").slice(0, 120), thumbnail: String(s.thumbnail || "").slice(0, 300), duration: Number(s.duration) || 0 });
const code = () => crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error("social error:", e);
    res.status(500).json({ error: "Server error" });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

/* ---------- share a playlist by link (snapshot) ---------- */
router.post("/share", wrap(async (req, res) => {
  const u = await User.findById(req.userId);
  let name, songs, cover = "";
  if (req.body.kind === "liked") ({ name, songs } = { name: "Liked Songs", songs: u.liked });
  else {
    const p = u.playlists.id(req.body.playlistId);
    if (!p) throw fail(404, "Playlist not found");
    ({ name, songs, cover } = p);
  }
  if (!songs.length) throw fail(400, "Add some songs first");
  const c = code();
  await Share.create({ code: c, name, owner: u.name, songs: songs.slice(0, 300).map(clean), cover: cover.length < 300000 ? cover : "" });
  res.json({ code: c });
}));
router.get("/share/:code", wrap(async (req, res) => {
  const s = await Share.findOne({ code: String(req.params.code).slice(0, 12) });
  if (!s) throw fail(404, "This link is no longer valid");
  res.json({ name: s.name, owner: s.owner, cover: s.cover, songs: s.songs });
}));

/* ---------- import (YouTube playlist links, Spotify public playlist links) ---------- */
router.get("/import/preview", wrap(async (req, res) => {
  const raw = String(req.query.url || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail(400, "Paste a full playlist link");
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    const list = url.searchParams.get("list");
    if (!list || !/^[\w-]{10,60}$/.test(list)) throw fail(400, "That link has no playlist in it");
    try {
      const r = await playlistInfo(`https://www.youtube.com/playlist?list=${list}`);
      if (!r.tracks.length) throw new Error("empty");
      return res.json({ source: "youtube", ...r });
    } catch (e) {
      throw fail(502, "Could not read that YouTube playlist (it must be public). " + (e.message || ""));
    }
  }
  if (host === "open.spotify.com") {
    const m = /\/playlist\/(\w{10,40})/.exec(url.pathname) || /\/album\/(\w{10,40})/.exec(url.pathname);
    if (!m) throw fail(400, "Paste a Spotify playlist or album link");
    const kind = url.pathname.includes("/album/") ? "album" : "playlist";
    const r = await fetch(`https://open.spotify.com/embed/${kind}/${m[1]}`, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
    const html = r?.ok ? await r.text() : "";
    const j = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    let entity;
    try {
      entity = JSON.parse(j).props.pageProps.state.data.entity;
    } catch {}
    const list = entity?.trackList || [];
    if (!list.length) throw fail(502, "Could not read that Spotify playlist (it must be public). Try a YouTube playlist link instead.");
    return res.json({
      source: "spotify",
      name: entity.name || entity.title || "Spotify playlist",
      tracks: list.map((t) => ({ title: t.title, artist: t.subtitle || "", duration: Math.round((t.duration || 0) / 1000) })),
      needsMatch: true, // no YouTube ids yet; the app searches each one
    });
  }
  throw fail(400, "Only YouTube and Spotify playlist links are supported");
}));

/* ---------- collaborative playlists ---------- */
const view = (c, uid) => ({
  id: c._id,
  code: c.code,
  name: c.name,
  mine: String(c.owner) === String(uid),
  members: [...(c.memberNames?.values?.() || [])],
  songs: c.songs,
});
const isMember = (c, uid) => c.members.some((m) => String(m) === String(uid));

router.get("/collab", wrap(async (req, res) => {
  const list = await Collab.find({ members: req.userId }).sort({ updatedAt: -1 });
  res.json({ collabs: list.map((c) => view(c, req.userId)) });
}));
router.post("/collab", wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) throw fail(400, "Name required");
  if ((await Collab.countDocuments({ owner: req.userId })) >= 20) throw fail(400, "Too many shared playlists");
  const u = await User.findById(req.userId);
  const c = await Collab.create({ code: code(), name, owner: u._id, members: [u._id], memberNames: { [u._id]: u.name }, songs: [] });
  res.json(view(c, u._id));
}));
router.post("/collab/join", wrap(async (req, res) => {
  const c = await Collab.findOne({ code: String(req.body?.code || "").slice(0, 12) });
  if (!c) throw fail(404, "This invite link is not valid");
  const u = await User.findById(req.userId);
  if (!isMember(c, u._id)) {
    if (c.members.length >= 30) throw fail(400, "This playlist is full");
    c.members.push(u._id);
    c.memberNames.set(String(u._id), u.name);
    await c.save();
  }
  res.json(view(c, u._id));
}));
router.get("/collab/:id", wrap(async (req, res) => {
  const c = await Collab.findById(req.params.id).catch(() => null);
  if (!c || !isMember(c, req.userId)) throw fail(404, "Playlist not found");
  res.json(view(c, req.userId));
}));
router.post("/collab/:id/songs", wrap(async (req, res) => {
  const c = await Collab.findById(req.params.id).catch(() => null);
  if (!c || !isMember(c, req.userId)) throw fail(404, "Playlist not found");
  const s = clean(req.body);
  if (!s.id) throw fail(400, "song id required");
  if (c.songs.length >= 500) throw fail(400, "Playlist is full");
  if (!c.songs.some((x) => x.id === s.id)) {
    const u = await User.findById(req.userId);
    c.songs.push({ ...s, addedBy: u.name });
    await c.save();
  }
  res.json(view(c, req.userId));
}));
router.delete("/collab/:id/songs/:sid", wrap(async (req, res) => {
  const c = await Collab.findById(req.params.id).catch(() => null);
  if (!c || !isMember(c, req.userId)) throw fail(404, "Playlist not found");
  c.songs = c.songs.filter((x) => x.id !== req.params.sid);
  await c.save();
  res.json(view(c, req.userId));
}));
router.post("/collab/:id/leave", wrap(async (req, res) => {
  const c = await Collab.findById(req.params.id).catch(() => null);
  if (!c || !isMember(c, req.userId)) return res.json({ ok: true });
  if (String(c.owner) === String(req.userId)) await c.deleteOne();
  else {
    c.members = c.members.filter((m) => String(m) !== String(req.userId));
    c.memberNames.delete(String(req.userId));
    await c.save();
  }
  res.json({ ok: true });
}));

/* ---------- stats for HiMusic Wrapped ---------- */
router.post("/stats/play", wrap(async (req, res) => {
  const s = clean(req.body);
  const secs = Math.min(Number(req.body?.secs) || 0, 3600);
  if (!s.id || secs < 30) return res.json({ ok: false });
  await Play.create({ user: req.userId, ...s, secs });
  res.json({ ok: true });
}));
router.get("/stats/wrapped", wrap(async (req, res) => {
  const year = Math.min(Math.max(Number(req.query.year) || new Date().getFullYear(), 2020), 2100);
  const match = { user: new mongoose.Types.ObjectId(req.userId), at: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) } };
  const [songs, artists, total, months] = await Promise.all([
    Play.aggregate([{ $match: match }, { $group: { _id: "$id", title: { $first: "$title" }, artist: { $first: "$artist" }, thumbnail: { $first: "$thumbnail" }, plays: { $sum: 1 }, secs: { $sum: "$secs" } } }, { $sort: { plays: -1, secs: -1 } }, { $limit: 5 }]),
    Play.aggregate([{ $match: match }, { $group: { _id: "$artist", plays: { $sum: 1 }, secs: { $sum: "$secs" }, thumbnail: { $first: "$thumbnail" } } }, { $sort: { plays: -1, secs: -1 } }, { $limit: 5 }]),
    Play.aggregate([{ $match: match }, { $group: { _id: null, plays: { $sum: 1 }, secs: { $sum: "$secs" }, uniq: { $addToSet: "$id" } } }]),
    Play.aggregate([{ $match: match }, { $group: { _id: { $month: "$at" }, secs: { $sum: "$secs" } } }, { $sort: { secs: -1 } }, { $limit: 1 }]),
  ]);
  const t = total[0] || { plays: 0, secs: 0, uniq: [] };
  res.json({
    year,
    plays: t.plays,
    minutes: Math.round(t.secs / 60),
    uniqueSongs: t.uniq.length,
    topSongs: songs.map((s) => ({ id: s._id, title: s.title, artist: s.artist, thumbnail: s.thumbnail, plays: s.plays })),
    topArtists: artists.map((a) => ({ name: a._id, plays: a.plays, thumbnail: a.thumbnail })),
    topMonth: months[0]?._id || null,
  });
}));

export default router;
