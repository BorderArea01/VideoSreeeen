package io.github.borderarea01.videosreeeen;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Stable package identity, HTTPS release assets, hashes and Android signature checks. */
final class AppUpdates {

    private static final String BASE =
        "https://github.com/BorderArea01/VideoSreeeen/releases/latest/download/";
    private final Activity activity;
    private final Consumer<JSONObject> events;
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private JSONObject state = new JSONObject();
    private JSONObject release;
    private boolean busy;
    private final File directory, apk;

    AppUpdates(Activity activity, Consumer<JSONObject> events) throws Exception {
        this.activity = activity;
        this.events = events;
        directory = new File(activity.getCacheDir(), "updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException(
            "无法创建更新目录"
        );
        apk = new File(directory, "update.apk");
        new File(directory, "update.part").delete();
        state.put("state", "idle").put("version", BuildConfig.VERSION_NAME);
    }

    private synchronized void set(String next, String message) {
        try {
            state.put("state", next).put("message", message);
            events.accept(new JSONObject(state.toString()));
        } catch (Exception ignored) {}
    }

    synchronized JSONObject call(String action) throws Exception {
        if (action.equals("status")) return new JSONObject(state.toString());
        if (action.equals("install")) {
            if (!"ready".equals(state.optString("state")) || !apk.isFile()) throw new IOException(
                "请先下载更新"
            );
            verifyApk(apk);
            activity.runOnUiThread(() -> {
                try {
                    if (!activity.getPackageManager().canRequestPackageInstalls()) {
                        activity.startActivity(
                            new Intent(
                                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName())
                            )
                        );
                        set("ready", "允许此应用安装更新后，再点安装更新");
                        return;
                    }
                    Uri uri = FileProvider.getUriForFile(
                        activity,
                        activity.getPackageName() + ".updates",
                        apk
                    );
                    Intent intent = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    activity.startActivity(intent);
                } catch (Exception e) {
                    set("error", "无法打开系统安装程序");
                }
            });
            return new JSONObject(state.toString());
        }
        if (!action.equals("check") && !action.equals("download")) throw new IOException(
            "未知更新操作"
        );
        if (busy) return new JSONObject(state.toString());
        if (
            action.equals("download") &&
            (release == null || !"available".equals(state.optString("state")))
        ) throw new IOException("请先检查更新");
        busy = true;
        set(action.equals("check") ? "checking" : "downloading", "");
        work.execute(() -> {
            try {
                if (action.equals("check")) check();
                else download();
            } catch (Exception e) {
                set("error", e.getMessage() == null ? "更新失败" : e.getMessage());
            } finally {
                synchronized (this) {
                    busy = false;
                }
            }
        });
        return new JSONObject(state.toString());
    }

    private HttpURLConnection connection(String address) throws Exception {
        URL url = new URL(address);
        for (int i = 0; i < 6; i++) {
            String host = url.getHost();
            if (
                !url.getProtocol().equals("https") ||
                !(host.equals("github.com") || host.endsWith(".githubusercontent.com"))
            ) throw new IOException("不受信任的更新地址");
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "VideoSreeeen/" + BuildConfig.VERSION_NAME);
            int status = c.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null) throw new IOException("更新重定向错误");
                url = new URL(url, location);
                continue;
            }
            if (status != 200) {
                c.disconnect();
                throw new IOException(status == 404 ? "暂无已发布版本" : "更新服务返回 " + status);
            }
            return c;
        }
        throw new IOException("更新重定向次数过多");
    }

    private void check() throws Exception {
        HttpURLConnection c = connection(BASE + "update.json");
        try (
            InputStream input = c.getInputStream();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[4096];
            int n;
            while ((n = input.read(buffer)) != -1) {
                if (bytes.size() + n > 65536) throw new IOException("更新元数据过大");
                bytes.write(buffer, 0, n);
            }
            JSONObject info = new JSONObject(bytes.toString("UTF-8"));
            JSONObject android = info.getJSONObject("android");
            if (
                !android
                    .getString("url")
                    .matches(
                        "https://github\\.com/BorderArea01/VideoSreeeen/releases/download/v[0-9.]+/VideoSreeeen-Android\\.apk"
                    ) ||
                !android.getString("sha256").matches("[a-fA-F0-9]{64}") ||
                android.getLong("size") < 1 ||
                android.getLong("size") > 128 * 1024 * 1024
            ) throw new IOException("更新元数据无效");
            synchronized (this) {
                release = android;
                state.put("next", info.getString("version"));
            }
            set(
                android.getInt("versionCode") > BuildConfig.VERSION_CODE ? "available" : "current",
                ""
            );
        } finally {
            c.disconnect();
        }
    }

    private void download() throws Exception {
        JSONObject info;
        synchronized (this) {
            info = new JSONObject(release.toString());
        }
        File partial = new File(directory, "update.part");
        HttpURLConnection c = connection(info.getString("url"));
        long expected = info.getLong("size"),
            total = 0,
            last = 0;
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        boolean complete = false;
        try (
            InputStream input = c.getInputStream();
            FileOutputStream output = new FileOutputStream(partial)
        ) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("更新已取消");
                total += n;
                if (total > expected) throw new IOException("更新文件大小不符");
                hash.update(buffer, 0, n);
                output.write(buffer, 0, n);
                if (System.currentTimeMillis() - last > 500) {
                    last = System.currentTimeMillis();
                    synchronized (this) {
                        state.put("progress", (total * 100.0) / expected);
                    }
                    set("downloading", "");
                }
            }
            output.getFD().sync();
            StringBuilder digest = new StringBuilder();
            for (byte b : hash.digest()) digest.append(String.format(Locale.ROOT, "%02x", b & 255));
            if (
                total != expected || !digest.toString().equalsIgnoreCase(info.getString("sha256"))
            ) throw new IOException("更新文件校验失败");
            verifyApk(partial);
            Files.move(partial.toPath(), apk.toPath(), StandardCopyOption.REPLACE_EXISTING);
            complete = true;
            set("ready", "");
        } finally {
            c.disconnect();
            if (!complete) partial.delete();
        }
    }

    @SuppressWarnings("deprecation")
    private Signature[] signatures(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28
            ? info.signingInfo.getApkContentsSigners()
            : info.signatures;
    }

    @SuppressWarnings("deprecation")
    private void verifyApk(File file) throws Exception {
        PackageManager pm = activity.getPackageManager();
        int flags =
            Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags),
            current = pm.getPackageInfo(activity.getPackageName(), flags);
        if (
            candidate == null ||
            !activity.getPackageName().equals(candidate.packageName) ||
            (Build.VERSION.SDK_INT >= 28
                ? candidate.getLongVersionCode()
                : candidate.versionCode) <= BuildConfig.VERSION_CODE ||
            !Arrays.equals(signatures(current), signatures(candidate))
        ) throw new IOException("更新包的应用、版本或签名不匹配");
    }

    void close() {
        work.shutdownNow();
    }
}
