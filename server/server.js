import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import authRoutes from "./routes/auth.js";
import musicRoutes from "./routes/music.js";
import libraryRoutes from "./routes/library.js";

const app = express();

const origins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ ok: true, app: "HiMusic API" }));
app.use("/api/auth", authRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/library", libraryRoutes);

const PORT = process.env.PORT || 5000;

async function start() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");
  app.listen(PORT, () => console.log(`API on :${PORT}`));
}
start().catch((e) => {
  console.error(e);
  process.exit(1);
});
