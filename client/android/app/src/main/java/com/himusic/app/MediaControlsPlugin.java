package com.himusic.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
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
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
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
