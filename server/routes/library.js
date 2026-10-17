import { Router } from "express";
import auth from "../middleware/auth.js";
import User from "../models/User.js";

const router = Router();
router.use(auth);

const clean = (s) => ({
  id: s.id,
  title: s.title,
  artist: s.artist,
  thumbnail: s.thumbnail,
  duration: s.duration,
});

router.get("/", async (req, res) => {
  const u = await User.findById(req.userId);
  if (!u) return res.status(404).json({ error: "User not found" });
  res.json({ liked: u.liked, history: u.history, playlists: u.playlists });
});

// Liked songs (toggle)
router.post("/like", async (req, res) => {
  const song = clean(req.body);
  if (!song.id) return res.status(400).json({ error: "song id required" });
  const u = await User.findById(req.userId);
  const exists = u.liked.some((s) => s.id === song.id);
  u.liked = exists ? u.liked.filter((s) => s.id !== song.id) : [song, ...u.liked];
  await u.save();
  res.json({ liked: u.liked });
});

// Recently played
router.post("/history", async (req, res) => {
  const song = clean(req.body);
  if (!song.id) return res.status(400).json({ error: "song id required" });
  const u = await User.findById(req.userId);
  u.history = [song, ...u.history.filter((s) => s.id !== song.id)].slice(0, 50);
  await u.save();
  res.json({ history: u.history });
});

// Playlists
const validCover = (c) => typeof c === "string" && (c === "" || (c.startsWith("data:image/") && c.length < 300000));

router.post("/playlists", async (req, res) => {
  const name = (req.body.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "name required" });
  const cover = req.body.cover || "";
  if (!validCover(cover)) return res.status(400).json({ error: "invalid cover image" });
  const u = await User.findById(req.userId);
  u.playlists.push({ name, cover, songs: [] });
  await u.save();
  res.json({ playlists: u.playlists });
});

// rename and/or change cover photo
router.patch("/playlists/:pid", async (req, res) => {
  const u = await User.findById(req.userId);
  const p = u.playlists.id(req.params.pid);
  if (!p) return res.status(404).json({ error: "playlist not found" });
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "name required" });
    p.name = name;
  }
  if (req.body.cover !== undefined) {
    if (!validCover(req.body.cover)) return res.status(400).json({ error: "invalid cover image" });
    p.cover = req.body.cover;
  }
  await u.save();
  res.json({ playlists: u.playlists });
});

// add many songs at once (playlist import)
router.post("/playlists/:pid/songs/bulk", async (req, res) => {
  const u = await User.findById(req.userId);
  const p = u.playlists.id(req.params.pid);
  if (!p) return res.status(404).json({ error: "Playlist not found" });
  const songs = (Array.isArray(req.body.songs) ? req.body.songs : []).slice(0, 300).map(clean).filter((s) => s.id);
  for (const s of songs) if (!p.songs.some((x) => x.id === s.id)) p.songs.push(s);
  await u.save();
  res.json({ playlists: u.playlists });
});

router.delete("/playlists/:pid", async (req, res) => {
  const u = await User.findById(req.userId);
  u.playlists = u.playlists.filter((p) => String(p._id) !== req.params.pid);
  await u.save();
  res.json({ playlists: u.playlists });
});

router.post("/playlists/:pid/songs", async (req, res) => {
  const song = clean(req.body);
  const u = await User.findById(req.userId);
  const p = u.playlists.id(req.params.pid);
  if (!p) return res.status(404).json({ error: "playlist not found" });
  if (!p.songs.some((s) => s.id === song.id)) p.songs.push(song);
  await u.save();
  res.json({ playlists: u.playlists });
});

router.delete("/playlists/:pid/songs/:sid", async (req, res) => {
  const u = await User.findById(req.userId);
  const p = u.playlists.id(req.params.pid);
  if (!p) return res.status(404).json({ error: "playlist not found" });
  p.songs = p.songs.filter((s) => s.id !== req.params.sid);
  await u.save();
  res.json({ playlists: u.playlists });
});

export default router;
