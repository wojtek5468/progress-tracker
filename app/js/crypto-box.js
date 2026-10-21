// End-to-end encryption for sync and phone transfer. Data is compressed and sealed with
// AES-GCM on the phone; the server only ever stores the sealed bytes. No DOM, so it runs in Node.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64u(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Long passphrases are what keeps the data safe; PBKDF2 slows down guessing.
const ITERATIONS = 310000;
const SALT = enc.encode('progress-tracker/sync/v1');

// From one passphrase: the box id (where the server keeps it), a write token (proves to the
// server that you may overwrite it) and the AES key (never leaves the phone; `keyText` is kept
// on the phone so the passphrase itself is not stored).
export async function keysFromPassphrase(passphrase) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: ITERATIONS }, base, 768));
  return {
    id: b64u(bits.slice(0, 32)),
    token: b64u(bits.slice(32, 64)),
    keyText: b64u(bits.slice(64, 96)),
    key: await importKeyText(b64u(bits.slice(64, 96))),
  };
}

// A random key for a one-time transfer, as text that fits in a QR code.
export async function randomKey() {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return { text: b64u(raw), key: await importKeyText(b64u(raw)) };
}
export const importKeyText = (text) => crypto.subtle.importKey('raw', unb64u(text), 'AES-GCM', false, ['encrypt', 'decrypt']);

// value → gzip → AES-GCM; result: 12-byte nonce followed by the ciphertext.
export async function seal(value, key) {
  const packed = await pipe(enc.encode(JSON.stringify(value)), new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function open(bytes, key) {
  const data = new Uint8Array(bytes);
  let packed;
  try {
    packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
  } catch {
    throw new Error('Nie da się odszyfrować: inne hasło albo uszkodzone dane.');
  }
  return JSON.parse(dec.decode(await pipe(new Uint8Array(packed), new DecompressionStream('gzip'))));
}
