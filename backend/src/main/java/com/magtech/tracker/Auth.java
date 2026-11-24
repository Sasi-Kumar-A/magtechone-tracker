package com.magtech.tracker;

import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Password hashing (PBKDF2) and signed session tokens (HMAC-SHA256). No dependencies. */
public final class Auth {
    private static final int ITERATIONS = 210_000;
    private static final long TOKEN_DAYS = 7;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final byte[] secret;
    private final Map<String, long[]> failures = new ConcurrentHashMap<>(); // login -> [count, firstAtMillis]

    public Auth(String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    // ---------------------------------------------------------------- passwords
    public static String hash(String password) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return "pbkdf2$" + ITERATIONS + "$" + B64.encodeToString(salt) + "$" + B64.encodeToString(pbkdf2(password, salt, ITERATIONS));
    }

    public static boolean verify(String password, String stored) {
        if (stored == null || !stored.startsWith("pbkdf2$")) return false;
        String[] p = stored.split("\\$");
        if (p.length != 4) return false;
        byte[] expected = B64D.decode(p[3]);
        byte[] actual = pbkdf2(password, B64D.decode(p[2]), Integer.parseInt(p[1]));
        return MessageDigest.isEqual(expected, actual);
    }

    private static byte[] pbkdf2(String password, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------- tokens
    public String issue(String userId) {
        long exp = Instant.now().plusSeconds(TOKEN_DAYS * 86400).getEpochSecond();
        String payload = B64.encodeToString((userId + "|" + exp).getBytes(StandardCharsets.UTF_8));
        return payload + "." + B64.encodeToString(sign(payload));
    }

    /** @return the user id, or null if the token is missing, forged or expired. */
    public String check(String token) {
        if (token == null) return null;
        int dot = token.indexOf('.');
        if (dot < 0) return null;
        String payload = token.substring(0, dot);
        byte[] sig;
        try { sig = B64D.decode(token.substring(dot + 1)); } catch (IllegalArgumentException e) { return null; }
        if (!MessageDigest.isEqual(sig, sign(payload))) return null;
        String[] parts;
        try { parts = new String(B64D.decode(payload), StandardCharsets.UTF_8).split("\\|"); } catch (IllegalArgumentException e) { return null; }
        if (parts.length != 2 || Long.parseLong(parts[1]) < Instant.now().getEpochSecond()) return null;
        return parts[0];
    }

    private byte[] sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------- brute-force brake
    /** Max 10 wrong passwords per login name per 15 minutes. */
    public boolean blocked(String login) {
        long[] f = failures.get(login);
        if (f == null) return false;
        if (System.currentTimeMillis() - f[1] > 15 * 60_000) { failures.remove(login); return false; }
        return f[0] >= 10;
    }

    public void failed(String login) {
        failures.compute(login, (k, f) -> {
            long now = System.currentTimeMillis();
            if (f == null || now - f[1] > 15 * 60_000) return new long[] {1, now};
            f[0]++;
            return f;
        });
    }

    public void succeeded(String login) { failures.remove(login); }

    public static String randomSecret() {
        byte[] b = new byte[32];
        RANDOM.nextBytes(b);
        return B64.encodeToString(b);
    }
}
