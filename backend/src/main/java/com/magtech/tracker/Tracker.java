package com.magtech.tracker;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.logging.Logger;

/** Business rules. Every record is one JSON file in data/ (the GitHub repo or a local folder). */
public final class Tracker {
    private static final Logger LOG = Logger.getLogger("tracker");
    static final List<String> TC_STATUSES = List.of("Not run", "Pass", "Fail", "Blocked", "N/A");
    static final List<String> BUG_STATUSES = List.of("Open", "In progress", "Fixed – retest", "Closed");
    static final List<String> SEVERITIES = List.of("Critical", "High", "Medium", "Low");
    static final List<String> PRIORITIES = List.of("High", "Medium", "Low");
    static final List<String> ROLES = List.of("Lead", "QA", "Developer");
    private static final int HISTORY_MAX = 60;

    private final Store store;
    private final boolean issues;
    private final Map<String, Map<String, Object>> testcases = new TreeMap<>();
    private final Map<String, Map<String, Object>> bugs = new TreeMap<>();
    private List<Map<String, Object>> team = new ArrayList<>();
    private List<Map<String, Object>> modules = new ArrayList<>();

    public Tracker(Store store, boolean createIssues) {
        this.store = store;
        this.issues = createIssues && store instanceof Store.GitHub;
    }

    public static final class ApiException extends RuntimeException {
        private static final long serialVersionUID = 1L;
        final int status;
        ApiException(int status, String msg) { super(msg); this.status = status; }
    }

    // ================================================================== loading
    @SuppressWarnings("unchecked")
    public synchronized void refresh() {
        Map<String, String> files = store.loadAll();
        Map<String, Map<String, Object>> tc = new TreeMap<>();
        Map<String, Map<String, Object>> bg = new TreeMap<>();
        List<Map<String, Object>> tm = team;
        List<Map<String, Object>> md = modules;
        for (Map.Entry<String, String> f : files.entrySet()) {
            try {
                String path = f.getKey();
                if (path.startsWith("data/testcases/")) {
                    Map<String, Object> m = Json.parseObject(f.getValue());
                    tc.put((String) m.get("id"), m);
                } else if (path.startsWith("data/bugs/")) {
                    Map<String, Object> m = Json.parseObject(f.getValue());
                    bg.put((String) m.get("id"), m);
                } else if (path.equals("data/team.json")) {
                    tm = (List<Map<String, Object>>) Json.parse(f.getValue());
                } else if (path.equals("data/modules.json")) {
                    md = (List<Map<String, Object>>) Json.parse(f.getValue());
                }
            } catch (RuntimeException e) {
                LOG.warning("Skipping unreadable file " + f.getKey() + ": " + e.getMessage());
            }
        }
        testcases.clear(); testcases.putAll(tc);
        bugs.clear(); bugs.putAll(bg);
        team = tm;
        modules = md;
    }

    private String defaultPassword = "tester12345";

    /** Password given to new members (and to anyone without one yet). */
    public synchronized void setDefaultPassword(String pw) {
        if (pw != null && pw.length() >= 8) defaultPassword = pw;
    }

    /** Start-up: every member without a password gets the default password. */
    public synchronized void bootstrapPasswords() {
        boolean changed = false;
        List<Map<String, Object>> next = new ArrayList<>();
        for (Map<String, Object> m : team) {
            Map<String, Object> c = new LinkedHashMap<>(m);
            if (str(m, "passwordHash").isEmpty()) {
                c.put("passwordHash", Auth.hash(defaultPassword));
                changed = true;
                LOG.info("'" + m.get("id") + "' can sign in with the default password. Ask them to change it.");
            }
            next.add(c);
        }
        if (changed) {
            save("data/team.json", next, "Default passwords for new members");
            team = next;
        }
    }

