import * as crypto from 'crypto';

/**
 * Codes from an authenticator app (§298): the six digits Google
 * Authenticator, Microsoft Authenticator, 1Password and the rest show, which
 * change every 30 seconds — RFC 6238 (TOTP) over RFC 4226 (HOTP), SHA-1, the
 * settings every app reads from an `otpauth://` link. Written here rather than
 * taken from a library: it is twenty lines of the standard, and a library for
 * it is one more thing that could change under the sign-in.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base 32. */
export function newTotpSecret(): string {
  return toBase32(crypto.randomBytes(20));
}

/** The code for one 30-second step. */
export function totpAt(secret: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', fromBase32(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(value).padStart(DIGITS, '0');
}

/**
 * Whether a typed code is right now, or one step either side — a phone's
 * clock a little off, or the code changing while it was typed. Compared in
 * constant time. Returns the step it matched, so a code cannot be used twice.
 */
export function checkTotp(secret: string, code: string, nowSeconds = Date.now() / 1000): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  for (const drift of [0, -1, 1]) {
    const at = nowSeconds + drift * STEP_SECONDS;
    const expected = totpAt(secret, at);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return Math.floor(at / STEP_SECONDS);
  }
  return null;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer = 'BwanguReservations'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * The secret, sealed before it is stored (AES-256-GCM): a copy of the
 * database alone is not enough to make someone's codes. The key is derived
 * from the access-token key, so there is nothing new to configure.
 */
export function sealSecret(secret: string, keyMaterial: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(keyMaterial), iv);
  const sealed = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), sealed.toString('base64url')].join(
    '.',
  );
}

export function openSecret(stored: string, keyMaterial: string): string {
  const [version, iv, tag, sealed] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !sealed) throw new Error('Unreadable authenticator secret.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(keyMaterial), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64url')), decipher.final()]).toString('utf8');
}

const sealKey = (keyMaterial: string) =>
  crypto.createHmac('sha256', keyMaterial).update('authenticator-secret').digest();

/** Ten one-time codes for when the phone is lost: "xxxx-xxxx", easy to read out and type. */
export function newRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

/** Stored as a digest only; typed with or without the dash, any case. */
export const recoveryDigest = (code: string) =>
  crypto
    .createHash('sha256')
    .update(code.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .digest('hex');

function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
