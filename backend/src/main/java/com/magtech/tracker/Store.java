package com.magtech.tracker;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** Where the JSON files live: the GitHub repo (production) or a local folder (development). */
public interface Store {

    /** All files under data/: path ("data/bugs/BUG-001.json") -> file text. */
    Map<String, String> loadAll();

    /** Create or replace one file. Throws ConflictException if someone else changed it meanwhile. */
    void write(String path, String content, String commitMessage);

    /** Create or replace many files in one go (one commit on GitHub). */
    void writeMany(Map<String, String> files, String commitMessage);

    String describe();

    final class ConflictException extends RuntimeException {
        private static final long serialVersionUID = 1L;
        public ConflictException(String m) { super(m); }
    }

    // ===================================================================== local folder
    final class Local implements Store {
        private final Path root; // folder that contains data/

        public Local(Path dataDir) { this.root = dataDir.toAbsolutePath().normalize().getParent(); }

        @Override public Map<String, String> loadAll() {
            Map<String, String> out = new LinkedHashMap<>();
            Path data = root.resolve("data");
            try (Stream<Path> files = Files.walk(data)) {
                files.filter(p -> p.toString().endsWith(".json")).sorted().forEach(p -> {
                    try {
                        out.put(root.relativize(p).toString().replace('\\', '/'), Files.readString(p, StandardCharsets.UTF_8));
                    } catch (IOException e) { throw new UncheckedIOException(e); }
                });
            } catch (IOException e) { throw new UncheckedIOException(e); }
            return out;
        }

        @Override public synchronized void write(String path, String content, String msg) {
            try {
                Path p = root.resolve(path);
                Files.createDirectories(p.getParent());
                Path tmp = p.resolveSibling(p.getFileName() + ".tmp");
                Files.writeString(tmp, content, StandardCharsets.UTF_8);
                Files.move(tmp, p, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException e) { throw new UncheckedIOException(e); }
        }

        @Override public synchronized void writeMany(Map<String, String> files, String msg) {
            for (Map.Entry<String, String> f : files.entrySet()) write(f.getKey(), f.getValue(), msg);
        }

        @Override public String describe() { return "local folder " + root.resolve("data"); }
    }

    // ===================================================================== GitHub repo
    final class GitHub implements Store {
        private final String repo;   // owner/name
        private final String branch;
        private final String token;
        private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
        private final Map<String, String> shas = new HashMap<>();     // path -> blob sha
        private final Map<String, String> cache = new HashMap<>();    // path -> content

        public GitHub(String repo, String branch, String token) {
            this.repo = repo;
            this.branch = branch;
            this.token = token;
        }

        @Override public synchronized Map<String, String> loadAll() {
            Map<String, Object> tree = Json.parseObject(get("/repos/" + repo + "/git/trees/" + enc(branch) + "?recursive=1"));
            Map<String, String> out = new LinkedHashMap<>();
            Map<String, String> seen = new HashMap<>();
            for (Object o : (List<?>) tree.get("tree")) {
                Map<?, ?> e = (Map<?, ?>) o;
                String path = (String) e.get("path");
                if (!"blob".equals(e.get("type")) || !path.startsWith("data/") || !path.endsWith(".json")) continue;
                String sha = (String) e.get("sha");
                seen.put(path, sha);
                if (!sha.equals(shas.get(path))) {          // only download files that changed
                    Map<String, Object> blob = Json.parseObject(get("/repos/" + repo + "/git/blobs/" + sha));
                    String b64 = ((String) blob.get("content")).replaceAll("\\s", "");
                    cache.put(path, new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8));
                    shas.put(path, sha);
                }
                out.put(path, cache.get(path));
            }
            shas.keySet().retainAll(seen.keySet());
            cache.keySet().retainAll(seen.keySet());
            return out;
        }

