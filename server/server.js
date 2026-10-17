import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import realAuthRouter from "./routes/auth.js";
import musicRoutes from "./routes/music.js";
import libraryRoutes from "./routes/library.js";
import socialRoutes from "./routes/social.js";
import auth from "./middleware/auth.js";

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct client IPs (rate limits)
app.disable("x-powered-by");

const origins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true, exposedHeaders: ["Retry-After", "Content-Range", "Accept-Ranges"] }));
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ ok: true, app: "HiMusic API" }));

// Music API needs a logged-in user, except the signed audio proxy (the <audio> tag can't send headers;
// it carries its own short-lived signature) and the debug pages.
const musicGate = (req, res, next) =>
  req.path.startsWith("/audio/") || req.path.startsWith("/debug") ? next() : auth(req, res, next);

async function start() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing");
    process.exit(1);
  }
  const secret = process.env.JWT_SECRET || "";
  if (!secret) {
    console.error("JWT_SECRET missing — set a long random string in the server environment.");
    process.exit(1);
  }
  if (secret.length < 24) console.warn("WARNING: JWT_SECRET is short; use 32+ random characters.");

  app.use("/api/auth", await realAuthRouter());
  app.use("/api/music", musicGate, musicRoutes);
  app.use("/api/library", libraryRoutes);
  app.use("/api/social", socialRoutes);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`API on :${PORT}`));
}
start().catch((e) => {
  console.error(e);
  process.exit(1);
});
