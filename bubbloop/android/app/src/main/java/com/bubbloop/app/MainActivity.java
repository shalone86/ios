package com.bubbloop.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
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
 * Bubbloop is a web app (the files in /web, packed as assets) inside a single
 * full-screen WebView. This activity does the few things a page cannot do for
 * itself: serve those files under a real https origin, save exported songs to
 * the phone's Music folder, share them, and buzz on a tap.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Bubbloop";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int PICK_FILE = 7;

    private WebView web;
    private ValueCallback<Uri[]> filePicker;
    private final Map<String, Saving> saving = new ConcurrentHashMap<>();
    private int nextId = 1;
    private int insetTop, insetBottom, insetLeft, insetRight, insetKeyboard;

    // survive recreate(), which is how the app recovers from a dead web process
    private static int webCrashes;
    private static long firstWebCrash;

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
        web.setBackgroundColor(0xFF231A55);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(true);
        web.setOnLongClickListener(v -> true);          // no text-selection pop-ups mid-song
        web.setLongClickable(false);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                    // songs are kept in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);                              // the layout is tuned; ignore font scaling
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebViewClient(new Pages());
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new Bridge(), "BubbloopNative");
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            readInsets(insets);
            pushInsets();
            return insets;
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, (OnBackInvokedCallback) this::goBack);
        }

        String start = HOME;
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // Debug builds only: allow Chrome's inspector to attach, and let a
            // test pick the page to open (adb shell am start ... --es page blank.html).
            WebView.setWebContentsDebuggingEnabled(true);
            String page = getIntent().getStringExtra("page");
            if (page != null && page.matches("[\\w./-]+") && !page.contains("..")) start = "https://" + HOST + "/" + page;
        }
        if (state == null || web.restoreState(state) == null) web.loadUrl(start);
    }

    // ---------- window ----------

    @SuppressWarnings("deprecation")
    private void drawBehindSystemBars() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            insetTop = bars.top;
            insetBottom = bars.bottom;
            insetLeft = bars.left;
            insetRight = bars.right;
            insetKeyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
        } else {
            insetTop = insets.getSystemWindowInsetTop();
            insetBottom = insets.getSystemWindowInsetBottom();
            insetLeft = insets.getSystemWindowInsetLeft();
            insetRight = insets.getSystemWindowInsetRight();
            insetKeyboard = 0;
        }
    }

    /** Tell the page how much room the status bar, gesture bar and keyboard take. */
    private void pushInsets() {
        if (web == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(Locale.US,
                "(function(){var s=document.documentElement.style;"
                        + "s.setProperty('--safe-t','%.1fpx');s.setProperty('--safe-b','%.1fpx');"
                        + "s.setProperty('--safe-l','%.1fpx');s.setProperty('--safe-r','%.1fpx');"
                        + "s.setProperty('--kb','%.1fpx');})()",
                insetTop / d, insetBottom / d, insetLeft / d, insetRight / d,
                Math.max(0, insetKeyboard - insetBottom) / d);
        web.evaluateJavascript(js, null);
    }

    /** The system's web engine cannot run the app; explain rather than loop. */
    private void showBroken() {
        TextView msg = new TextView(this);
        msg.setText(R.string.web_engine_broken);
        msg.setTextColor(Color.WHITE);
        msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        msg.setGravity(Gravity.CENTER);
        int pad = (int) (32 * getResources().getDisplayMetrics().density);
        msg.setPadding(pad, pad, pad, pad);
        msg.setBackgroundColor(0xFF231A55);
        setContentView(msg);
        if (web != null) {
            web.destroy();
            web = null;
        }
    }

    // ---------- lifecycle ----------

    @Override
    protected void onPause() {
        if (web != null) {
            // stop the music and save before the app goes to the background
            web.evaluateJavascript("window.bubbloopPause && window.bubbloopPause()", null);
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
        if (web != null) {
            web.removeJavascriptInterface("BubbloopNative");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    /** Back first closes whatever is open in the page; the page asks to leave when nothing is. */
    private void goBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.bubbloopBack ? window.bubbloopBack() : false)", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && filePicker != null) {
            filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            filePicker = null;
        }
    }

    // ---------- serving the app ----------

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private final class Pages extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            // The app is entirely offline: anything that is not ours gets nothing.
            if (!HOST.equals(url.getHost())) return notFound();
            String path = url.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            path = path.substring(1);
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open(path);
                String mime = mimeOf(path);
                boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml");
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
            } catch (IOException e) {
                Log.w(TAG, "missing asset " + path);
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !HOST.equals(request.getUrl().getHost());     // never leave the app
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pushInsets();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The page's process was killed (usually low memory). Songs autosave,
            // so start afresh; but if it keeps dying, stop and say so instead of
            // restarting for ever.
            long now = SystemClock.elapsedRealtime();
            if (now - firstWebCrash > 60_000) { firstWebCrash = now; webCrashes = 0; }
            webCrashes++;
            Log.w(TAG, "web process gone (" + webCrashes + ")");
            if (webCrashes >= 3) showBroken(); else recreate();
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePicker != null) filePicker.onReceiveValue(null);
            filePicker = callback;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(pick, getString(R.string.pick_file)), PICK_FILE);
            } catch (Exception e) {
                filePicker = null;
                return false;
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    // ---------- what the page can ask for ----------

    private final class Bridge {
        /** Start a new file in Music/Bubbloop (or Download/Bubbloop). Returns a handle, or "" on failure. */
        @JavascriptInterface
        public String beginFile(String name, String mime) {
            try {
                String clean = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").trim();
                if (clean.isEmpty()) clean = "Bubbloop";
                int dot = clean.lastIndexOf('.');
                String ext = dot >= 0 ? clean.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
                // use the type Android itself associates with the extension, so the
                // media store never feels the need to rename the file
                String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                if (type == null) type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                boolean audio = type.startsWith("audio/");
                String folder = audio ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_DOWNLOADS;

                Saving s = new Saving();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, clean);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, folder + "/Bubbloop");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri collection = audio
                            ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                            : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    ContentResolver r = getContentResolver();
                    s.uri = r.insert(collection, v);
                    if (s.uri == null) return "";
                    s.out = r.openOutputStream(s.uri);
                    s.where = folder + "/Bubbloop";
                } else {
                    // Before Android 10 a shared folder needs a storage permission;
                    // the app's own folder does not.
                    File dir = new File(getExternalFilesDir(folder), "Bubbloop");
                    if (!dir.isDirectory() && !dir.mkdirs()) return "";
                    File f = new File(dir, clean);
                    for (int i = 2; f.exists(); i++) {
                        f = new File(dir, dot >= 0 ? clean.substring(0, dot) + " " + i + clean.substring(dot) : clean + " " + i);
                    }
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

        /** Close the file and make it visible. Returns JSON: { ok, uri, where } or { ok:false, error }. */
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
                    res.put("uri", s.uri.toString());
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

        @JavascriptInterface
        public void shareFile(String uri, String mime, String title) {
            runOnUiThread(() -> {
                try {
                    Uri u = Uri.parse(uri);
                    String type = getContentResolver().getType(u);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(type != null ? type : mime);
                    send.putExtra(Intent.EXTRA_STREAM, u);
                    if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_TITLE, title);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, getString(R.string.share_title)));
                } catch (Exception e) {
                    Log.w(TAG, "share failed", e);
                }
            });
        }

        @JavascriptInterface
        public void haptic(String kind) {
            runOnUiThread(() -> {
                if (web != null) web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            });
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> moveTaskToBack(true));
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
