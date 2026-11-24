package com.magtech.tracker;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small dependency-free JSON reader/writer (objects keep key order). */
public final class Json {
    private Json() {}

    // ------------------------------------------------------------------ parse
    public static Object parse(String s) {
        Parser p = new Parser(s);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i != s.length()) throw new IllegalArgumentException("Unexpected text at " + p.i);
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String s) {
        Object o = parse(s);
        if (!(o instanceof Map)) throw new IllegalArgumentException("Expected a JSON object");
        return (Map<String, Object>) o;
    }

    private static final class Parser {
        final String s;
        int i;
        Parser(String s) { this.s = s; }

        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        Object value() {
            if (i >= s.length()) throw err("Unexpected end");
            char c = s.charAt(i);
            switch (c) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case 't': expect("true"); return Boolean.TRUE;
                case 'f': expect("false"); return Boolean.FALSE;
                case 'n': expect("null"); return null;
                default: return number();
            }
        }

        Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            i++; ws();
            if (peek('}')) { i++; return m; }
            while (true) {
                ws();
                String k = string();
                ws(); want(':'); ws();
                m.put(k, value());
                ws();
                if (peek(',')) { i++; continue; }
                want('}');
                return m;
            }
        }

        List<Object> array() {
            List<Object> l = new ArrayList<>();
            i++; ws();
            if (peek(']')) { i++; return l; }
            while (true) {
                ws(); l.add(value()); ws();
                if (peek(',')) { i++; continue; }
                want(']');
                return l;
            }
        }

        String string() {
            want('"');
            StringBuilder b = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw err("Unterminated string");
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c != '\\') { b.append(c); continue; }
                char e = s.charAt(i++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'n': b.append('\n'); break;
                    case 'r': b.append('\r'); break;
                    case 't': b.append('\t'); break;
                    case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                    default: throw err("Bad escape");
                }
            }
        }

        Number number() {
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String n = s.substring(st, i);
            if (n.isEmpty()) throw err("Unexpected character");
            if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
            return Long.parseLong(n);
        }

        boolean peek(char c) { return i < s.length() && s.charAt(i) == c; }
        void want(char c) { if (!peek(c)) throw err("Expected '" + c + "'"); i++; }
        void expect(String w) { if (!s.startsWith(w, i)) throw err("Expected " + w); i += w.length(); }
        IllegalArgumentException err(String m) { return new IllegalArgumentException(m + " at " + i); }
    }

    // ------------------------------------------------------------------ write
    public static String write(Object v) { StringBuilder b = new StringBuilder(); write(b, v, -1, 0); return b.toString(); }

    /** Pretty JSON with 2-space indent: readable diffs in the repo. */
    public static String pretty(Object v) { StringBuilder b = new StringBuilder(); write(b, v, 2, 0); return b.append('\n').toString(); }

    private static void write(StringBuilder b, Object v, int ind, int depth) {
        if (v == null) b.append("null");
        else if (v instanceof String) str(b, (String) v);
        else if (v instanceof Number || v instanceof Boolean) b.append(v);
        else if (v instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) v;
            if (m.isEmpty()) { b.append("{}"); return; }
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) b.append(',');
                first = false;
                nl(b, ind, depth + 1);
                str(b, String.valueOf(e.getKey()));
                b.append(ind >= 0 ? ": " : ":");
                write(b, e.getValue(), ind, depth + 1);
            }
            nl(b, ind, depth);
            b.append('}');
        } else if (v instanceof List) {
            List<?> l = (List<?>) v;
            if (l.isEmpty()) { b.append("[]"); return; }
            b.append('[');
            for (int k = 0; k < l.size(); k++) {
                if (k > 0) b.append(',');
                nl(b, ind, depth + 1);
                write(b, l.get(k), ind, depth + 1);
            }
            nl(b, ind, depth);
            b.append(']');
        } else str(b, v.toString());
    }

    private static void nl(StringBuilder b, int ind, int depth) {
        if (ind < 0) return;
        b.append('\n');
        for (int k = 0; k < ind * depth; k++) b.append(' ');
    }

    private static void str(StringBuilder b, String s) {
        b.append('"');
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        b.append('"');
    }
}
