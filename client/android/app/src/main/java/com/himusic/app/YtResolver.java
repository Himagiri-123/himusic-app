package com.himusic.app;

import android.net.Uri;

import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds the real YouTube audio address of a song ON THE PHONE (like RiMusic / NewPipe do).
 * The phone's own internet connection is not blocked by YouTube, unlike a free cloud server's.
 * Every failure returns null, and the player then simply uses the server address as before.
 */
public final class YtResolver {
    private YtResolver() {}

    private static final Pattern SERVER_AUDIO = Pattern.compile("^/api/music/audio/([\\w-]{6,15})$");
    private static final long TTL_MS = 4 * 60 * 60 * 1000L; // YouTube links last about 6 hours
    private static final Map<String, Entry> cache = new HashMap<>();
    private static final Set<String> serverOnly = new HashSet<>(); // songs where the phone's address failed: use the server
    private static final Set<String> running = new HashSet<>();
    private static final ExecutorService pool = Executors.newFixedThreadPool(4);
    private static boolean inited = false;
    public static volatile String lastError = "";

    private static final class Entry {
        final String url;
        final long at;
        Entry(String url, long at) { this.url = url; this.at = at; }
    }

    /** the song id if this is one of our own /audio/<id> addresses, else null (local files, other hosts) */
    public static String idOf(Uri u) {
        if (u == null || u.getPath() == null) return null;
        if (!"audio".equals(u.getQueryParameter("k"))) return null;
        Matcher m = SERVER_AUDIO.matcher(u.getPath());
        return m.matches() ? m.group(1) : null;
    }

    public static String qualityOf(Uri u) {
        String q = u == null ? null : u.getQueryParameter("q");
        return "low".equals(q) || "high".equals(q) ? q : "normal";
    }

    /** the address to play, or null to use the server. Blocks (up to ~15 s) the calling loader thread. */
    public static String resolve(final String id, final String quality) {
        final String key = id + "|" + quality;
        synchronized (cache) {
            if (serverOnly.contains(id)) return null;
            Entry e = cache.get(key);
            if (e != null && System.currentTimeMillis() - e.at < TTL_MS) return e.url;
        }
        Future<String> f = pool.submit(() -> fetch(id, quality));
        try {
            return f.get(15, TimeUnit.SECONDS);
        } catch (Throwable t) {
            f.cancel(true);
            lastError = String.valueOf(t);
            return null;
        }
    }

    private static String fetch(String id, String quality) throws Exception {
        final String key = id + "|" + quality;
        synchronized (running) { // one lookup per song at a time (prefetch + player may ask together)
            while (running.contains(key)) running.wait(500);
            synchronized (cache) {
                Entry e = cache.get(key);
                if (e != null && System.currentTimeMillis() - e.at < TTL_MS) return e.url;
            }
            running.add(key);
        }
        try {
            init();
            StreamInfo info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=" + id);
            List<AudioStream> list = new ArrayList<>();
            for (AudioStream s : info.getAudioStreams()) {
                if (s.getDeliveryMethod() == DeliveryMethod.PROGRESSIVE_HTTP && s.getContent() != null && s.getContent().startsWith("http")) list.add(s);
            }
            if (list.isEmpty()) throw new IOException("no audio stream");
            AudioStream best = null;
            int bestScore = Integer.MIN_VALUE;
            for (AudioStream s : list) {
                int br = s.getAverageBitrate() > 0 ? s.getAverageBitrate() : 128;
                int target = "low".equals(quality) ? 50 : "high".equals(quality) ? 320 : 128;
                int score = -Math.abs(br - target);
                if (s.getFormat() != null && "m4a".equals(s.getFormat().getSuffix())) score += 15; // plays everywhere
                if (score > bestScore) { bestScore = score; best = s; }
            }
            String url = best.getContent();
            synchronized (cache) {
                if (cache.size() > 80) cache.clear();
                cache.put(key, new Entry(url, System.currentTimeMillis()));
            }
            lastError = "";
            return url;
        } finally {
            synchronized (running) {
                running.remove(key);
                running.notifyAll();
            }
        }
    }

    /** look the next songs up in the background so they start at once */
    public static void prefetch(final String id, final String quality) {
        if (id == null) return;
        synchronized (cache) {
            if (serverOnly.contains(id)) return;
            Entry e = cache.get(id + "|" + quality);
            if (e != null && System.currentTimeMillis() - e.at < TTL_MS) return;
        }
        pool.submit(() -> {
            try {
                fetch(id, quality);
            } catch (Throwable t) {
                lastError = String.valueOf(t);
            }
        });
    }

    /** the address stopped working: forget it (and after a 2nd failure give up on the phone for this song) */
    public static void failed(String id, boolean giveUp) {
        synchronized (cache) {
            cache.remove(id + "|low");
            cache.remove(id + "|normal");
            cache.remove(id + "|high");
            if (giveUp) serverOnly.add(id);
        }
    }

    /** for the self-test */
    public static String test(String id) {
        long t = System.currentTimeMillis();
        try {
            failed(id, false);
            String u = fetch(id, "normal");
            return "ok " + (System.currentTimeMillis() - t) + " ms, host=" + Uri.parse(u).getHost();
        } catch (Throwable e) {
            return "FAIL " + (System.currentTimeMillis() - t) + " ms: " + e;
        }
    }

    /** the player name YouTube expects for the address it handed out (some addresses check it) */
    public static String userAgentFor(String url) {
        try {
            if (org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper.isVisionOsStreamingUrl(url))
                return org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper.getVisionOsUserAgent(null);
        } catch (Throwable ignored) {
        }
        if (url.contains("c=ANDROID")) return "com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip";
        if (url.contains("c=IOS")) return "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)";
        return null;
    }

    private static synchronized void init() {
        if (inited) return;
        NewPipe.init(new Dl());
        inited = true;
    }

    /** NewPipe asks this to do its web requests */
    private static final class Dl extends Downloader {
        @Override
        public Response execute(Request request) throws IOException, ReCaptchaException {
            HttpURLConnection c = (HttpURLConnection) new URL(request.url()).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(12000);
            c.setRequestMethod(request.httpMethod());
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0");
            for (Map.Entry<String, List<String>> h : request.headers().entrySet()) {
                boolean first = true;
                for (String v : h.getValue()) {
                    if (first) c.setRequestProperty(h.getKey(), v);
                    else c.addRequestProperty(h.getKey(), v);
                    first = false;
                }
            }
            byte[] body = request.dataToSend();
            if (body != null) {
                c.setDoOutput(true);
                OutputStream os = c.getOutputStream();
                os.write(body);
                os.close();
            }
            int code = c.getResponseCode();
            if (code == 429) {
                c.disconnect();
                throw new ReCaptchaException("YouTube asked for a captcha", request.url());
            }
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = "";
            if (in != null) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                text = bo.toString("UTF-8");
            }
            Map<String, List<String>> headers = new HashMap<>();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) if (e.getKey() != null) headers.put(e.getKey(), e.getValue());
            String latest = c.getURL().toString();
            String msg = c.getResponseMessage();
            c.disconnect();
            return new Response(code, msg, headers, text, latest);
        }
    }
}
