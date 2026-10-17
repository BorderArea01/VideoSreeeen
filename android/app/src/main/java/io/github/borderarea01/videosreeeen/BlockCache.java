package io.github.borderarea01.videosreeeen;

import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.json.*;

/** Bounded block I/O. Only the bundled UI can call this bridge. */
final class BlockCache {

    private static final int BLOCK = 256 * 1024;
    private final File root;
    private String jobId;
    private JSONObject plan;
    private final Map<String, Long> sizes = new LinkedHashMap<>();
    private final Map<String, Set<Long>> completed = new HashMap<>();
    private volatile HttpURLConnection connection;
    private volatile String networkJob;
    private volatile boolean closed;
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    BlockCache(File root) {
        this.root = root;
    }

    void cancel(String id) {
        if (id.equals("*")) closed = true;
        else cancelled.add(id);
        HttpURLConnection c = connection;
        if (c != null && (closed || id.equals(networkJob))) c.disconnect();
    }

    private void check(String id) throws IOException {
        if (
            closed || cancelled.contains(id) || Thread.currentThread().isInterrupted()
        ) throw new IOException("缓存任务已取消");
    }

    private File directory(String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IOException("缓存编号无效");
        return new File(root, id);
    }

    private static boolean nameOK(String n) {
        return (
            n.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}") &&
            !n.contains("..") &&
            !n.equals("complete.json")
        );
    }

    private static String hex(byte[] data) {
        StringBuilder out = new StringBuilder();
        for (byte b : data) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }

    Object call(JSONObject p) throws Exception {
        String action = p.getString("action"),
            id = p.getString("jobId");
        File dir = directory(id);
        check(id);
        if (
            action.equals("probe") || action.equals("fetch") || action.equals("text")
        ) return network(p);
        if (action.equals("init")) {
            if (jobId != null && cancelled.contains(jobId)) {
                jobId = null;
                sizes.clear();
                completed.clear();
            }
            if (jobId != null) throw new IOException("已有缓存任务");
            JSONArray files = p.getJSONArray("files");
            if (files.length() < 1 || files.length() > 2) throw new IOException("分块计划无效");
            long total = 0;
            Map<String, Long> checked = new LinkedHashMap<>();
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String name = f.getString("name");
                long size = f.getLong("size");
                if (
                    !nameOK(name) ||
                    size <= 0 ||
                    size > 4L * 1024 * 1024 * 1024 ||
                    checked.containsKey(name)
                ) throw new IOException("分块文件无效");
                checked.put(name, size);
                total += size;
            }
            if (
                total >
                Math.min(4L * 1024 * 1024 * 1024, root.getUsableSpace() - 256L * 1024 * 1024)
            ) throw new IOException("缓存超过可用磁盘空间");
            if (
                !checked.containsKey(p.getString("entry")) ||
                (p.has("audio") && !checked.containsKey(p.getString("audio")))
            ) throw new IOException("缓存入口无效");
            dir.mkdirs();
            sizes.putAll(checked);
            for (String name : sizes.keySet()) completed.put(name, new HashSet<>());
            jobId = id;
            plan = p;
            return new JSONObject();
        }
        if (!id.equals(jobId)) throw new IOException("缓存任务已取消");
        if (action.equals("finish")) {
            ArrayList<String> hashes = new ArrayList<>();
            long bytes = 0;
            byte[] buffer = new byte[65536];
            for (Map.Entry<String, Long> f : sizes.entrySet()) {
                if (
                    completed.get(f.getKey()).size() != (f.getValue() + BLOCK - 1) / BLOCK
                ) throw new IOException("分块尚未完整");
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                try (InputStream in = new FileInputStream(new File(dir, f.getKey()))) {
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        check(id);
                        hash.update(buffer, 0, n);
                    }
                }
                hashes.add(hex(hash.digest()));
                bytes += f.getValue();
            }
            String fingerprint = hex(
                MessageDigest.getInstance("SHA-256").digest(
                    String.join("\n", hashes).getBytes(StandardCharsets.UTF_8)
                )
            );
            check(id);
            try (FileOutputStream out = new FileOutputStream(new File(dir, "complete.json"))) {
                out.write(plan.toString().getBytes(StandardCharsets.UTF_8));
            }
            JSONObject result = new JSONObject()
                .put("state", "ready")
                .put("jobId", id)
                .put("progress", 1)
                .put("bytes", bytes)
                .put("fingerprint", fingerprint)
                .put(
                    "entry",
                    "https://videosreeeen.local/cache/" + id + "/" + plan.getString("entry")
                );
            if (plan.has("audio")) result.put(
                "audio",
                "https://videosreeeen.local/cache/" + id + "/" + plan.getString("audio")
            );
            return result;
        }
        String name = p.getString("name");
        long offset = p.getLong("offset");
        Long size = sizes.get(name);
        if (
            size == null || offset < 0 || offset % BLOCK != 0 || offset >= size
        ) throw new IOException("分块地址无效");
        int length = (int) Math.min(BLOCK, size - offset);
        if (action.equals("put")) {
            String encoded = p.getString("data");
            if (encoded.length() > 350000) throw new IOException("分块过大");
            byte[] data = Base64.decode(encoded, Base64.DEFAULT);
            if (data.length != length) throw new IOException("分块长度不符");
            try (RandomAccessFile out = new RandomAccessFile(new File(dir, name), "rw")) {
                out.seek(offset);
                out.write(data);
            }
            completed.get(name).add(offset);
            return new JSONObject();
        }
        if (action.equals("get") && completed.get(name).contains(offset)) {
            byte[] data = new byte[length];
            try (RandomAccessFile in = new RandomAccessFile(new File(dir, name), "r")) {
                in.seek(offset);
                in.readFully(data);
            }
            return Base64.encodeToString(data, Base64.NO_WRAP);
        }
        throw new IOException("分块不可用");
    }

    private Object network(JSONObject p) throws Exception {
        String action = p.getString("action");
        URL url = new URL(p.getString("url"));
        if (
            (!url.getProtocol().equals("http") && !url.getProtocol().equals("https")) ||
            url.getUserInfo() != null
        ) throw new IOException("下载地址无效");
        long offset = p.optLong("offset", 0);
        int length = p.optInt("length", 1);
        if (offset < 0 || length < 1 || length > BLOCK) throw new IOException("下载范围无效");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        networkJob = p.getString("jobId");
        connection = c;
        c.setConnectTimeout(12000);
        c.setReadTimeout(12000);
        c.setRequestProperty("Accept-Encoding", "identity");
        if (p.has("referer") && p.getString("referer").matches("https?://.*")) c.setRequestProperty(
            "Referer",
            p.getString("referer")
        );
        if (!action.equals("text")) c.setRequestProperty(
            "Range",
            "bytes=" + offset + "-" + (offset + length - 1)
        );
        try {
            int code = c.getResponseCode();
            java.util.regex.Matcher range = java.util.regex.Pattern.compile(
                "bytes (\\d+)-(\\d+)/(\\d+)"
            ).matcher(String.valueOf(c.getHeaderField("Content-Range")));
            if (
                code < 200 ||
                code >= 300 ||
                (!action.equals("text") &&
                    (code != 206 ||
                        !range.matches() ||
                        Long.parseLong(range.group(1)) != offset ||
                        Long.parseLong(range.group(2)) != offset + length - 1))
            ) throw new IOException("源站不支持安全分块下载");
            int max = action.equals("text") ? 2 * 1024 * 1024 : length;
            try (
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream()
            ) {
                byte[] buffer = new byte[16384];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    check(p.getString("jobId"));
                    if (out.size() + n > max) throw new IOException("下载超过分块上限");
                    out.write(buffer, 0, n);
                }
                if (!action.equals("text") && out.size() != max) throw new IOException(
                    "分块未完整下载"
                );
                if (action.equals("probe")) return new JSONObject().put(
                    "size",
                    Long.parseLong(range.group(3))
                );
                return action.equals("text")
                    ? out.toString("UTF-8")
                    : Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            }
        } finally {
            c.disconnect();
            connection = null;
        }
    }
}
