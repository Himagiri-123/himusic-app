package com.himusic.app;

import android.content.ContentUris;
import android.database.Cursor;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Lists the music files stored on the phone (MediaStore) so the native player can play them. */
@CapacitorPlugin(
        name = "LocalMusic",
        permissions = {
            @Permission(alias = "audio33", strings = {"android.permission.READ_MEDIA_AUDIO"}),
            @Permission(alias = "audioOld", strings = {"android.permission.READ_EXTERNAL_STORAGE"})
        })
public class LocalMusicPlugin extends Plugin {

    private String alias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio33" : "audioOld";
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "afterPermission");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) doScan(call);
        else call.reject("Permission to read music was not given");
    }

    private void doScan(final PluginCall call) {
        new Thread(() -> {
            Cursor c = null;
            try {
                String[] cols = {
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.DURATION
                };
                String where = MediaStore.Audio.Media.IS_MUSIC + " != 0 AND " + MediaStore.Audio.Media.DURATION + " >= 30000";
                c = getContext().getContentResolver().query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols, where, null, MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC");
                JSArray list = new JSArray();
                if (c != null) {
                    while (c.moveToNext() && list.length() < 5000) {
                        long id = c.getLong(0);
                        JSObject o = new JSObject();
                        o.put("id", "local-" + id);
                        o.put("title", c.getString(1) == null ? "Unknown" : c.getString(1));
                        String artist = c.getString(2);
                        o.put("artist", artist == null || artist.equals("<unknown>") ? "" : artist);
                        o.put("album", c.getString(3) == null ? "" : c.getString(3));
                        o.put("duration", c.getLong(4) / 1000);
                        o.put("uri", ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id).toString());
                        list.put(o);
                    }
                }
                JSObject res = new JSObject();
                res.put("songs", list);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (c != null) c.close();
            }
        }).start();
    }
}
