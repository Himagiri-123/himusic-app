package com.himusic.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheSpan;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The music engine of the Android app. It plays inside the app process (not in the WebView), so Android can not
 * suspend it when the screen turns off or the app is in the background. It keeps the next songs queued, so tracks
 * change by themselves even when the web page is asleep, and keeps recently played songs in an on-device cache
 * (oldest removed first once the size limit is reached).
 *
 * Everything here runs on the main thread (use {@link #run(Runnable)}).
 */
@OptIn(markerClass = UnstableApi.class)
public final class NativePlayer {
    private NativePlayer() {}

    public interface Emitter {
        void emit(String event, JSObject data);
    }

    public static volatile Emitter emitter;
    /** true while this engine owns playback (the notification buttons then control it directly) */
    public static volatile boolean active = false;

    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static Context app;
    private static ExoPlayer player;
    private static SimpleCache cache;
    private static SharedPreferences prefs;
    private static final Map<String, JSONObject> tracks = new HashMap<>();
    private static String currentKey = "";
    private static boolean tickerOn = false;

    public static void run(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run();
        else MAIN.post(r);
    }

    private static void send(String event, JSObject data) {
        Emitter e = emitter;
        if (e != null) e.emit(event, data == null ? new JSObject() : data);
    }

    /* ---------------- setup ---------------- */

    private static void init(Context ctx) {
        if (player != null) return;
        app = ctx.getApplicationContext();
        prefs = app.getSharedPreferences("himusic_player", Context.MODE_PRIVATE);
        try {
            cache = new SimpleCache(new File(app.getCacheDir(), "audio"), new NoOpCacheEvictor(), new StandaloneDatabaseProvider(app));
        } catch (Exception e) {
            cache = null; // cache is optional
        }
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        androidx.media3.datasource.DataSource.Factory source = http;
        if (cache != null) {
            source = new CacheDataSource.Factory()
                    .setCache(cache)
                    .setUpstreamDataSourceFactory(http)
                    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
        }
        player = new ExoPlayer.Builder(app)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(source))
                // buffer up to 4 minutes ahead: a whole song is on the phone, so a slow network does not stall it
                .setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(30_000, 240_000, 1_500, 3_000).build())
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                stateChanged();
                if (isPlaying) startTicker();
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                stateChanged();
                if (state == Player.STATE_ENDED) send("ended", null);
            }

            @Override
            public void onMediaItemTransition(MediaItem item, int reason) {
                if (item == null) return;
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
                    JSObject o = new JSObject();
                    o.put("id", item.mediaId);
                    send("advanced", o);
                }
                currentKey = keyOf(item.mediaId);
                pushNotification();
                trimLater();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject o = new JSObject();
                o.put("code", error.errorCode);
                o.put("message", String.valueOf(error.getMessage()));
                MediaItem cur = player.getCurrentMediaItem();
                o.put("id", cur == null ? "" : cur.mediaId);
                send("error", o);
            }
        });
    }

    public static void ensure(Context ctx) {
        init(ctx);
    }

    public static boolean ready() {
        return player != null;
    }

    /* ---------------- commands ---------------- */

    /** one cache entry per song AND quality: two bitrates must never share cached bytes (that breaks seeking) */
    private static String keyOf(String id) {
        JSONObject t = tracks.get(id);
        String q = t == null ? "" : t.optString("q", "");
        return "hm:" + id + (q.isEmpty() ? "" : ":" + q);
    }

    private static MediaItem item(JSONObject t) {
        String id = t.optString("id");
        tracks.put(id, t);
        return new MediaItem.Builder()
                .setMediaId(id)
                .setUri(t.optString("url"))
                .setCustomCacheKey(keyOf(id)) // same key for every signed link of this song (and quality)
                .build();
    }

    /** start a song (first entry) and queue the rest after it */
    public static void play(Context ctx, JSONArray list, long startMs) {
        init(ctx);
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject t = list.optJSONObject(i);
            if (t != null) items.add(item(t));
        }
        if (items.isEmpty()) return;
        active = true;
        currentKey = keyOf(items.get(0).mediaId);
        player.setMediaItems(items, 0, Math.max(0, startMs));
        player.setPlayWhenReady(true);
        player.prepare();
        pushNotification();
    }

    /** replace everything after the current song (ignored if the current song is not afterId any more) */
    public static void upcoming(JSONArray list, String afterId) {
        if (player == null) return;
        MediaItem cur = player.getCurrentMediaItem();
        if (cur == null || !cur.mediaId.equals(afterId)) return;
        int idx = player.getCurrentMediaItemIndex();
        int count = player.getMediaItemCount();
        if (count > idx + 1) player.removeMediaItems(idx + 1, count);
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject t = list.optJSONObject(i);
            if (t != null) items.add(item(t));
        }
        if (!items.isEmpty()) player.addMediaItems(items);
    }

    public static void pause() {
        if (player != null) player.pause();
    }

    public static void resume() {
        if (player == null) return;
        if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
        player.play();
    }

    public static void seek(long ms) {
        if (player != null) {
            player.seekTo(Math.max(0, ms));
            send("time", snapshot()); // the page shows the new position at once
        }
        pushNotification();
    }

    public static void volume(float v) {
        if (player != null) player.setVolume(Math.max(0f, Math.min(1f, v)));
    }

    public static void repeatOne(boolean on) {
        if (player != null) player.setRepeatMode(on ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
    }

    public static void stop() {
        active = false;
        if (player != null) {
            player.stop();
            player.clearMediaItems();
            player.setVolume(1f);
            player.setRepeatMode(Player.REPEAT_MODE_OFF);
        }
    }

    /** notification buttons / headset keys: returns true if handled here, false = let the web page handle it */
    public static boolean handleAction(String action, long positionMs) {
        if (!active || player == null) return false;
        switch (action) {
            case "play":
                resume();
                return true;
            case "pause":
                player.pause();
                return true;
            case "seek":
                seek(positionMs);
                return true;
            case "next":
                if (player.hasNextMediaItem()) {
                    player.seekToNextMediaItem();
                    return true;
                }
                return false;
            case "previous":
                if (player.getCurrentPosition() > 4000) {
                    player.seekTo(0);
                    return true;
                }
                return false;
            default:
                return false;
        }
    }

    public static JSObject snapshot() {
        JSObject o = new JSObject();
        if (player == null) return o;
        MediaItem cur = player.getCurrentMediaItem();
        o.put("id", cur == null ? "" : cur.mediaId);
        o.put("playing", player.isPlaying());
        o.put("position", player.getCurrentPosition() / 1000.0);
        long d = player.getDuration();
        o.put("duration", d == C.TIME_UNSET ? 0 : d / 1000.0);
        return o;
    }

    /* ---------------- events to the web page + notification ---------------- */

    private static void stateChanged() {
        if (player == null) return;
        JSObject o = snapshot();
        o.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        o.put("wantsPlay", player.getPlayWhenReady());
        send("state", o);
        pushNotification();
    }

    private static void startTicker() {
        if (tickerOn) return;
        tickerOn = true;
        MAIN.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (player == null || !player.isPlaying()) {
                    tickerOn = false;
                    return;
                }
                send("time", snapshot());
                MAIN.postDelayed(this, 500);
            }
        }, 500);
    }

    /** the lock-screen / notification card is drawn by MediaService from the same data the web page used to send */
    private static void pushNotification() {
        if (player == null || app == null) return;
        MediaItem cur = player.getCurrentMediaItem();
        if (cur == null) return;
        JSONObject t = tracks.get(cur.mediaId);
        try {
            Intent i = new Intent(app, MediaService.class);
            i.setAction(MediaService.ACTION_UPDATE);
            i.putExtra("title", t == null ? "" : t.optString("title"));
            i.putExtra("artist", t == null ? "" : t.optString("artist"));
            i.putExtra("artwork", t == null ? "" : t.optString("artwork"));
            i.putExtra("playing", player.isPlaying() || (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING));
            i.putExtra("position", Math.max(0L, player.getCurrentPosition()));
            long d = player.getDuration();
            i.putExtra("duration", d == C.TIME_UNSET ? 0L : d);
            if (MediaService.running) app.startService(i);
            else ContextCompat.startForegroundService(app, i);
        } catch (Exception ignored) {
            // not allowed to start a service from the background right now; playback itself is not affected
        }
    }

    /* ---------------- cache ---------------- */

    public static long limitBytes() {
        if (prefs == null) return 100L * 1024 * 1024;
        return prefs.getInt("cacheMB", 100) * 1024L * 1024L;
    }

    public static void setLimitMB(Context ctx, int mb) {
        init(ctx);
        prefs.edit().putInt("cacheMB", Math.max(0, mb)).apply();
        trimLater();
    }

    public static JSObject cacheInfo(Context ctx) {
        init(ctx);
        JSObject o = new JSObject();
        long bytes = 0;
        int count = 0;
        try {
            if (cache != null) {
                bytes = cache.getCacheSpace();
                count = cache.getKeys().size();
            }
        } catch (Exception ignored) {
        }
        o.put("bytes", bytes);
        o.put("count", count);
        o.put("limitMB", (int) (limitBytes() / (1024 * 1024)));
        return o;
    }

    public static void clearCache(Context ctx) {
        init(ctx);
        new Thread(() -> {
            try {
                if (cache == null) return;
                for (String k : new ArrayList<>(cache.getKeys())) {
                    if (k.equals(currentKey)) continue;
                    cache.removeResource(k);
                }
            } catch (Exception ignored) {
            }
        }).start();
    }

    private static void trimLater() {
        new Thread(NativePlayer::trim).start();
    }

    /** remove the least recently played songs until the cache fits the limit */
    private static synchronized void trim() {
        try {
            if (cache == null) return;
            long limit = limitBytes();
            long total = cache.getCacheSpace();
            if (total <= limit) return;
            final Map<String, Long> touch = new HashMap<>();
            final Map<String, Long> size = new HashMap<>();
            for (String k : new ArrayList<>(cache.getKeys())) {
                long t = 0, s = 0;
                for (CacheSpan span : cache.getCachedSpans(k)) {
                    t = Math.max(t, span.lastTouchTimestamp);
                    s += span.length;
                }
                touch.put(k, t);
                size.put(k, s);
            }
            List<String> keys = new ArrayList<>(touch.keySet());
            Collections.sort(keys, (a, b) -> Long.compare(touch.get(a), touch.get(b)));
            for (String k : keys) {
                if (total <= limit) break;
                if (k.equals(currentKey)) continue;
                cache.removeResource(k);
                total -= size.get(k);
            }
        } catch (Exception ignored) {
        }
    }
}
