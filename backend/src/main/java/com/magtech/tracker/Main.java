package com.magtech.tracker;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/**
 * MagtechOne Tracker API. Plain JDK 17+, no dependencies.
 *
 * Environment:
 *   PORT                   default 8080
 *   STORE                  github | local (default: github if GITHUB_TOKEN is set, else local)
 *   GITHUB_TOKEN           fine-grained token: Contents read/write (+ Issues read/write) on the repo
 *   GITHUB_REPO            owner/name, e.g. magtech/magtechone-tracker
 *   GITHUB_BRANCH          default main
 *   GITHUB_ISSUES          true = create/close a GitHub issue per assigned bug (GitHub notifies the developer)
 *   DATA_DIR               local store only, default ../data
 *   AUTH_SECRET            long random text used to sign sign-in tokens (keep it the same across restarts)
 *   DEFAULT_PASSWORD       password for new members and anyone without one (default tester12345)
 *   ALLOWED_ORIGIN         website origin for CORS, e.g. https://magtech.github.io (default *)
 *   REFRESH_SECONDS        how often to re-read the repo for changes made elsewhere (default 60)
 */
public final class Main {
    private static final Logger LOG = Logger.getLogger("tracker");

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(env("PORT", "8080"));
        String token = env("GITHUB_TOKEN", "");
        String storeKind = env("STORE", token.isEmpty() ? "local" : "github");
        Store store = "github".equals(storeKind)
            ? new Store.GitHub(required("GITHUB_REPO"), env("GITHUB_BRANCH", "main"), required("GITHUB_TOKEN"))
            : new Store.Local(Path.of(env("DATA_DIR", "../data")));
        Tracker tracker = new Tracker(store, Boolean.parseBoolean(env("GITHUB_ISSUES", "false")));
        tracker.refresh();
        tracker.setDefaultPassword(env("DEFAULT_PASSWORD", env("INITIAL_LEAD_PASSWORD", "tester12345")));
        tracker.bootstrapPasswords();
        LOG.info("Loaded data from " + store.describe());

        String secret = env("AUTH_SECRET", "");
        if (secret.isEmpty()) {
            secret = Auth.randomSecret();
            LOG.warning("AUTH_SECRET is not set: using a random one, so everyone must sign in again after each restart.");
        }
        Auth auth = new Auth(secret);

