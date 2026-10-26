package com.himusic.app;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Downloads the new APK (with progress events + a progress notification) and opens Android's installer. */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {
    private static final String CHANNEL = "himusic_update";
    private static final int NOTIF_ID = 8;
    private volatile boolean busy = false;

    private File apkFile() {
        return new File(getContext().getCacheDir(), "HiMusic-update.apk");
    }

    @SuppressLint("MissingPermission")
    private void notifyProgress(int percent, boolean done) {
        try {
            Context c = getContext();
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_LOW));
            }
            if (done) {
                nm.cancel(NOTIF_ID);
                return;
            }
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                    .setSmallIcon(android.R.drawable.stat_sys_download)
                    .setContentTitle("Downloading HiMusic update")
                    .setContentText(percent >= 0 ? percent + "%" : "Please wait")
                    .setOnlyAlertOnce(true)
                    .setOngoing(true)
                    .setProgress(100, Math.max(percent, 0), percent < 0);
            nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("no url");
            return;
        }
        if (busy) {
            call.reject("already downloading");
            return;
        }
        busy = true;
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                File final_ = apkFile();
                File out = new File(final_.getPath() + ".part"); // a half-downloaded file must never be installed
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                int code = c.getResponseCode();
                if (code >= 400) throw new Exception("Download failed (HTTP " + code + ")");
                long total = Build.VERSION.SDK_INT >= 24 ? c.getContentLengthLong() : c.getContentLength();
                long got = 0;
                int last = -2;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : -1;
                        if (pct != last) {
                            last = pct;
                            JSObject o = new JSObject();
                            o.put("percent", pct);
                            o.put("loaded", got);
                            o.put("total", total);
                            notifyListeners("progress", o);
                            notifyProgress(pct, false);
                        }
                    }
                }
                if (total > 0 && got != total) throw new Exception("Download incomplete, try again");
                if (final_.exists()) final_.delete();
                if (!out.renameTo(final_)) throw new Exception("Could not save the update file");
                notifyProgress(100, true);
                JSObject r = new JSObject();
                r.put("size", final_.length());
                call.resolve(r);
            } catch (Throwable e) {
                try {
                    new File(apkFile().getPath() + ".part").delete();
                } catch (Exception ignored) {
                }
                notifyProgress(0, true);
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                busy = false;
                if (c != null) c.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        try {
            File f = apkFile();
            if (!f.exists()) {
                call.reject("The update file is missing, download it again.");
                return;
            }
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                // Android asks the user once to allow installing apps from HiMusic
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
                JSObject o = new JSObject();
                o.put("needsPermission", true);
                call.resolve(o);
                return;
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }
}
