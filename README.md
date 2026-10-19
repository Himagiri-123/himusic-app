# HiMusic

Ad-free music player (React PWA + Node/Express + MongoDB). Streams audio through open-source Piped/Invidious APIs, so there are no YouTube ads and audio-only mode saves data.

Features (Spotify-style UI: black #121212, green #1DB954):
- Home: time greeting, 6 recent boxes, horizontal rows (Trending, Made for You, Top Telugu, Popular Artists...), dynamic cover-color gradients
- Search: live results + suggestions while typing, artists (round photos) + songs, browse categories (Genres, Moods, Podcasts, Devotional...)
- Player: mini player (heart + play/pause) and full-screen player with shuffle, repeat (all/one), seekbar, Up Next queue, synced lyrics (LRCLIB), audio-only / video toggle
- Library: Liked Songs, Recently played, custom playlists with your own photo and name, artist pages
- System: JWT login, lock-screen controls (Media Session), background play, near-gapless next song (pre-buffering), Back button closes player/pages
- PWA: install prompt, offline app shell + seen cover photos + last home rows + library
- Desktop: bottom bar becomes a left sidebar on wide screens

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

## Reliable search (YouTube Data API key, free)

Search tries 3 ways in order: official YouTube Data API (needs key) -> YouTube web search (no key) -> Piped/Invidious instances. The key makes search stable, so set it.

1. Go to https://console.cloud.google.com -> create a project.
2. APIs & Services -> Library -> "YouTube Data API v3" -> Enable.
3. APIs & Services -> Credentials -> Create credentials -> API key (restrict it to YouTube Data API v3).
4. Put it in `server/.env` as `YOUTUBE_API_KEY=...` and in Render -> Environment.

Free quota is 10,000 units/day, about 100 searches per day (each search costs ~101 units). Check what works on your server: `<backend-url>/api/music/debug/search?q=arijit`.

## Notes on the new features

- Instant search: suggestions are free, but each search can use YouTube Data API quota (about 100 searches/day on the free key). Results are cached 10 min on the server, and it falls back to YouTube web search when quota ends.
- Lyrics come from LRCLIB (free). Many Telugu songs are not in it yet, the app then shows "No lyrics found".
- Gapless is best-effort: the next song is pre-buffered in a second player. It is not sample-accurate and does not apply in the YouTube-player fallback.
- Offline: the app, cover photos you have seen, last home rows and your library work offline. Songs themselves need internet.

## Login security (Gmail OTP)
- Sign-up needs a Gmail address and a 6-digit code emailed to it; the account is only created after the code is confirmed. Accounts are saved in MongoDB, so every user gets their own liked songs, playlists and history.
- Passwords are hashed (bcrypt), codes expire in 10 minutes, wrong tries/logins are rate limited, "Forgot password" works by code too.
- To stop other people using your app: set `ALLOWED_EMAILS=you@gmail.com,...` on Render (only those can sign up), then optionally keep it.
- Email sending (pick one in Render env vars): **Brevo** (`BREVO_API_KEY`, `MAIL_FROM`) or the **Google Apps Script relay** (`server/mail-relay.gs`, steps inside). Render free blocks normal SMTP.
- `JWT_SECRET` must be set (32+ random characters) or the server will not start.

## Background / lock-screen play
The server now has its own audio engine (yt-dlp, downloaded automatically on first use) and streams audio to a normal `<audio>` player, so the notification bar / lock screen controls work. Check it at `/api/music/debug/ytdlp`. If YouTube blocks Render's IP it shows an error there; then set `YT_COOKIES` or `YTDLP_PROXY` (see `.env.example`).
On **OriginOS / Funtouch (vivo)**: Settings → Battery → Background power consumption → HiMusic → *Allow*; also lock the app in Recents and enable *Auto-start*. Install the app as a PWA (Add to Home screen) for best results.

## Offline downloads
Song menu (⋯) → *Download for offline*, or the download button in the player / on a playlist (*download all*). Files are stored inside the app (browser storage) per user, listed in Your Library → *Downloaded*, and play with no internet. They do not appear in the phone gallery/files app, and clearing browser data or logging out on another account removes access.

## New features (Settings = avatar on Home -> Settings)
- **Streaming quality**: Auto uses Low on mobile data and High on Wi-Fi (Chrome/Android). Low ~ half the data of Normal. The server also sends audio in ~1 MB pieces, so skipping a song never downloads the whole file.
- **Sleep timer** (moon button in the full player): 15 / 30 / 60 min or end of song; the music fades out.
- **Autoplay similar songs** (radio) when your playlist ends; **Crossfade** 3-12 s; **Equalizer** (presets + extra bass). Equalizer is off by default because on some phones WebAudio can stop when the screen is off.
- **Offline only** mode: no internet calls at all, only downloaded songs.
- **Voice search** (mic in Search; Telugu / English / Hindi). Needs Chrome/Android and internet.
- **Share**: song menu -> Share on WhatsApp / Copy link; playlists have a WhatsApp button. Friends open the link, log in, and play/save it.
- **Shared playlists**: Library -> New shared playlist, send the invite link; everyone can add songs (updates every 15 s).
- **Import**: Library -> Import playlist (public YouTube playlist link, or Spotify link - Spotify needs each song to be searched on YouTube, so it can take a minute).
- **HiMusic Wrapped**: Library -> Your HiMusic Wrapped. Counts songs you listened to for 30 s or more.

## Android app (APK) + auto update
The Android app is a thin shell (Capacitor) that opens your live website, so **every website update reaches the app automatically** with no new APK. The shell adds what browsers cannot do: a real notification + lock-screen / Origin island controls and music that keeps playing in the background (foreground service).

Build it on GitHub (no Android Studio needed):
1. Push the code to GitHub (the repo must be **public** so the download link works for everyone).
2. GitHub repo -> Settings -> Secrets and variables -> Actions -> **Variables**: `APP_URL` = your Vercel URL (https://....vercel.app) and `API_URL` = your Render URL.
3. Create the app: `git tag v1.0.0 && git push origin v1.0.0` (or Actions -> "Build Android app" -> Run workflow). After ~5 minutes the APK is in **Releases** as `HiMusic.apk`.
4. Vercel -> Environment variables: `VITE_GITHUB_REPO` = `yourname/yourrepo`, then redeploy. This switches on the **Download Android App** button (Settings) and the "new app version" popup inside the app.
5. Install on the phone: open the APK, allow "install unknown apps". On first start allow **Notifications**. OriginOS: Battery -> HiMusic -> Allow background activity.
- Website updates: when you deploy a new version, the app / PWA shows a **New version available -> Update now** popup.
- Only change native code (`client/android`) -> push a new tag (v1.0.1, ...) for a new APK; the app then shows an "update" popup too. All builds use the same signing key (`client/android/app/himusic.keystore`), so updates install over the old app. Replace this key with your own secret one if you publish the app publicly.
- Add `https://*.vercel.app` to `CLIENT_ORIGIN` on Render if you use Vercel preview URLs (wildcards are supported).

## If `/api/music/debug/ytdlp` says "Sign in to confirm you're not a bot"
YouTube blocks many server IPs (Render included). The server now tries several YouTube "clients" automatically and remembers the one that works (the debug page lists each attempt). If all fail:
1. Make a **new throwaway Google account** (never your main one).
2. In a Chrome **incognito** window, log in to youtube.com with it, then export cookies with the "Get cookies.txt LOCALLY" extension (youtube.com only), then close the incognito window.
3. Render -> Environment: add `YT_COOKIES` = the whole text of the cookies file. If line breaks get lost, add `YT_COOKIES_B64` = base64 of the file instead (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))`).
4. Redeploy and open the debug link again. Cookies can expire after a while; repeat step 2-3 then.
While yt-dlp is blocked, the app pauses it for 3-10 minutes (so songs do not wait) and uses the backup players; background play is only reliable with the yt-dlp engine working.
Last resort: run the server on a home PC / Termux phone (a normal home IP is not blocked), or set `YTDLP_PROXY` to a proxy.

## Install as app

Open the Vercel URL on your phone in Chrome -> menu -> "Install app" / "Add to Home screen".

## Notes

- Public Piped/Invidious instances go down or get rate limited sometimes. If search or play fails, set your own instances with `PIPED_INSTANCES` / `INVIDIOUS_INSTANCES` env vars on Render (comma separated) or self-host one.
- Player engines: **Auto** tries the direct ad-free stream first and falls back to the official YouTube player (IFrame API) when Piped/Invidious fail. **YouTube** always uses the YouTube player (toggle in the full player). In the YouTube player, ads are blocked only if your browser blocks them (Brave does), audio-only does not save data, and background play on a locked phone screen is not guaranteed.
- Song not playing? Open `<your-backend-url>/api/music/debug` in the browser. It shows which instances work from your server (ok true/false with the error). If all fail, set working instances in `PIPED_INSTANCES` / `INVIDIOUS_INSTANCES`.
- Streaming from YouTube through third-party front-ends may go against YouTube's Terms of Service. Use for personal or learning purposes.


## Fixing the YouTube bot block (cookies via Render Secret Files)
1. In a private/incognito window sign in to YouTube with a throwaway Google account, then export youtube.com cookies as `cookies.txt` (extension "Get cookies.txt LOCALLY"), close the window.
2. Render -> your service -> Environment -> **Secret Files** -> Add file named `cookies.txt` and paste the contents.
3. Redeploy, then open `/api/music/debug/ytdlp`: expect `"ok":true` and `cookieInfo.loggedIn:true`.
(`YT_COOKIES_FILE` can point to a different path.)

## APK download shows 404
The button points to the latest GitHub Release. Make sure the repo is public, `VITE_GITHUB_REPO` is exactly `owner/repo`, GitHub Actions variables `APP_URL` and `API_URL` are set, then run Actions -> "Build Android app" -> Run workflow (or push tag `v1.0.0`) and wait until the release has `HiMusic.apk`.
