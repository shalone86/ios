package com.deepdrift.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Deep Drift is a web app (the files in night/web, packed as assets) in one
 * full-screen WebView. Unlike most apps it keeps the page running when you
 * leave it or turn the screen off, so the sea can play you to sleep; the
 * PlayingService keeps the app alive while it does.
 */
public class MainActivity extends Activity {
    private static final String TAG = "DeepDrift";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private WebView web;
    private boolean playing;

    /** The notification's Stop button. */
    private final BroadcastReceiver stopper = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            playing = false;
            if (web != null) web.evaluateJavascript("window.deepDriftStop && window.deepDriftStop()", null);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        drawBehindSystemBars();
        web = new WebView(this);
        web.setBackgroundColor(0xFF030716);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setOnLongClickListener(v -> true);
        web.setLongClickable(false);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new Pages());
        web.addJavascriptInterface(new Bridge(), "DriftNative");
        web.setOnApplyWindowInsetsListener((v, insets) -> { pushInsets(insets); return insets; });

        IntentFilter f = new IntentFilter(PlayingService.STOP);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(stopper, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(stopper, f);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, (OnBackInvokedCallback) () -> moveTaskToBack(true));
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    @SuppressWarnings("deprecation")
    private void drawBehindSystemBars() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        else w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
    }

    @SuppressWarnings("deprecation")
    private void pushInsets(WindowInsets insets) {
        int top, bottom;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            top = b.top; bottom = b.bottom;
        } else {
            top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
        }
        float d = getResources().getDisplayMetrics().density;
        web.evaluateJavascript(String.format(Locale.US,
                "document.documentElement.style.setProperty('--safe-t','%.1fpx');"
                        + "document.documentElement.style.setProperty('--safe-b','%.1fpx');", top / d, bottom / d), null);
    }

    // The page keeps running in the background only while it is playing;
    // otherwise it rests like any other app.
    @Override
    protected void onPause() {
        if (web != null && !playing) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(stopper); } catch (Exception ignored) { }
        PlayingService.stop(this);
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { moveTaskToBack(true); }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private final class Pages extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return notFound();          // entirely offline
            String path = url.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            path = path.substring(1);
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open(path);
                String mime = mimeOf(path);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-store");
                return new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null, 200, "OK", h, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !HOST.equals(request.getUrl().getHost());
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.w(TAG, "web process gone");
            PlayingService.stop(MainActivity.this);
            recreate();
            return true;
        }
    }

    private final class Bridge {
        /** The page says whether it is making sound. */
        @JavascriptInterface
        public void playing(boolean on) {
            runOnUiThread(() -> {
                if (on == playing) return;
                playing = on;
                if (on) {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
                    }
                    PlayingService.start(MainActivity.this);
                } else {
                    PlayingService.stop(MainActivity.this);
                }
            });
        }
    }
}
