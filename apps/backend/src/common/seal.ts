import * as crypto from 'crypto';

/**
 * Sealing a small secret before it is stored (AES-256-GCM): an authenticator
 * secret (§298), a customer's health-related answers (§300.6). A copy of the
 * database alone is not enough to read either.
 *
 * Each use has its own `purpose`, and the key is derived from the key
 * material and that word together — so one thing sealed can never be opened
 * as another. The key material is the access-token key, so there is nothing
 * new to configure; changing that key makes everything sealed unreadable,
 * which every reader must survive.
 *
 * Stored as `v1.<iv>.<tag>.<sealed>`, base64url. The tag means a changed
 * byte is refused rather than read as something else.
 */
export function seal(text: string, keyMaterial: string, purpose: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(keyMaterial, purpose), iv);
  const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), sealed.toString('base64url')].join(
    '.',
  );
}

/** Throws when it cannot be read — a different key, a different purpose, a changed byte. */
export function unseal(stored: string, keyMaterial: string, purpose: string): string {
  const [version, iv, tag, sealed] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !sealed) throw new Error('Unreadable sealed value.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(keyMaterial, purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64url')), decipher.final()]).toString('utf8');
}

const keyFor = (keyMaterial: string, purpose: string) =>
  crypto.createHmac('sha256', keyMaterial).update(purpose).digest();
