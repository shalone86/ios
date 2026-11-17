package com.poppads.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Pop Pads is a web app (the files in pop/web, packed as assets) in one
 * full-screen WebView. This activity serves those files under a real https
 * origin, and saves exported beats to Music/Pop Pads (WAV) or
 * Download/Pop Pads (MIDI, zips).
 */
public class MainActivity extends Activity {
    private static final String TAG = "PopPads";
    private static final String FOLDER = "Pop Pads";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private WebView web;
    private final Map<String, Saving> saving = new ConcurrentHashMap<>();
    private int nextId = 1;

    /** A file being written, one chunk at a time. */
    private static final class Saving {
        OutputStream out;
        Uri uri;
        File file;
        String where;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        drawBehindSystemBars();
        web = new WebView(this);
        web.setBackgroundColor(0xFF3A160C);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setOnLongClickListener(v -> true);
        web.setLongClickable(false);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                    // the beat is kept in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new Pages());
        web.addJavascriptInterface(new Bridge(), "PopNative");
        web.setOnApplyWindowInsetsListener((v, insets) -> { pushInsets(insets); return insets; });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, (OnBackInvokedCallback) this::goBack);
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

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.popPadsPause && window.popPadsPause()", null);   // the beat stops when you leave
            web.onPause();
        }
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
        for (Saving s : saving.values()) abandon(s);
        saving.clear();
        if (web != null) { web.removeJavascriptInterface("PopNative"); web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { goBack(); }

    /** Back closes an open menu first; with nothing open, the app goes to the background. */
    private void goBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.popPadsBack ? window.popPadsBack() : false)", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".mp4")) return "video/mp4";
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
            Uri u = request.getUrl();
            if (HOST.equals(u.getHost())) return false;
            // a link to the other bubble apps (or anywhere else on the web) opens in the browser
            if ("https".equals(u.getScheme()) && request.isForMainFrame()) {
                try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, u)); } catch (Exception e) { Log.w(TAG, "no browser for " + u); }
            }
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.w(TAG, "web process gone");
            recreate();                                                    // the beat is autosaved
            return true;
        }
    }

    private final class Bridge {
        /** Start a new file in Music/Pop Pads (audio) or Download/Pop Pads. Returns a handle, or "" on failure. */
        @JavascriptInterface
        public String beginFile(String name, String mime) {
            try {
                String clean = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").trim();
                if (clean.isEmpty()) clean = "Pop Pads";
                int dot = clean.lastIndexOf('.');
                String ext = dot >= 0 ? clean.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
                String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                if (type == null) type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                boolean audio = type.startsWith("audio/") && !ext.equals("mid");
                String folder = audio ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_DOWNLOADS;
                Saving s = new Saving();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, clean);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, folder + "/" + FOLDER);
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri collection = audio
                            ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    ContentResolver r = getContentResolver();
                    s.uri = r.insert(collection, v);
                    if (s.uri == null) return "";
                    s.out = r.openOutputStream(s.uri);
                    s.where = folder + "/" + FOLDER;
                } else {
                    File dir = new File(getExternalFilesDir(folder), FOLDER);
                    if (!dir.isDirectory() && !dir.mkdirs()) return "";
                    File f = new File(dir, clean);
                    for (int i = 2; f.exists(); i++) f = new File(dir, dot >= 0 ? clean.substring(0, dot) + " " + i + clean.substring(dot) : clean + " " + i);
                    s.file = f;
                    s.out = new FileOutputStream(f);
                    s.where = dir.getAbsolutePath();
                }
                if (s.out == null) { abandon(s); return ""; }
                String id;
                synchronized (MainActivity.this) { id = "f" + nextId++; }
                saving.put(id, s);
                return id;
            } catch (Exception e) {
                Log.w(TAG, "beginFile failed", e);
                return "";
            }
        }

        @JavascriptInterface
        public boolean appendFile(String id, String base64) {
            Saving s = saving.get(id);
            if (s == null) return false;
            try {
                s.out.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                Log.w(TAG, "appendFile failed", e);
                saving.remove(id);
                abandon(s);
                return false;
            }
        }

        /** Close the file and make it visible. Returns JSON: { ok, where } or { ok:false, error }. */
        @JavascriptInterface
        public String finishFile(String id) {
            Saving s = saving.remove(id);
            JSONObject res = new JSONObject();
            try {
                if (s == null) throw new IOException("unknown file");
                s.out.flush();
                s.out.close();
                if (s.uri != null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(s.uri, v, null, null);
                }
                res.put("ok", true);
                res.put("where", s.where);
            } catch (Exception e) {
                Log.w(TAG, "finishFile failed", e);
                if (s != null) abandon(s);
                try { res.put("ok", false); res.put("error", "Could not save the file"); } catch (Exception ignored) { }
            }
            return res.toString();
        }
    }

    /** Throw away a half-written file. */
    private void abandon(Saving s) {
        try { if (s.out != null) s.out.close(); } catch (Exception ignored) { }
        try {
            if (s.uri != null) getContentResolver().delete(s.uri, null, null);
            if (s.file != null) s.file.delete();
        } catch (Exception ignored) { }
    }
}
