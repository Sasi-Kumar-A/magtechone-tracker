// Password hashing in the browser, same format as the Java backend (Auth.java):
//   pbkdf2$<iterations>$<salt base64url>$<hash base64url>   (PBKDF2-HMAC-SHA256, 256-bit)
// plus a small "vault" that keeps a person's GitHub token on their device, encrypted with
// their tracker password (AES-GCM), so day to day they only type username + password.

const ITERATIONS = 210000;
const enc = new TextEncoder();
const c = () => globalThis.crypto.subtle;

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function pbkdf2Bits(password, salt, iterations) {
  const key = await c().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return c().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = rand(16);
  return `pbkdf2$${ITERATIONS}$${b64u(salt)}$${b64u(await pbkdf2Bits(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2Bits(password, unb64u(p[2]), parseInt(p[1], 10)));
  const want = unb64u(p[3]);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

async function vaultKey(password, salt) {
  const base = await c().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return c().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealToken(token, password) {
  const salt = rand(16);
  const iv = rand(12);
  const ct = await c().encrypt({ name: 'AES-GCM', iv }, await vaultKey(password, salt), enc.encode(token));
  return { salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) };
}

/** Returns the token, or null if the password does not open the vault. */
export async function openToken(vault, password) {
  try {
    const key = await vaultKey(password, unb64u(vault.salt));
    const pt = await c().decrypt({ name: 'AES-GCM', iv: unb64u(vault.iv) }, key, unb64u(vault.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
