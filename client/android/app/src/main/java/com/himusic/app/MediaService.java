package com.himusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Foreground service: media notification, lock-screen controls, wake lock while playing. */
public class MediaService extends Service {
    public static final String ACTION_UPDATE = "com.himusic.app.UPDATE";
    public static final String ACTION_STOP = "com.himusic.app.STOP";
    private static final String CHANNEL = "himusic_playback";
    private static final int NOTIF_ID = 7;

    public interface Listener {
        void onAction(String action, long positionMs);
    }

    public static volatile Listener listener;
    public static volatile boolean running = false;
    public static volatile boolean playing = false;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private String title = "", artist = "", artworkUrl = "";
    private long position = 0, duration = 0;
    private Bitmap artwork;
    private String loadedArtwork = "";

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createChannel();
        session = new MediaSessionCompat(this, "HiMusic");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { emit("play", -1); }
            @Override public void onPause() { emit("pause", -1); }
            @Override public void onSkipToNext() { emit("next", -1); }
            @Override public void onSkipToPrevious() { emit("previous", -1); }
            @Override public void onSeekTo(long pos) { emit("seek", pos); }
        });
        session.setActive(true);
    }

    private void emit(String action, long pos) {
        Listener l = listener;
        if (l != null) l.onAction(action, pos);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(a)) {
            shutdown();
            return START_NOT_STICKY;
        }
        if ("PLAY".equals(a)) { emit("play", -1); return START_NOT_STICKY; }
        if ("PAUSE".equals(a)) { emit("pause", -1); return START_NOT_STICKY; }
        if ("NEXT".equals(a)) { emit("next", -1); return START_NOT_STICKY; }
        if ("PREV".equals(a)) { emit("previous", -1); return START_NOT_STICKY; }
        if (ACTION_UPDATE.equals(a) && intent != null) {
            title = intent.getStringExtra("title");
            artist = intent.getStringExtra("artist");
            String art = intent.getStringExtra("artwork");
            playing = intent.getBooleanExtra("playing", false);
            position = intent.getLongExtra("position", 0L);
            duration = intent.getLongExtra("duration", 0L);
            if (art != null && !art.equals(artworkUrl)) {
                artworkUrl = art;
                artwork = null;
                loadArtwork(art);
            }
            render();
        } else {
            // restarted by the system without data: nothing to show
            render();
        }
        return START_NOT_STICKY;
    }

    private void render() {
        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        if (artwork != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(md.build());

        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        position, playing ? 1f : 0f)
                .build());

        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(this, NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            // not allowed to run as foreground right now; keep a plain notification
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_ID, n);
        }
        if (!playing) {
            // paused: let the user swipe the notification away
            stopForeground(false);
        }
        updateWakeLock();
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText(artist)
                .setContentIntent(content)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(playing)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .addAction(android.R.drawable.ic_media_previous, "Previous", actionIntent("PREV", 1))
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play", actionIntent(playing ? "PAUSE" : "PLAY", 2))
                .addAction(android.R.drawable.ic_media_next, "Next", actionIntent("NEXT", 3))
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (artwork != null) b.setLargeIcon(artwork);
        return b.build();
    }

    private PendingIntent actionIntent(String action, int code) {
        Intent i = new Intent(this, MediaService.class);
        i.setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void loadArtwork(final String url) {
        if (url.isEmpty() || url.equals(loadedArtwork)) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                InputStream in = c.getInputStream();
                Bitmap bmp = BitmapFactory.decodeStream(in);
                in.close();
                if (bmp != null && url.equals(artworkUrl)) {
                    artwork = bmp;
                    loadedArtwork = url;
                    render(); // refresh notification with the cover
                }
            } catch (Exception ignored) {
            }
        }).start();
    }

    private void updateWakeLock() {
        try {
            if (playing) {
                if (wakeLock == null) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HiMusic:playback");
                    wakeLock.setReferenceCounted(false);
                }
                if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
            } else if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Music playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    private void shutdown() {
        playing = false;
        updateWakeLock();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        playing = false;
        updateWakeLock();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // app swiped from Recents: stop the music and the notification
        emit("pause", -1);
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
