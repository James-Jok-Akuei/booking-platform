import {
  checkTotp,
  newRecoveryCodes,
  newTotpSecret,
  openSecret,
  otpauthUrl,
  recoveryDigest,
  sealSecret,
  totpAt,
} from '../src/auth/totp';

/** Authenticator-app codes (§298), against the standard's own examples. */
describe('Authenticator codes (§298)', () => {
  // RFC 6238, appendix B: the ASCII secret "12345678901234567890", SHA-1, in base 32.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('makes the codes the standard says, at the times it gives', () => {
    // The RFC's eight digits, of which apps show the last six.
    expect(totpAt(RFC_SECRET, 59)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1234567890)).toBe('005924');
    expect(totpAt(RFC_SECRET, 2000000000)).toBe('279037');
  });

  it('takes the code a step either side, and nothing further', () => {
    const now = 1_800_000_000;
    expect(checkTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now)).not.toBeNull();
    expect(checkTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30), now)).not.toBeNull();
    expect(checkTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30), now)).not.toBeNull();
    expect(checkTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90), now)).toBeNull();
    expect(checkTotp(RFC_SECRET, 'abc123', now)).toBeNull();
    expect(checkTotp(RFC_SECRET, '12345', now)).toBeNull();
  });

  it('makes a fresh secret each time, that its own codes match', () => {
    const a = newTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(newTotpSecret()).not.toBe(a);
    expect(checkTotp(a, totpAt(a, Date.now() / 1000))).not.toBeNull();
  });

  it('seals the secret so the stored text is not it, and opens it again', () => {
    const sealed = sealSecret(RFC_SECRET, 'key-material');
    expect(sealed).not.toContain(RFC_SECRET);
    expect(openSecret(sealed, 'key-material')).toBe(RFC_SECRET);
    expect(() => openSecret(sealed, 'another-key')).toThrow();
  });

  it('writes the link authenticator apps read', () => {
    const url = otpauthUrl(RFC_SECRET, 'admin@example.com');
    expect(url.startsWith('otpauth://totp/BwanguReservations%3Aadmin%40example.com?')).toBe(true);
    expect(url).toContain(`secret=${RFC_SECRET}`);
    expect(url).toContain('issuer=BwanguReservations');
  });

  it('gives ten different recovery codes, matched however they are typed', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(recoveryDigest(codes[0].toUpperCase().replace('-', ' '))).toBe(recoveryDigest(codes[0]));
  });
});
