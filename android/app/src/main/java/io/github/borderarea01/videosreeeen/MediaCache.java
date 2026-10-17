package io.github.borderarea01.videosreeeen;

import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

final class MediaCache {

    interface Events {
        void emit(String type, JSONObject data);
    }

    private final File root;
    private final Events events;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile Future<?> active;
    private volatile HttpURLConnection connection;
    private volatile String activeId;

    MediaCache(File root, Events events) throws Exception {
        this.root = root;
        this.events = events;
        root.mkdirs();
        File[] old = root.listFiles();
        if (old != null) for (File f : old) if (validId(f.getName())) remove(f);
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[a-f0-9-]{36}");
    }

    private File directory(String id) throws IOException {
        if (!validId(id)) throw new IOException("缓存编号无效");
        return new File(root, id);
    }

    private static void remove(File file) throws IOException {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) remove(child);
        }
        if (file.exists() && !file.delete()) throw new IOException("缓存清理失败");
    }

    private static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder();
        for (byte b : bytes) s.append(String.format(Locale.ROOT, "%02x", b & 255));
        return s.toString();
    }

    synchronized JSONObject start(JSONObject request) throws Exception {
        if (active != null && !active.isDone()) throw new IOException("已有缓存任务正在运行");
        String id = request.getString("jobId");
        JSONObject plan = request.getJSONObject("plan");
        JSONArray files = plan.getJSONArray("files");
        if (files.length() < 1 || files.length() > 12002) throw new IOException("缓存计划无效");
        Set<String> names = new HashSet<>();
        for (int i = 0; i < files.length(); i++) {
            String name = files.getJSONObject(i).getString("name");
            if (
                !name.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}") ||
                name.contains("..") ||
                name.equals("complete.json") ||
                !names.add(name)
            ) throw new IOException("缓存文件名无效");
        }
        if (
            !names.contains(plan.getString("entry")) ||
            (plan.has("audio") && !names.contains(plan.getString("audio")))
        ) throw new IOException("缺少缓存入口");
        File dir = directory(id);
        dir.mkdirs();
        AtomicBoolean stop = new AtomicBoolean(false);
        cancelled = stop;
        activeId = id;
        active = worker.submit(() -> download(id, plan, dir, stop));
        return new JSONObject().put("started", true);
    }

    private void download(String id, JSONObject plan, File dir, AtomicBoolean stop) {
        long total = 0,
            lastEvent = 0;
        List<String> hashes = new ArrayList<>();
        try {
            long budget = Math.min(
                4L * 1024 * 1024 * 1024,
                root.getUsableSpace() - 256L * 1024 * 1024
            );
            if (budget < 32L * 1024 * 1024) throw new IOException("可用磁盘空间不足");
            JSONArray files = plan.getJSONArray("files");
            byte[] buffer = new byte[64 * 1024];
            for (int i = 0; i < files.length(); i++) {
                if (stop.get()) throw new InterruptedIOException("缓存已取消");
                JSONObject file = files.getJSONObject(i);
                File output = new File(dir, file.getString("name"));
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                if (file.has("content")) {
                    byte[] data = file.getString("content").getBytes(StandardCharsets.UTF_8);
                    if (data.length > 2 * 1024 * 1024) throw new IOException("播放列表过大");
                    try (FileOutputStream out = new FileOutputStream(output)) {
                        out.write(data);
                    }
                    hash.update(data);
                    total += data.length;
                } else {
                    URL url = new URL(file.getString("url"));
                    if (
                        !url.getProtocol().equals("http") && !url.getProtocol().equals("https")
                    ) throw new IOException("下载地址无效");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    connection = conn;
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(20000);
                    conn.setRequestProperty("Accept-Encoding", "identity");
                    if (plan.has("referer")) conn.setRequestProperty(
                        "Referer",
                        plan.getString("referer")
                    );
                    int code = conn.getResponseCode();
                    if (code != 200) throw new IOException("视频下载失败 (" + code + ")");
                    long expected = conn.getContentLengthLong(),
                        count = 0;
                    File partial = new File(dir, file.getString("name") + ".part");
                    try (
                        InputStream in = conn.getInputStream();
                        FileOutputStream out = new FileOutputStream(partial)
                    ) {
                        int n;
                        while ((n = in.read(buffer)) != -1) {
                            if (stop.get()) throw new InterruptedIOException("缓存已取消");
                            count += n;
                            total += n;
                            if (total > budget) throw new IOException("视频超过磁盘缓存上限");
                            hash.update(buffer, 0, n);
                            out.write(buffer, 0, n);
                            long now = System.currentTimeMillis();
                            if (now - lastEvent > 800) {
                                lastEvent = now;
                                events.emit(
                                    "cache",
                                    new JSONObject()
                                        .put("jobId", id)
                                        .put("state", "downloading")
                                        .put("bytes", total)
                                        .put(
                                            "progress",
                                            (i +
                                                (expected > 0
                                                    ? Math.min(.99, (double) count / expected)
                                                    : 0)) /
                                                files.length()
                                        )
                                );
                            }
                        }
                    } finally {
                        conn.disconnect();
                        connection = null;
                    }
                    if (count == 0 || (expected >= 0 && count != expected)) throw new IOException(
                        "视频未完整下载"
                    );
                    if (!partial.renameTo(output)) throw new IOException("缓存落盘失败");
                }
                hashes.add(hex(hash.digest()));
            }
            if (stop.get()) throw new InterruptedIOException("缓存已取消");
            String fingerprint = hex(
                MessageDigest.getInstance("SHA-256").digest(
                    String.join("\n", hashes).getBytes(StandardCharsets.UTF_8)
                )
            );
            try (FileOutputStream out = new FileOutputStream(new File(dir, "complete.json"))) {
                out.write(plan.toString().getBytes(StandardCharsets.UTF_8));
            }
            JSONObject result = new JSONObject()
                .put("jobId", id)
                .put("state", "ready")
                .put("bytes", total)
                .put("progress", 1)
                .put("fingerprint", fingerprint)
                .put(
                    "entry",
                    "https://videosreeeen.local/cache/" + id + "/" + plan.getString("entry")
                );
            if (plan.has("audio")) result.put(
                "audio",
                "https://videosreeeen.local/cache/" + id + "/" + plan.getString("audio")
            );
            events.emit("cache", result);
        } catch (Exception e) {
            try {
                remove(dir);
            } catch (Exception ignored) {}
            if (!stop.get()) try {
                events.emit(
                    "cache",
                    new JSONObject()
                        .put("jobId", id)
                        .put("state", "error")
                        .put("bytes", total)
                        .put("progress", 0)
                        .put("error", e.getMessage() == null ? "缓存失败" : e.getMessage())
                );
            } catch (Exception ignored) {}
        }
    }

    synchronized JSONObject clear(String id) throws Exception {
        if (id.equals(activeId) && active != null && !active.isDone()) {
            cancelled.set(true);
            HttpURLConnection conn = connection;
            if (conn != null) conn.disconnect();
            try {
                active.get(25, TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                throw new IOException("缓存任务仍在停止，请稍后重试");
            }
        }
        remove(directory(id));
        return new JSONObject();
    }

    WebResourceResponse response(String path, String range) {
        try {
            String[] parts = path.split("/");
            if (
                parts.length != 4 ||
                !parts[3].matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}") ||
                parts[3].contains("..")
            ) return null;
            File dir = directory(parts[2]);
            if (!new File(dir, "complete.json").isFile()) return null;
            File file = new File(dir, parts[3]);
            if (!file.isFile()) return null;
            long length = file.length(),
                start = 0,
                end = length - 1;
            int status = 200;
            if (range != null) {
                java.util.regex.Matcher match = java.util.regex.Pattern.compile(
                    "bytes=(\\d*)-(\\d*)"
                ).matcher(range);
                if (!match.matches()) return null;
                if (!match.group(1).isEmpty()) {
                    start = Long.parseLong(match.group(1));
                    if (!match.group(2).isEmpty()) end = Math.min(
                        end,
                        Long.parseLong(match.group(2))
                    );
                } else if (!match.group(2).isEmpty()) start = Math.max(
                    0,
                    length - Long.parseLong(match.group(2))
                );
                if (start > end || start >= length) return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    416,
                    "Range Not Satisfiable",
                    Collections.singletonMap("Content-Range", "bytes */" + length),
                    new ByteArrayInputStream(new byte[0])
                );
                status = 206;
            }
            FileInputStream input = new FileInputStream(file);
            long skipped = 0;
            while (skipped < start) {
                long step = input.skip(start - skipped);
                if (step <= 0) {
                    input.close();
                    throw new IOException("缓存读取失败");
                }
                skipped += step;
            }
            final long count = end - start + 1;
            InputStream limited = new FilterInputStream(input) {
                long remaining = count;

                @Override
                public int read() throws IOException {
                    if (remaining <= 0) return -1;
                    int value = super.read();
                    if (value >= 0) remaining--;
                    return value;
                }

                @Override
                public int read(byte[] b, int off, int len) throws IOException {
                    if (remaining <= 0) return -1;
                    int n = in.read(b, off, (int) Math.min(len, remaining));
                    if (n > 0) remaining -= n;
                    return n;
                }
            };
            String name = file.getName(),
                mime = name.endsWith("m3u8")
                    ? "application/vnd.apple.mpegurl"
                    : name.endsWith("m4a")
                      ? "audio/mp4"
                      : name.endsWith("mp4")
                        ? "video/mp4"
                        : "application/octet-stream";
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", Long.toString(count));
            if (status == 206) headers.put(
                "Content-Range",
                "bytes " + start + "-" + end + "/" + length
            );
            return new WebResourceResponse(
                mime,
                null,
                status,
                status == 206 ? "Partial Content" : "OK",
                headers,
                limited
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    void close() {
        cancelled.set(true);
        if (connection != null) connection.disconnect();
        worker.submit(() -> {
            File[] files = root.listFiles();
            if (files != null) for (File file : files)
                if (validId(file.getName())) try {
                    remove(file);
                } catch (Exception ignored) {}
        });
        worker.shutdown();
    }
}
