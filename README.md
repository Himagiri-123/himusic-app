# HiMusic

Ad-free music player (React PWA + Node/Express + MongoDB). Streams audio through open-source Piped/Invidious APIs, so there are no YouTube ads and audio-only mode saves data.

Features: search, audio-only mode, audio/video toggle, mini player + full player, background play (Media Session), autoplay next (related songs), recently played, liked songs, custom playlists, dark/light mode, installable PWA.

```
himusic/
  server/   Express API  -> deploy on Render
  client/   React + Vite -> deploy on Vercel
```

## Run locally (VS Code)

```bash
# 1. backend
cd server
cp .env.example .env     # fill MONGO_URI and JWT_SECRET
npm install
npm run dev              # http://localhost:5000

# 2. frontend (new terminal)
cd client
cp .env.example .env     # VITE_API_URL=http://localhost:5000
npm install
npm run dev              # http://localhost:5173
```

MongoDB: create a free cluster on MongoDB Atlas, add a database user, allow access from anywhere (0.0.0.0/0), copy the connection string into `MONGO_URI`.

## Push to GitHub

```bash
cd himusic
git init
git add .
git commit -m "HiMusic initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/himusic.git
git push -u origin main
```

## Deploy backend on Render

1. Render -> New -> Web Service -> connect the GitHub repo.
2. Root Directory: `server`
3. Build Command: `npm install` | Start Command: `npm start`
4. Environment variables:
   - `MONGO_URI` = your Atlas string
   - `JWT_SECRET` = long random string
   - `CLIENT_ORIGIN` = your Vercel URL (add after step below, e.g. `https://himusic.vercel.app`)
5. Deploy and copy the URL, e.g. `https://himusic-api.onrender.com`.

Free Render services sleep after inactivity, so the first request can take ~30s.

## Deploy frontend on Vercel

1. Vercel -> Add New -> Project -> import the repo.
2. Root Directory: `client` (framework: Vite is auto-detected).
3. Environment variable: `VITE_API_URL` = your Render URL (no trailing slash).
4. Deploy. Then go back to Render and set `CLIENT_ORIGIN` to the Vercel URL and redeploy.

## Install as app

Open the Vercel URL on your phone in Chrome -> menu -> "Install app" / "Add to Home screen".

## Notes

- Public Piped/Invidious instances go down or get rate limited sometimes. If search or play fails, set your own instances with `PIPED_INSTANCES` / `INVIDIOUS_INSTANCES` env vars on Render (comma separated) or self-host one.
- Player engines: **Auto** tries the direct ad-free stream first and falls back to the official YouTube player (IFrame API) when Piped/Invidious fail. **YouTube** always uses the YouTube player (toggle in the full player). In the YouTube player, ads are blocked only if your browser blocks them (Brave does), audio-only does not save data, and background play on a locked phone screen is not guaranteed.
- Song not playing? Open `<your-backend-url>/api/music/debug` in the browser. It shows which instances work from your server (ok true/false with the error). If all fail, set working instances in `PIPED_INSTANCES` / `INVIDIOUS_INSTANCES`.
- Streaming from YouTube through third-party front-ends may go against YouTube's Terms of Service. Use for personal or learning purposes.
