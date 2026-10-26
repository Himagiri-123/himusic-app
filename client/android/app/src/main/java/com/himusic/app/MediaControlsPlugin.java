package com.himusic.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web player show the system media notification / lock-screen controls
 * and keeps the app alive (foreground service) while music plays in the background.
 */
@CapacitorPlugin(name = "MediaControls")
public class MediaControlsPlugin extends Plugin {

    @Override
    public void load() {
        // Android 13+: notifications need a runtime permission, otherwise the controls are not shown
        if (Build.VERSION.SDK_INT >= 33
                && getActivity() != null
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 4242);
        }
        NativePlayer.emitter = (event, data) -> notifyListeners("p_" + event, data);
        MediaService.listener = (action, positionMs) -> {
            JSObject o = new JSObject();
            o.put("action", action);
            if (positionMs >= 0) o.put("position", positionMs / 1000.0);
            notifyListeners("action", o);
        };
    }

    @PluginMethod
    public void update(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), MediaService.class);
            i.setAction(MediaService.ACTION_UPDATE);
            i.putExtra("title", call.getString("title", ""));
            i.putExtra("artist", call.getString("artist", ""));
            i.putExtra("artwork", call.getString("artwork", ""));
            i.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
            i.putExtra("position", call.getDouble("position", 0.0).longValue());
            i.putExtra("duration", call.getDouble("duration", 0.0).longValue());
            // Android 12+ forbids *starting* a foreground service from the background (e.g. when the next song
            // starts with the screen off). Once it runs we only need to send it new data.
            if (MediaService.running) getContext().startService(i);
            else ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void status(final PluginCall call) {
        // ExoPlayer may only be touched from the main thread, so build the answer there
        NativePlayer.run(() -> {
            JSObject o = new JSObject();
            try {
                o.put("sdk", Build.VERSION.SDK_INT);
                boolean permission = Build.VERSION.SDK_INT < 33
                        || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                o.put("notificationsAllowed", permission && NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                o.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
                o.put("serviceRunning", MediaService.running);
                o.put("servicePlaying", MediaService.playing);
                o.put("serviceError", MediaService.lastError);
            } catch (Exception e) {
                o.put("statusError", String.valueOf(e));
            }
            try {
                boolean shown = false;
                if (Build.VERSION.SDK_INT >= 23) {
                    android.app.NotificationManager nm = (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                    for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications()) if (n.getId() == 7) shown = true;
                }
                o.put("notificationShown", shown);
            } catch (Exception ignored) {
            }
            try {
                JSObject d = NativePlayer.debug();
                java.util.Iterator<String> keys = d.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    o.put(k, d.get(k));
                }
            } catch (Exception e) {
                o.put("engineDebugError", String.valueOf(e));
            }
            call.resolve(o);
        });
    }

    /** asks Android to let HiMusic run in the background without battery limits (Vivo / Xiaomi / Oppo kill music otherwise) */
    @PluginMethod
    public void requestBattery(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                call.resolve();
                return;
            }
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                i.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }

    /* ---------- native music engine (see NativePlayer) ---------- */

    @PluginMethod
    public void playerPing(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ok", true);
        o.put("version", 1);
        call.resolve(o);
    }

    @PluginMethod
    public void playerPlay(final PluginCall call) {
        final com.getcapacitor.JSArray list = call.getArray("tracks");
        final long start = call.getDouble("startMs", 0.0).longValue(); // getLong() ignores whole numbers that JSON reads as Integer
        if (list == null || list.length() == 0) {
            call.reject("no tracks");
            return;
        }
        NativePlayer.run(() -> {
            try {
                NativePlayer.play(getContext(), list, start);
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void playerUpcoming(final PluginCall call) {
        final com.getcapacitor.JSArray list = call.getArray("tracks");
        final String after = call.getString("afterId", "");
        NativePlayer.run(() -> {
            try {
                NativePlayer.upcoming(list == null ? new com.getcapacitor.JSArray() : list, after);
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    /** runs on the main thread (ExoPlayer rule) and always answers the page, even if something throws */
    private void onMain(final PluginCall call, final java.util.concurrent.Callable<JSObject> body) {
        NativePlayer.run(() -> {
            try {
                JSObject r = body.call();
                if (r == null) call.resolve();
                else call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void playerNext(final PluginCall call) {
        onMain(call, () -> {
            JSObject o = new JSObject();
            o.put("ok", NativePlayer.next());
            return o;
        });
    }

    @PluginMethod
    public void playerPause(final PluginCall call) {
        onMain(call, () -> {
            NativePlayer.pause();
            return null;
        });
    }

    @PluginMethod
    public void playerResume(final PluginCall call) {
        onMain(call, () -> {
            NativePlayer.resume();
            return null;
        });
    }

    @PluginMethod
    public void playerSeek(final PluginCall call) {
        final long ms = call.getDouble("ms", 0.0).longValue(); // getLong() would silently return 0 for whole numbers
        onMain(call, () -> {
            NativePlayer.seek(ms);
            return null;
        });
    }

    @PluginMethod
    public void playerVolume(final PluginCall call) {
        final float v = call.getFloat("v", 1f);
        onMain(call, () -> {
            NativePlayer.volume(v);
            return null;
        });
    }

    @PluginMethod
    public void playerRepeatOne(final PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        onMain(call, () -> {
            NativePlayer.repeatOne(on);
            return null;
        });
    }

    @PluginMethod
    public void playerStop(final PluginCall call) {
        onMain(call, () -> {
            NativePlayer.stop();
            return null;
        });
    }

    @PluginMethod
    public void playerState(final PluginCall call) {
        onMain(call, NativePlayer::snapshot);
    }

    @PluginMethod
    public void cacheInfo(final PluginCall call) {
        onMain(call, () -> NativePlayer.cacheInfo(getContext()));
    }

    @PluginMethod
    public void cacheLimit(final PluginCall call) {
        final int mb = call.getInt("mb", 100);
        onMain(call, () -> {
            NativePlayer.setLimitMB(getContext(), mb);
            return null;
        });
    }

    @PluginMethod
    public void cacheClear(final PluginCall call) {
        onMain(call, () -> {
            NativePlayer.clearCache(getContext());
            return null;
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            if (MediaService.running) {
                Intent i = new Intent(getContext(), MediaService.class);
                i.setAction(MediaService.ACTION_STOP);
                getContext().startService(i);
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }
}