        @Override public synchronized void write(String path, String content, String msg) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("message", msg);
            body.put("content", Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8)));
            body.put("branch", branch);
            if (shas.containsKey(path)) body.put("sha", shas.get(path));
            HttpResponse<String> r = send("PUT", "/repos/" + repo + "/contents/" + path, Json.write(body));
            if (r.statusCode() == 409 || r.statusCode() == 422) {
                throw new ConflictException(path + " was changed in the repo by someone else. Reload and try again.");
            }
            check(r);
            Map<String, Object> res = Json.parseObject(r.body());
            Map<?, ?> c = (Map<?, ?>) res.get("content");
            shas.put(path, (String) c.get("sha"));
            cache.put(path, content);
        }

        /** One commit with many files, using the Git Data API (base tree + new tree + commit + move branch). */
        @Override public synchronized void writeMany(Map<String, String> files, String msg) {
            if (files.isEmpty()) return;
            Map<String, Object> ref = Json.parseObject(get("/repos/" + repo + "/git/ref/heads/" + branch));
            String head = (String) ((Map<?, ?>) ref.get("object")).get("sha");
            Map<String, Object> commit = Json.parseObject(get("/repos/" + repo + "/git/commits/" + head));
            String baseTree = (String) ((Map<?, ?>) commit.get("tree")).get("sha");

            List<Object> entries = new java.util.ArrayList<>();
            for (Map.Entry<String, String> f : files.entrySet()) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("path", f.getKey());
                e.put("mode", "100644");
                e.put("type", "blob");
                e.put("content", f.getValue());
                entries.add(e);
            }
            Map<String, Object> treeReq = new LinkedHashMap<>();
            treeReq.put("base_tree", baseTree);
            treeReq.put("tree", entries);
            HttpResponse<String> tr = send("POST", "/repos/" + repo + "/git/trees", Json.write(treeReq));
            check(tr);
            String newTree = (String) Json.parseObject(tr.body()).get("sha");

            Map<String, Object> commitReq = new LinkedHashMap<>();
            commitReq.put("message", msg);
            commitReq.put("tree", newTree);
            commitReq.put("parents", List.of(head));
            HttpResponse<String> cr = send("POST", "/repos/" + repo + "/git/commits", Json.write(commitReq));
            check(cr);
            String newCommit = (String) Json.parseObject(cr.body()).get("sha");

            Map<String, Object> refReq = new LinkedHashMap<>();
            refReq.put("sha", newCommit);
            refReq.put("force", false);
            HttpResponse<String> rr = send("PATCH", "/repos/" + repo + "/git/refs/heads/" + branch, Json.write(refReq));
            if (rr.statusCode() == 422 || rr.statusCode() == 409) throw new ConflictException("Someone saved at the same moment. Please run the import again.");
            check(rr);
            loadAll(); // pick up the new blob shas
        }

        // ---- issues: GitHub notifies the assignee by itself
        public Map<String, Object> createIssue(String title, String body, List<String> assignees, List<String> labels) {
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("title", title);
            req.put("body", body);
            req.put("assignees", assignees);
            req.put("labels", labels);
            HttpResponse<String> r = send("POST", "/repos/" + repo + "/issues", Json.write(req));
            check(r);
            Map<String, Object> res = Json.parseObject(r.body());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("number", res.get("number"));
            out.put("url", res.get("html_url"));
            return out;
        }

        public void updateIssue(long number, String state, List<String> assignees, String title) {
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("state", state);
            req.put("assignees", assignees);
            req.put("title", title);
            check(send("PATCH", "/repos/" + repo + "/issues/" + number, Json.write(req)));
        }

        @Override public String describe() { return "GitHub repo " + repo + " (" + branch + ")"; }

        // ---- http helpers
        private String get(String path) {
            HttpResponse<String> r = send("GET", path, null);
            check(r);
            return r.body();
        }

        private HttpResponse<String> send(String method, String path, String body) {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("https://api.github.com" + path))
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "magtechone-tracker");
            b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            try {
                return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            } catch (IOException e) {
                throw new UncheckedIOException("GitHub is not reachable: " + e.getMessage(), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }

        private static void check(HttpResponse<String> r) {
            if (r.statusCode() >= 300) {
                throw new IllegalStateException("GitHub API " + r.statusCode() + ": " + r.body());
            }
        }

        private static String enc(String s) { return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8); }
    }
}
