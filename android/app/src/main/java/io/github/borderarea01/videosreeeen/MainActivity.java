package io.github.borderarea01.videosreeeen;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

public class MainActivity extends Activity {

    private WebView ui, site;
    private Dialog accountDialog;
    private FrameLayout root;
    private String bridge;
    private MediaCache cache;
    private BlockCache blocks;
    private AppUpdates updates;
    private volatile JSONObject sample = new JSONObject();
    private final List<JavaScriptReplyProxy> frames = new ArrayList<>();
    private final List<String> observed = Collections.synchronizedList(new ArrayList<>());
    private final ExecutorService calls = Executors.newSingleThreadExecutor();
    private final ExecutorService ioCalls = Executors.newSingleThreadExecutor();
    private View fullScreen;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(16, 16, 20));
        getWindow().setNavigationBarColor(Color.rgb(16, 16, 20));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 16, 20));
        setContentView(root);
        // Keep content out of system bars on Android 15, including the keyboard.
        if (android.os.Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener(
            (view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            }
        );
        try {
            try (
                InputStream input = getAssets().open("page-bridge.js");
                ByteArrayOutputStream output = new ByteArrayOutputStream()
            ) {
                byte[] buffer = new byte[8192];
                int size;
                while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
                bridge = output.toString("UTF-8");
            }
            cache = new MediaCache(new File(getCacheDir(), "viewing-media"), this::emit);
            blocks = new BlockCache(new File(getCacheDir(), "viewing-media"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        ui = new WebView(this);
        configure(ui, false);
        ui.addJavascriptInterface(new Commands(), "VSNative");
        root.addView(ui, new FrameLayout.LayoutParams(-1, -1));
        ui.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !"videosreeeen.local".equals(request.getUrl().getHost());
                }

                @Override
                public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
                ) {
                    if (!"videosreeeen.local".equals(request.getUrl().getHost())) return null;
                    String path = request.getUrl().getPath();
                    if (path == null) return empty();
                    if (path.startsWith("/cache/")) {
                        WebResourceResponse result = cache.response(
                            path,
                            request.getRequestHeaders().get("Range")
                        );
                        return result == null ? empty() : result;
                    }
                    try {
                        if (path.equals("/")) path = "/index.html";
                        if (path.contains("..")) return empty();
                        String mime = path.endsWith(".html")
                            ? "text/html"
                            : path.endsWith(".js")
                              ? "text/javascript"
                              : path.endsWith(".css")
                                ? "text/css"
                                : path.endsWith(".svg")
                                  ? "image/svg+xml"
                                  : "application/octet-stream";
                        return new WebResourceResponse(
                            mime,
                            "UTF-8",
                            getAssets().open(path.substring(1))
                        );
                    } catch (Exception e) {
                        return empty();
                    }
                }
            }
        );
        ui.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public void onShowCustomView(View view, CustomViewCallback callback) {
                    fullScreen = view;
                    root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                }

                @Override
                public void onHideCustomView() {
                    if (fullScreen != null) {
                        root.removeView(fullScreen);
                        fullScreen = null;
                    }
                }

                @Override
                public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
                ) {
                    fileCallback = callback;
                    try {
                        startActivityForResult(params.createIntent(), 42);
                    } catch (Exception e) {
                        fileCallback = null;
                        callback.onReceiveValue(null);
                    }
                    return true;
                }
            }
        );
        ui.loadUrl("https://videosreeeen.local/");
    }

    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onActivityResult(int request, int result, android.content.Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 42 && fileCallback != null) {
            fileCallback.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result, data)
            );
            fileCallback = null;
        }
    }

    private WebResourceResponse empty() {
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0])
        );
    }

    private void configure(WebView view, boolean remote) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(!remote);
        s.setMixedContentMode(
            remote ? WebSettings.MIXED_CONTENT_NEVER_ALLOW : WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        );
        s.setSupportMultipleWindows(false);
        view.setBackgroundColor(Color.BLACK);
        CookieManager.getInstance().setAcceptCookie(true);
        if (remote) CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
    }

    private void emit(String type, JSONObject data) {
        runOnUiThread(() -> {
            if (ui != null) ui.evaluateJavascript(
                "window.__nativeEvent&&window.__nativeEvent(" +
                    JSONObject.quote(type) +
                    "," +
                    JSONObject.quote(data.toString()) +
                    ")",
                null
            );
        });
    }

    private String validateUrl(String value) throws Exception {
        Uri uri = Uri.parse(value);
        if (
            (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) ||
            uri.getHost() == null ||
            uri.getUserInfo() != null
        ) throw new IOException("地址无效");
        return value;
    }

    private void closeSite() {
        frames.clear();
        observed.clear();
        sample = new JSONObject();
        if (site != null) {
            root.removeView(site);
            site.stopLoading();
            site.destroy();
            site = null;
        }
    }

    private boolean isBilibiliLoginUrl(String value) {
        Uri url = Uri.parse(value);
        String host = url.getHost();
        return (
            "https".equals(url.getScheme()) &&
            url.getPort() == -1 &&
            url.getUserInfo() == null &&
            host != null &&
            (host.equals("bilibili.com") || host.endsWith(".bilibili.com"))
        );
    }

    private void openSiteAccount() {
        if (accountDialog != null) return;
        Dialog dialog = new Dialog(this);
        accountDialog = dialog;
        dialog.setTitle("B 站登录");
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.widget.Button done = new android.widget.Button(this);
        done.setText("完成登录 / 返回观影");
        done.setOnClickListener(view -> dialog.dismiss());
        layout.addView(done);
        WebView account = new WebView(this);
        configure(account, true);
        account.getSettings().setUseWideViewPort(true);
        account.getSettings().setLoadWithOverviewMode(true);
        account.getSettings().setBuiltInZoomControls(true);
        account.getSettings().setDisplayZoomControls(false);
        // This WebView has no app bridge; CookieManager owns the local login session.
        account.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return (
                        request.isForMainFrame() && !isBilibiliLoginUrl(request.getUrl().toString())
                    );
                }
            }
        );
        layout.addView(account, new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(layout);
        dialog.setOnDismissListener(ignored -> {
            accountDialog = null;
            account.stopLoading();
            account.destroy();
            if (!ioCalls.isShutdown()) ioCalls.execute(() -> CookieManager.getInstance().flush());
            if (site != null && isBilibiliLoginUrl(site.getUrl() == null ? "" : site.getUrl())) {
                site.reload();
            }
        });
        dialog.show();
        dialog.getWindow().setLayout(-1, -1);
        account.loadUrl("https://passport.bilibili.com/login");
    }

    private void openSite(String url) throws Exception {
        validateUrl(url);
        closeSite();
        site = new WebView(this);
        configure(site, true);
        site.setVisibility(View.INVISIBLE);
        root.addView(site, new FrameLayout.LayoutParams(1, 1));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                site,
                "VSProbe",
                Collections.singleton("*"),
                (view, message, origin, main, reply) -> {
                    try {
                        String raw = message.getData();
                        if (raw == null || raw.length() > 32768) return;
                        JSONObject value = new JSONObject(raw);
                        if (value.optBoolean("available")) {
                            double old = sample.optDouble("duration", 0),
                                next = value.optDouble("duration", 0);
                            if (
                                !sample.optBoolean("available") ||
                                next >= old - 1 ||
                                value.optLong("seq") > sample.optLong("seq")
                            ) {
                                sample = value;
                            }
                        }
                        if (!frames.contains(reply) && frames.size() < 20) frames.add(reply);
                    } catch (Exception ignored) {}
                }
            );
        }
        if (
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) WebViewCompat.addDocumentStartJavaScript(site, bridge, Collections.singleton("*"));
        site.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    try {
                        validateUrl(request.getUrl().toString());
                        return false;
                    } catch (Exception e) {
                        return true;
                    }
                }

                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap image) {
                    frames.clear();
                    sample = new JSONObject();
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    view.evaluateJavascript(bridge, null);
                }

                @Override
                public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
                ) {
                    String u = request.getUrl().toString();
                    if (u.matches("(?i).*\\.(m3u8|mp4)(\\?.*)?$")) {
                        observed.add(u);
                        if (observed.size() > 30) observed.remove(0);
                    }
                    return null;
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError err
                ) {
                    if (request.isForMainFrame()) try {
                        emit(
                            "site-error",
                            new JSONObject().put("message", "原站加载失败：" + err.getDescription())
                        );
                    } catch (Exception ignored) {}
                }
            }
        );
        site.setWebChromeClient(new WebChromeClient());
        site.loadUrl(url);
    }

    private final class Commands {

        @JavascriptInterface
        public void request(String id, String method, String raw) {
            if (
                id == null ||
                method == null ||
                !id.matches("[a-f0-9-]{36}") ||
                raw == null ||
                raw.length() > 4 * 1024 * 1024
            ) return;
            if (method.equals("cacheClear")) {
                try {
                    blocks.cancel(new JSONObject(raw).getString("jobId"));
                } catch (Exception e) {
                    resolve(id, null, e.getMessage());
                    return;
                }
            }
            ExecutorService executor = method.startsWith("cache") ? ioCalls : calls;
            executor.execute(() -> {
                try {
                    JSONObject payload = new JSONObject(raw);
                    if (method.equals("update")) {
                        if (updates == null) updates = new AppUpdates(MainActivity.this, data ->
                            emit("update", data)
                        );
                        resolve(id, updates.call(payload.optString("action", "status")), null);
                        return;
                    }
                    if (method.equals("cacheStart")) {
                        resolve(id, cache.start(payload), null);
                        return;
                    }
                    if (method.equals("cacheClear")) {
                        blocks.cancel(payload.getString("jobId"));
                        resolve(id, cache.clear(payload.getString("jobId")), null);
                        return;
                    }
                    if (method.equals("cacheIO")) {
                        resolve(id, blocks.call(payload), null);
                        return;
                    }
                    runOnUiThread(() -> {
                        try {
                            switch (method) {
                                case "siteAccount":
                                    openSiteAccount();
                                    resolve(id, new JSONObject(), null);
                                    break;
                                case "openBrowser": {
                                    Uri target = Uri.parse(payload.getString("url"));
                                    if (
                                        !(
                                            "https".equals(target.getScheme()) ||
                                            "http".equals(target.getScheme())
                                        ) ||
                                        target.getHost() == null ||
                                        target.getUserInfo() != null
                                    ) throw new IllegalArgumentException("仅支持 HTTP/HTTPS 链接");
                                    startActivity(
                                        new android.content.Intent(
                                            android.content.Intent.ACTION_VIEW,
                                            target
                                        )
                                    );
                                    resolve(id, new JSONObject(), null);
                                    break;
                                }
                                case "openSite":
                                    openSite(payload.getString("url"));
                                    resolve(id, new JSONObject(), null);
                                    break;
                                case "closeSite":
                                    closeSite();
                                    resolve(id, new JSONObject(), null);
                                    break;
                                case "siteBounds":
                                    if (site != null) {
                                        if (payload.optBoolean("hidden")) {
                                            site.setVisibility(View.INVISIBLE);
                                        } else {
                                            float scale =
                                                ui.getWidth() /
                                                (float) Math.max(
                                                    1,
                                                    payload.optDouble(
                                                        "viewportWidth",
                                                        ui.getWidth()
                                                    )
                                                );
                                            FrameLayout.LayoutParams p =
                                                new FrameLayout.LayoutParams(
                                                    Math.max(
                                                        1,
                                                        (int) (payload.optDouble("width") * scale)
                                                    ),
                                                    Math.max(
                                                        1,
                                                        (int) (payload.optDouble("height") * scale)
                                                    )
                                                );
                                            p.leftMargin = (int) (payload.optDouble("x") * scale);
                                            p.topMargin = (int) (payload.optDouble("y") * scale);
                                            site.setLayoutParams(p);
                                            site.setVisibility(View.VISIBLE);
                                        }
                                    }
                                    resolve(id, new JSONObject(), null);
                                    break;
                                case "sampleSite": {
                                    JSONObject result = new JSONObject(sample.toString());
                                    if (
                                        result.optBoolean("available") &&
                                        !result.has("source") &&
                                        !observed.isEmpty()
                                    ) {
                                        String url = observed.get(observed.size() - 1);
                                        result.put(
                                            "source",
                                            new JSONObject()
                                                .put("kind", url.contains(".m3u8") ? "hls" : "file")
                                                .put("video", url)
                                                .put("referer", site == null ? "" : site.getUrl())
                                        );
                                    }
                                    if (!result.optBoolean("available") && site != null) {
                                        site.evaluateJavascript(
                                            bridge + ";JSON.stringify(window.__VS.sample())",
                                            value -> {
                                                try {
                                                    Object decoded = new org.json.JSONTokener(
                                                        value
                                                    ).nextValue();
                                                    resolve(
                                                        id,
                                                        new JSONObject(String.valueOf(decoded)),
                                                        null
                                                    );
                                                } catch (Exception e) {
                                                    resolve(id, new JSONObject(), null);
                                                }
                                            }
                                        );
                                    } else resolve(id, result, null);
                                    break;
                                }
                                case "applySite":
                                    if (site != null) {
                                        if (
                                            WebViewFeature.isFeatureSupported(
                                                WebViewFeature.WEB_MESSAGE_LISTENER
                                            )
                                        ) for (JavaScriptReplyProxy frame : new ArrayList<>(frames))
                                            try {
                                                frame.postMessage(payload.toString());
                                            } catch (Exception ignored) {}
                                        site.evaluateJavascript(
                                            bridge + ";window.__VS.apply(" + payload + ")",
                                            null
                                        );
                                    }
                                    resolve(id, new JSONObject(), null);
                                    break;
                                default:
                                    throw new IOException("未知命令");
                            }
                        } catch (Exception e) {
                            resolve(id, null, e.getMessage());
                        }
                    });
                } catch (Exception e) {
                    resolve(id, null, e.getMessage());
                }
            });
        }
    }

    private void resolve(String id, Object value, String error) {
        runOnUiThread(() -> {
            try {
                JSONObject packet = new JSONObject();
                if (error != null) packet.put("error", error);
                else packet.put("value", value == null ? JSONObject.NULL : value);
                ui.evaluateJavascript(
                    "window.__nativeResolve&&window.__nativeResolve(" +
                        JSONObject.quote(id) +
                        "," +
                        JSONObject.quote(packet.toString()) +
                        ")",
                    null
                );
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onBackPressed() {
        if (site != null && site.canGoBack()) site.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (accountDialog != null) accountDialog.dismiss();
        if (updates != null) updates.close();
        if (blocks != null) blocks.cancel("*");
        if (cache != null) cache.close();
        calls.shutdownNow();
        ioCalls.shutdownNow();
        closeSite();
        if (ui != null) {
            ui.removeJavascriptInterface("VSNative");
            ui.destroy();
            ui = null;
        }
        super.onDestroy();
    }
}
