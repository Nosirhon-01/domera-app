import { generateOtpCode, generateVerificationToken, hashOtpCode, hashToken, hexEqual } from './otp-crypto';

describe('otp-crypto', () => {
  it('generates 6-digit codes, including leading zeros, that are not predictable', () => {
    const codes = Array.from({ length: 2000 }, generateOtpCode);
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1980); // ~1 collision expected in 2000 draws of 10^6
    // Every first digit appears (uniform over 000000-999999, zeros are padded)
    expect(new Set(codes.map((c) => c[0])).size).toBe(10);
  });

  it('hash is deterministic, depends on secret, phone and code, and never contains the code', () => {
    const h = hashOtpCode('s', '+998901234567', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(hashOtpCode('s', '+998901234567', '123456')).toBe(h);
    expect(hashOtpCode('other', '+998901234567', '123456')).not.toBe(h);
    expect(hashOtpCode('s', '+998901234568', '123456')).not.toBe(h);
    expect(hashOtpCode('s', '+998901234567', '123457')).not.toBe(h);
  });

  it('verification: right code matches, wrong code and malformed hashes do not', () => {
    const stored = hashOtpCode('s', '+998901234567', '123456');
    expect(hexEqual(stored, hashOtpCode('s', '+998901234567', '123456'))).toBe(true);
    expect(hexEqual(stored, hashOtpCode('s', '+998901234567', '654321'))).toBe(false);
    expect(hexEqual(stored, '')).toBe(false);
    expect(hexEqual('', '')).toBe(false);
    expect(hexEqual(stored, stored.slice(0, 32))).toBe(false);
  });

  it('verification tokens are 256-bit, URL-safe, unique; only their SHA-256 is stored', () => {
    const t = generateVerificationToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateVerificationToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });
});
