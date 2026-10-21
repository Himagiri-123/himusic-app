package com.himusic.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaControlsPlugin.class);
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        WebView wv = getBridge().getWebView();
        if (wv != null) {
            WebSettings s = wv.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false); // auto-play next song without a tap
        }
    }

    // Back button: go back inside the app, and at the first screen send the app to the background
    // instead of closing it. Closing the activity destroys the web player and stops the music.
    @Override
    public void onBackPressed() {
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null && wv.canGoBack()) wv.goBack();
        else moveTaskToBack(true);
    }

    @Override
    public void onPause() {
        super.onPause();
        // keep the web player (and its timers) running while music plays with the screen off / another app open
        if (MediaService.playing && getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }
}