    public synchronized Map<String, Object> all() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("testcases", new ArrayList<>(testcases.values()));
        out.put("bugs", new ArrayList<>(bugs.values()));
        out.put("team", publicTeam());
        out.put("modules", modules);
        return out;
    }

    private List<Object> publicTeam() {
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> m : team) out.add(publicMember(m));
        return out;
    }

    static Map<String, Object> publicMember(Map<String, Object> m) {
        Map<String, Object> c = new LinkedHashMap<>(m);
        c.remove("passwordHash");
        return c;
    }

    // ================================================================== users & login
    public synchronized Map<String, Object> member(String id) {
        if (id == null) return null;
        for (Map<String, Object> m : team) if (id.equals(m.get("id"))) return m;
        return null;
    }

    public synchronized Map<String, Object> findLogin(String login) {
        String l = login == null ? "" : login.trim().toLowerCase(Locale.ROOT);
        for (Map<String, Object> m : team) {
            if (l.equals(str(m, "id").toLowerCase(Locale.ROOT)) || (!l.isEmpty() && l.equals(str(m, "email").toLowerCase(Locale.ROOT)))) return m;
        }
        return null;
    }

    public synchronized void changePassword(String userId, String current, String next) {
        Map<String, Object> u = member(userId);
        if (u == null) throw new ApiException(401, "Please sign in again.");
        if (!Auth.verify(current, str(u, "passwordHash"))) throw new ApiException(400, "Current password is wrong.");
        if (next == null || next.length() < 8) throw new ApiException(400, "New password needs at least 8 characters.");
        List<Map<String, Object>> list = new ArrayList<>();
        for (Map<String, Object> m : team) {
            Map<String, Object> c = new LinkedHashMap<>(m);
            if (userId.equals(m.get("id"))) c.put("passwordHash", Auth.hash(next));
            list.add(c);
        }
        save("data/team.json", list, "Password changed by " + userId);
        team = list;
    }

    private Map<String, Object> requireUser(String userId) {
        Map<String, Object> u = member(userId);
        if (u == null) throw new ApiException(401, "Please sign in again.");
        return u;
    }

    private Map<String, Object> requireTester(String userId) {
        Map<String, Object> u = requireUser(userId);
        if ("Developer".equals(u.get("role"))) throw new ApiException(403, "Only QA engineers and leads can do this.");
        return u;
    }

    // ================================================================== modules
    private boolean moduleExists(String code) {
        for (Map<String, Object> m : modules) if (code.equals(m.get("code"))) return true;
        return false;
    }

    private String requireModule(String code) {
        if (!moduleExists(code)) throw new ApiException(400, "Unknown module '" + code + "'. Add it under Settings → Modules first.");
        return code;
    }

    public synchronized List<Map<String, Object>> saveModules(List<Object> in, String userId) {
        requireTester(userId);
        List<Map<String, Object>> next = new ArrayList<>();
        Set<String> codes = new LinkedHashSet<>();
        for (Object o : in) {
            Map<?, ?> m = (Map<?, ?>) o;
            String code = String.valueOf(m.get("code")).trim();
            if (!code.matches("[A-Za-z][A-Za-z0-9]{1,11}")) throw new ApiException(400, "Module code '" + code + "' must be 2-12 letters/numbers, starting with a letter.");
            if (!codes.add(code.toLowerCase(Locale.ROOT))) throw new ApiException(400, "Module " + code + " is listed twice.");
            String name = m.get("name") == null ? "" : String.valueOf(m.get("name")).trim();
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("code", code);
            c.put("name", name.isEmpty() ? code : name);
            next.add(c);
        }
        for (Map<String, Object> old : modules) {
            String code = str(old, "code");
            boolean kept = next.stream().anyMatch(n -> code.equals(n.get("code")));
            boolean used = testcases.values().stream().anyMatch(t -> code.equals(t.get("module"))) || bugs.values().stream().anyMatch(b -> code.equals(b.get("module")));
            if (!kept && used) throw new ApiException(400, code + " is used by test cases or bugs, so it can't be removed.");
        }
        save("data/modules.json", next, "Modules updated by " + userId);
        modules = next;
        return next;
    }

    // ================================================================== test cases
    public synchronized Map<String, Object> createTestCase(Map<String, Object> in, String userId) {
        requireUser(userId);
        String id = str(in, "id").toUpperCase(Locale.ROOT);
        if (!id.matches("TC-[A-Z0-9]+-\\d{3,}")) throw new ApiException(400, "Test case ID must look like TC-WFL-038.");
        if (testcases.containsKey(id)) throw new ApiException(409, id + " already exists. Reload to get the next free ID.");
        if (str(in, "scenario").isBlank() || str(in, "steps").isBlank() || str(in, "expected").isBlank()) {
            throw new ApiException(400, "Scenario, steps and expected result are required.");
        }
        requireModule(str(in, "module"));
        String now = now();
        Map<String, Object> tc = newTestCase(in, id);
        tc.put("createdBy", userId);
        tc.put("updatedAt", now);
        tc.put("updatedBy", userId);
        tc.put("history", new ArrayList<>(List.of(entry(now, userId, "Created"))));
        save(tcPath(id), tc, id + " created by " + userId);
        testcases.put(id, tc);
        return tc;
    }

    private static Map<String, Object> newTestCase(Map<String, Object> in, String id) {
        Map<String, Object> tc = new LinkedHashMap<>();
        tc.put("id", id);
        for (String k : List.of("module", "screen", "scenario", "loginAs", "precondition", "steps", "expected")) tc.put(k, str(in, k));
        tc.put("priority", oneOf(str(in, "priority"), PRIORITIES, "Medium"));
        tc.put("specRef", str(in, "specRef"));
        tc.put("status", oneOf(str(in, "status"), TC_STATUSES, "Not run"));
        tc.put("bugIds", new ArrayList<>(list(in.get("bugIds"))));
        tc.put("testedBy", str(in, "testedBy"));
        tc.put("testedOn", str(in, "testedOn"));
        tc.put("remarks", str(in, "remarks"));
        return tc;
    }

    public synchronized Map<String, Object> updateTestCase(String id, Map<String, Object> in, String userId) {
        requireUser(userId);
        Map<String, Object> cur = testcases.get(id);
        if (cur == null) throw new ApiException(404, id + " not found.");
        checkFresh(cur, in);
        String status = str(in, "status");
        if (!TC_STATUSES.contains(status)) throw new ApiException(400, "Unknown status '" + status + "'.");
        if (in.containsKey("module")) requireModule(str(in, "module"));

        Map<String, Object> next = new LinkedHashMap<>(cur);
        for (String k : List.of("module", "screen", "scenario", "loginAs", "precondition", "steps", "expected", "specRef", "remarks")) {
            if (in.containsKey(k)) next.put(k, str(in, k));
        }
        if (in.containsKey("priority")) next.put("priority", oneOf(str(in, "priority"), PRIORITIES, str(cur, "priority")));
        if (!status.equals(cur.get("status")) || !str(in, "remarks").equals(str(cur, "remarks"))) {
            next.put("status", status);
            boolean run = !"Not run".equals(status);
            next.put("testedBy", run ? userId : "");
            next.put("testedOn", run ? LocalDate.now().toString() : "");
        }
        String action = str(in, "_action").isBlank() ? "Edited" : str(in, "_action");
        String now = now();
        next.put("updatedAt", now);
        next.put("updatedBy", userId);
        next.put("history", prepend(cur.get("history"), entry(now, userId, action)));
        save(tcPath(id), next, id + ": " + action + " (by " + userId + ")");
        testcases.put(id, next);
        return next;
    }

    // ================================================================== bugs
    public synchronized Map<String, Object> createBug(Map<String, Object> in, String userId) {
        requireUser(userId);
        String title = str(in, "title").trim();
        if (title.length() < 4) throw new ApiException(400, "Give the bug a title.");
        String assignee = str(in, "assignee");
        if (!assignee.isEmpty()) requireDeveloper(assignee);
        String module = requireModule(str(in, "module"));

        String id = nextBugId(Set.of());
        String now = now();
        Map<String, Object> bug = newBug(in, id, module, assignee, userId, now);
        Map<String, Object> first = entry(now, userId, "Reported");
        if (!assignee.isEmpty()) first.put("assignee", assignee);
        bug.put("history", new ArrayList<>(List.of(first)));
        syncIssue(bug, null);
        save(bugPath(id), bug, id + " reported by " + userId);
        bugs.put(id, bug);
        linkTestCase(str(bug, "testCaseId"), id, userId, now, true);
        return bug;
    }

    private static Map<String, Object> newBug(Map<String, Object> in, String id, String module, String assignee, String userId, String now) {
        Map<String, Object> bug = new LinkedHashMap<>();
        bug.put("id", id);
        bug.put("title", str(in, "title").trim());
        bug.put("module", module);
        bug.put("severity", oneOf(str(in, "severity"), SEVERITIES, "Medium"));
        bug.put("status", oneOf(str(in, "status"), BUG_STATUSES, "Open"));
        bug.put("assignee", assignee);
        bug.put("reporter", userId);
        bug.put("testCaseId", str(in, "testCaseId"));
        for (String k : List.of("steps", "expected", "actual", "notes")) bug.put(k, str(in, k));
        bug.put("createdAt", str(in, "createdAt").isEmpty() ? now : str(in, "createdAt"));
        bug.put("updatedAt", now);
        bug.put("updatedBy", userId);
        boolean closed = "Closed".equals(bug.get("status"));
        bug.put("closedAt", closed ? (str(in, "closedAt").isEmpty() ? now : str(in, "closedAt")) : "");
        bug.put("closedBy", closed ? userId : "");
        bug.put("githubIssue", null);
        return bug;
    }

    private Map<String, Object> linkTestCase(String tcId, String bugId, String userId, String now, boolean write) {
        Map<String, Object> tc = testcases.get(tcId);
        if (tc == null) return null;
        Set<Object> ids = new LinkedHashSet<>(list(tc.get("bugIds")));
        if (!ids.add(bugId)) return null;
        Map<String, Object> t2 = new LinkedHashMap<>(tc);
        t2.put("bugIds", new ArrayList<>(ids));
        t2.put("history", prepend(tc.get("history"), entry(now, userId, "Linked bug " + bugId)));
        if (write) save(tcPath(tcId), t2, tcId + ": linked " + bugId);
        testcases.put(tcId, t2);
        return t2;
    }

    public synchronized Map<String, Object> updateBug(String id, Map<String, Object> in, String userId) {
        Map<String, Object> user = requireUser(userId);
        Map<String, Object> cur = bugs.get(id);
        if (cur == null) throw new ApiException(404, id + " not found.");
        checkFresh(cur, in);

        String status = oneOf(str(in, "status"), BUG_STATUSES, str(cur, "status"));
        String assignee = in.containsKey("assignee") ? str(in, "assignee") : str(cur, "assignee");
        if (!assignee.isEmpty() && !assignee.equals(cur.get("assignee"))) requireDeveloper(assignee);
        if (in.containsKey("module")) requireModule(str(in, "module"));

        // Close guard: only the assigned developer (or a Lead) may close.
        if ("Closed".equals(status) && !"Closed".equals(cur.get("status"))) {
            boolean lead = "Lead".equals(user.get("role"));
            if (!lead && (assignee.isEmpty() || !assignee.equals(userId))) {
                Map<String, Object> dev = member(assignee);
                throw new ApiException(403, assignee.isEmpty()
                    ? "Assign a developer first. Only the assigned developer can close a bug."
                    : "Only " + (dev != null ? dev.get("name") : "the assigned developer") + " can close this bug.");
            }
        }

        Map<String, Object> next = new LinkedHashMap<>(cur);
        if (in.containsKey("title") && !str(in, "title").isBlank()) next.put("title", str(in, "title").trim());
        if (in.containsKey("module")) next.put("module", str(in, "module"));
        next.put("severity", oneOf(str(in, "severity"), SEVERITIES, str(cur, "severity")));
        for (String k : List.of("steps", "expected", "actual", "notes")) if (in.containsKey(k)) next.put(k, str(in, k));
        next.put("status", status);
        next.put("assignee", assignee);

        String now = now();
        List<String> changes = new ArrayList<>();
        Map<String, Object> h = entry(now, userId, "");
        h.put("assigneeAtTime", assignee);
        if (!status.equals(cur.get("status"))) { changes.add("Status: " + cur.get("status") + " → " + status); h.put("status", status); }
        if (!assignee.equals(cur.get("assignee"))) {
            Map<String, Object> dev = member(assignee);
            changes.add(assignee.isEmpty() ? "Unassigned" : "Assigned to " + (dev != null ? dev.get("name") : assignee));
            if (!assignee.isEmpty()) h.put("assignee", assignee);
        }
        if ("Closed".equals(status)) {
            if (str(cur, "closedAt").isEmpty()) { next.put("closedAt", now); next.put("closedBy", userId); }
        } else {
            next.put("closedAt", "");
            next.put("closedBy", "");
        }
        String action = changes.isEmpty() ? "Edited" : String.join(" · ", changes);
        h.put("action", action);
        next.put("updatedAt", now);
        next.put("updatedBy", userId);
        next.put("history", prepend(cur.get("history"), h));
        syncIssue(next, cur);
        save(bugPath(id), next, id + ": " + action + " (by " + userId + ")");
        bugs.put(id, next);
        return next;
    }

    // ================================================================== Excel import (one commit)
    public synchronized Map<String, Object> importData(Map<String, Object> in, String userId) {
        requireTester(userId);
        String now = now();
        Map<String, String> files = new LinkedHashMap<>();

        List<Map<String, Object>> mods = new ArrayList<>(modules);
        for (Object o : list(in.get("modules"))) {
            Map<?, ?> m = (Map<?, ?>) o;
            String code = String.valueOf(m.get("code")).trim();
            if (!code.matches("[A-Za-z][A-Za-z0-9]{1,11}")) throw new ApiException(400, "Module code '" + code + "' is not valid.");
            if (mods.stream().noneMatch(x -> code.equalsIgnoreCase(str(x, "code")))) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("code", code);
                c.put("name", m.get("name") == null ? code : String.valueOf(m.get("name")));
                mods.add(c);
            }
        }
        if (mods.size() != modules.size()) files.put("data/modules.json", Json.pretty(mods));
        List<Map<String, Object>> oldModules = modules;
        modules = mods; // so requireModule sees new ones

        Map<String, Map<String, Object>> tcOut = new LinkedHashMap<>();
        Map<String, Map<String, Object>> bugOut = new LinkedHashMap<>();
        try {
            for (Object o : list(in.get("testcases"))) {
                @SuppressWarnings("unchecked") Map<String, Object> t = (Map<String, Object>) o;
                String id = str(t, "id").toUpperCase(Locale.ROOT);
                if (!id.matches("TC-[A-Z0-9]+-\\d{3,}")) throw new ApiException(400, "Bad test case ID '" + id + "'.");
                requireModule(str(t, "module"));
                Map<String, Object> cur = testcases.get(id);
                Map<String, Object> rec;
                if (cur == null) {
                    rec = newTestCase(t, id);
                    rec.put("createdBy", userId);
                    rec.put("history", new ArrayList<>(List.of(entry(now, userId, "Imported from Excel"))));
                } else {
                    rec = new LinkedHashMap<>(cur);
                    Map<String, Object> fresh = newTestCase(t, id);
                    for (String k : List.of("module", "screen", "scenario", "loginAs", "precondition", "steps", "expected", "priority", "specRef", "status", "testedBy", "testedOn", "remarks")) rec.put(k, fresh.get(k));
                    Set<Object> ids = new LinkedHashSet<>(list(cur.get("bugIds")));
                    ids.addAll(list(t.get("bugIds")));
                    rec.put("bugIds", new ArrayList<>(ids));
                    rec.put("history", prepend(cur.get("history"), entry(now, userId, "Updated from Excel")));
                }
                rec.put("updatedAt", now);
                rec.put("updatedBy", userId);
                tcOut.put(id, rec);
            }
            Set<String> taken = new LinkedHashSet<>();
            for (Object o : list(in.get("bugs"))) {
                @SuppressWarnings("unchecked") Map<String, Object> b = (Map<String, Object>) o;
                String id = str(b, "id").toUpperCase(Locale.ROOT);
                if (!id.matches("BUG-\\d+")) id = nextBugId(taken);
                taken.add(id);
                String module = requireModule(str(b, "module"));
                String assignee = str(b, "assignee");
                if (!assignee.isEmpty()) requireDeveloper(assignee);
                Map<String, Object> cur = bugs.get(id);
                Map<String, Object> rec;
                if (cur == null) {
                    rec = newBug(b, id, module, assignee, userId, now);
                    Map<String, Object> h = entry(now, userId, "Imported from Excel");
                    if (!assignee.isEmpty()) h.put("assignee", assignee);
                    rec.put("history", new ArrayList<>(List.of(h)));
                    syncIssue(rec, null);
                } else {
                    rec = new LinkedHashMap<>(cur);
                    for (String k : List.of("title", "steps", "expected", "actual", "notes", "testCaseId")) rec.put(k, str(b, k));
                    rec.put("module", module);
                    rec.put("severity", oneOf(str(b, "severity"), SEVERITIES, str(cur, "severity")));
                    rec.put("status", oneOf(str(b, "status"), BUG_STATUSES, str(cur, "status")));
                    rec.put("assignee", assignee);
                    Map<String, Object> h = entry(now, userId, "Updated from Excel");
                    if (!assignee.isEmpty() && !assignee.equals(cur.get("assignee"))) h.put("assignee", assignee);
                    rec.put("history", prepend(cur.get("history"), h));
                    rec.put("updatedAt", now);
                    syncIssue(rec, cur);
                }
                rec.put("updatedBy", userId);
                bugOut.put(id, rec);
            }
        } catch (ApiException e) {
            modules = oldModules;
            throw e;
        }

        // links test case <-> bug
        for (Map<String, Object> b : bugOut.values()) {
            String tcId = str(b, "testCaseId");
            Map<String, Object> tc = tcOut.containsKey(tcId) ? tcOut.get(tcId) : testcases.get(tcId);
            if (tc == null) { b.put("testCaseId", ""); continue; }
            Set<Object> ids = new LinkedHashSet<>(list(tc.get("bugIds")));
            if (ids.add(b.get("id"))) {
                Map<String, Object> t2 = new LinkedHashMap<>(tc);
                t2.put("bugIds", new ArrayList<>(ids));
                tcOut.put(tcId, t2);
            }
        }
        for (Map.Entry<String, Map<String, Object>> e : tcOut.entrySet()) files.put(tcPath(e.getKey()), Json.pretty(e.getValue()));
        for (Map.Entry<String, Map<String, Object>> e : bugOut.entrySet()) files.put(bugPath(e.getKey()), Json.pretty(e.getValue()));
        try {
            store.writeMany(files, "tracker: Excel import by " + userId + " (" + tcOut.size() + " test cases, " + bugOut.size() + " bugs)");
        } catch (Store.ConflictException e) {
            modules = oldModules;
            throw new ApiException(409, e.getMessage());
        } catch (RuntimeException e) {
            modules = oldModules;
            throw e;
        }
        testcases.putAll(tcOut);
        bugs.putAll(bugOut);
        return all();
    }

    // ================================================================== team
    public synchronized List<Object> saveTeam(List<Object> in, String userId) {
        Map<String, Object> user = requireUser(userId);
        if (!"Lead".equals(user.get("role"))) throw new ApiException(403, "Only a Lead can change the team.");
        boolean hasLead = false;
        Set<String> ids = new LinkedHashSet<>();
        List<Map<String, Object>> clean = new ArrayList<>();
        for (Object o : in) {
            Map<?, ?> m = (Map<?, ?>) o;
            String id = String.valueOf(m.get("id")).trim().toLowerCase(Locale.ROOT);
            if (!id.matches("[a-z0-9._-]{3,30}")) throw new ApiException(400, "Username '" + id + "' must be 3-30 letters, numbers, dot, dash or underscore.");
            if (!ids.add(id)) throw new ApiException(400, "Username " + id + " is used twice.");
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", id);
            c.put("name", String.valueOf(m.get("name")).trim());
            c.put("email", m.get("email") == null ? "" : String.valueOf(m.get("email")).trim());
            c.put("role", oneOf(String.valueOf(m.get("role")), ROLES, "QA"));
            c.put("github", m.get("github") == null ? "" : String.valueOf(m.get("github")).replace("@", "").trim());
            if (((String) c.get("name")).isEmpty()) throw new ApiException(400, "Every member needs a name.");
            String newPw = m.get("newPassword") == null ? "" : String.valueOf(m.get("newPassword"));
            Map<String, Object> old = member(id);
            if (!newPw.isEmpty()) {
                if (newPw.length() < 8) throw new ApiException(400, "Passwords need at least 8 characters.");
                c.put("passwordHash", Auth.hash(newPw));
            } else if (old != null && !str(old, "passwordHash").isEmpty()) {
                c.put("passwordHash", old.get("passwordHash"));
            } else {
                c.put("passwordHash", Auth.hash(defaultPassword)); // new member: default password
            }
            hasLead |= "Lead".equals(c.get("role"));
            clean.add(c);
        }
        if (!hasLead) throw new ApiException(400, "The team needs at least one Lead.");
        if (!ids.contains(userId)) throw new ApiException(400, "You can't remove yourself.");
        save("data/team.json", clean, "Team updated by " + userId);
        team = clean;
        return publicTeam();
    }

    // ================================================================== GitHub issues
    private void syncIssue(Map<String, Object> bug, Map<String, Object> before) {
        if (!issues) return;
        Store.GitHub gh = (Store.GitHub) store;
        String login = githubLogin(str(bug, "assignee"));
        List<String> assignees = login.isEmpty() ? List.of() : List.of(login);
        Object existing = bug.get("githubIssue");
        try {
            if (existing == null) {
                if (login.isEmpty()) return; // unassigned: no issue, nobody notified
                String body = "**" + bug.get("id") + "** · " + bug.get("module") + " · " + bug.get("severity")
                    + "\n\n### Steps\n" + str(bug, "steps") + "\n\n### Expected\n" + str(bug, "expected")
                    + "\n\n### Actual\n" + str(bug, "actual") + "\n\n_Created by MagtechOne Tracker. Only the assignee may close this issue._";
                bug.put("githubIssue", gh.createIssue("[" + bug.get("id") + "] " + bug.get("title"), body, assignees,
                    List.of("bug", str(bug, "module"), "severity:" + str(bug, "severity"))));
            } else {
                long number = ((Number) ((Map<?, ?>) existing).get("number")).longValue();
                boolean changed = before == null || !str(before, "assignee").equals(str(bug, "assignee"))
                    || !str(before, "status").equals(str(bug, "status")) || !str(before, "title").equals(str(bug, "title"));
                if (changed) gh.updateIssue(number, "Closed".equals(bug.get("status")) ? "closed" : "open", assignees, "[" + bug.get("id") + "] " + bug.get("title"));
            }
        } catch (RuntimeException e) {
            LOG.warning("GitHub issue sync failed for " + bug.get("id") + ": " + e.getMessage());
        }
    }

    private String githubLogin(String memberId) {
        Map<String, Object> m = member(memberId);
        return m == null ? "" : str(m, "github");
    }

    // ================================================================== helpers
    private void save(String path, Object value, String message) {
        try {
            store.write(path, Json.pretty(value), "tracker: " + message);
        } catch (Store.ConflictException e) {
            throw new ApiException(409, e.getMessage());
        }
    }

    private static String tcPath(String id) { return "data/testcases/" + id + ".json"; }
    private static String bugPath(String id) { return "data/bugs/" + id + ".json"; }

    private void checkFresh(Map<String, Object> cur, Map<String, Object> in) {
        String sent = str(in, "updatedAt");
        if (!sent.isEmpty() && !sent.equals(cur.get("updatedAt"))) {
            Map<String, Object> who = member(str(cur, "updatedBy"));
            throw new ApiException(409, cur.get("id") + " was changed by " + (who != null ? who.get("name") : cur.get("updatedBy"))
                + " meanwhile. Your view has been refreshed; please redo your change.");
        }
    }

    private void requireDeveloper(String id) {
        Map<String, Object> m = member(id);
        if (m == null || !"Developer".equals(m.get("role"))) throw new ApiException(400, "Bugs can only be assigned to a Developer.");
    }

    private String nextBugId(Set<String> alsoTaken) {
        int max = 0;
        for (String k : bugs.keySet()) max = Math.max(max, num(k));
        for (String k : alsoTaken) max = Math.max(max, num(k));
        return String.format("BUG-%03d", max + 1);
    }

    private static int num(String id) {
        String d = id.replaceAll("\\D", "");
        return d.isEmpty() ? 0 : Integer.parseInt(d);
    }

    private static Map<String, Object> entry(String at, String by, String action) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("at", at);
        e.put("by", by);
        e.put("action", action);
        return e;
    }

    private static List<Object> prepend(Object history, Map<String, Object> e) {
        List<Object> l = new ArrayList<>();
        l.add(e);
        l.addAll(list(history));
        return l.size() > HISTORY_MAX ? new ArrayList<>(l.subList(0, HISTORY_MAX)) : l;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>) o : new ArrayList<>();
    }

    static String str(Map<?, ?> m, String k) {
        Object v = m.get(k);
        return v == null ? "" : String.valueOf(v);
    }

    private static String oneOf(String v, List<String> allowed, String fallback) {
        return allowed.contains(v) ? v : fallback;
    }

    private static String now() { return Instant.now().truncatedTo(ChronoUnit.SECONDS).toString(); }
}