        int every = Integer.parseInt(env("REFRESH_SECONDS", "60"));
        ScheduledExecutorService sched = Executors.newSingleThreadScheduledExecutor();
        sched.scheduleWithFixedDelay(() -> {
            try { tracker.refresh(); } catch (RuntimeException e) { LOG.warning("Refresh failed: " + e.getMessage()); }
        }, every, every, TimeUnit.SECONDS);

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", new Router(tracker, auth, env("ALLOWED_ORIGIN", "*"))::handle);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.start();
        LOG.info("MagtechOne Tracker API listening on :" + port);
    }

    private static String env(String k, String def) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? def : v.trim();
    }

    private static String required(String k) {
        String v = env(k, "");
        if (v.isEmpty()) throw new IllegalStateException("Missing environment variable " + k);
        return v;
    }

    // ===================================================================== routing
    static final class Router {
        private final Tracker tracker;
        private final Auth auth;
        private final String origin;

        Router(Tracker tracker, Auth auth, String origin) {
            this.tracker = tracker;
            this.auth = auth;
            this.origin = origin;
        }

        void handle(HttpExchange ex) throws IOException {
            String method = ex.getRequestMethod();
            String path = ex.getRequestURI().getPath().replaceAll("/+$", "");
            ex.getResponseHeaders().add("Access-Control-Allow-Origin", origin);
            ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
            ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type, Authorization");
            ex.getResponseHeaders().add("Vary", "Origin");
            try {
                if ("OPTIONS".equals(method)) { send(ex, 204, null); return; }
                if (path.equals("/api/health")) { send(ex, 200, Map.of("ok", true)); return; }
                if (method.equals("POST") && path.equals("/api/login")) { login(ex); return; }

                String user = auth.check(bearer(ex));
                if (user == null || tracker.member(user) == null) throw new Tracker.ApiException(401, "Please sign in.");

                if (method.equals("GET") && path.equals("/api/me")) { send(ex, 200, Map.of("user", Tracker.publicMember(tracker.member(user)))); return; }
                if (method.equals("PUT") && path.equals("/api/me/password")) {
                    Map<String, Object> b = body(ex);
                    tracker.changePassword(user, Tracker.str(b, "current"), Tracker.str(b, "next"));
                    send(ex, 200, Map.of("ok", true));
                    return;
                }
                if (method.equals("GET") && path.equals("/api/all")) { send(ex, 200, tracker.all()); return; }
                if (method.equals("POST") && path.equals("/api/testcases")) { send(ex, 201, tracker.createTestCase(body(ex), user)); return; }
                if (method.equals("PUT") && path.startsWith("/api/testcases/")) { send(ex, 200, tracker.updateTestCase(id(path), body(ex), user)); return; }
                if (method.equals("POST") && path.equals("/api/bugs")) { send(ex, 201, tracker.createBug(body(ex), user)); return; }
                if (method.equals("PUT") && path.startsWith("/api/bugs/")) { send(ex, 200, tracker.updateBug(id(path), body(ex), user)); return; }
                if (method.equals("PUT") && path.equals("/api/team")) { send(ex, 200, tracker.saveTeam(listBody(ex), user)); return; }
                if (method.equals("PUT") && path.equals("/api/modules")) { send(ex, 200, tracker.saveModules(listBody(ex), user)); return; }
                if (method.equals("POST") && path.equals("/api/import")) { send(ex, 200, tracker.importData(body(ex), user)); return; }
                throw new Tracker.ApiException(404, "No such endpoint: " + method + " " + path);
            } catch (Tracker.ApiException e) {
                send(ex, e.status, error(e.getMessage()));
            } catch (IllegalArgumentException | ClassCastException e) {
                send(ex, 400, error("Bad request: " + e.getMessage()));
            } catch (RuntimeException e) {
                LOG.severe("Request failed: " + e);
                send(ex, 502, error("Could not save to the repository right now. Try again in a moment."));
            }
        }

        private void login(HttpExchange ex) throws IOException {
            Map<String, Object> b = body(ex);
            String login = Tracker.str(b, "login").trim().toLowerCase();
            if (auth.blocked(login)) throw new Tracker.ApiException(429, "Too many wrong passwords. Wait 15 minutes and try again.");
            Map<String, Object> m = tracker.findLogin(login);
            if (m == null || !Auth.verify(Tracker.str(b, "password"), Tracker.str(m, "passwordHash"))) {
                auth.failed(login);
                throw new Tracker.ApiException(401, "Wrong username/email or password.");
            }
            auth.succeeded(login);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("token", auth.issue(Tracker.str(m, "id")));
            out.put("user", Tracker.publicMember(m));
            send(ex, 200, out);
        }

        private static String bearer(HttpExchange ex) {
            String h = ex.getRequestHeaders().getFirst("Authorization");
            return h != null && h.startsWith("Bearer ") ? h.substring(7).trim() : null;
        }

        private static String id(String path) {
            return URLDecoder.decode(path.substring(path.lastIndexOf('/') + 1), StandardCharsets.UTF_8);
        }

        private static Map<String, Object> body(HttpExchange ex) throws IOException {
            return Json.parseObject(read(ex));
        }

        @SuppressWarnings("unchecked")
        private static List<Object> listBody(HttpExchange ex) throws IOException {
            Object parsed = Json.parse(read(ex));
            if (!(parsed instanceof List)) throw new Tracker.ApiException(400, "Expected a list.");
            return (List<Object>) parsed;
        }

        private static String read(HttpExchange ex) throws IOException {
            try (InputStream in = ex.getRequestBody()) {
                return new String(in.readNBytes(20_000_000), StandardCharsets.UTF_8);
            }
        }

        private static Map<String, Object> error(String msg) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("error", msg);
            return m;
        }

        private static void send(HttpExchange ex, int status, Object body) throws IOException {
            if (body == null) {
                ex.sendResponseHeaders(status, -1);
                ex.close();
                return;
            }
            byte[] out = Json.write(body).getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            ex.sendResponseHeaders(status, out.length);
            try (OutputStream os = ex.getResponseBody()) { os.write(out); }
        }
    }
}
