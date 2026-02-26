import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AuthenticationError, LocalJwtAuthProvider, parseBearerToken } from './index.js';

const options = {
  secret: 'a'.repeat(32),
  issuer: 'dpp-local',
  audience: 'dpp-api',
  ttlSeconds: 60,
};
const principal = { userId: '6f1c1f0e-2a53-4d7e-9a7b-0f4b1a1d2c3e', email: 'ada@example.com' };
const provider = new LocalJwtAuthProvider(options);
const key = new TextEncoder().encode(options.secret);

async function expectRejected(token: string, reason: 'expired' | 'invalid') {
  const err = await provider.authenticate(token).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AuthenticationError);
  expect((err as AuthenticationError).reason).toBe(reason);
}

function baseToken(claims: Record<string, unknown> = { email: principal.email }) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.userId)
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt();
}

describe('LocalJwtAuthProvider', () => {
  it('round-trips an issued token', async () => {
    const token = await provider.issue(principal);
    await expect(provider.authenticate(token)).resolves.toEqual(principal);
  });

  it('rejects short secrets at construction', () => {
    expect(() => new LocalJwtAuthProvider({ ...options, secret: 'short' })).toThrow();
  });

  it('rejects expired tokens with reason "expired"', async () => {
    const token = await baseToken()
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    await expectRejected(token, 'expired');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await baseToken()
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode('b'.repeat(32)));
    await expectRejected(token, 'invalid');
  });

  it('rejects wrong issuer and wrong audience', async () => {
    await expectRejected(
      await baseToken().setIssuer('someone-else').setExpirationTime('1m').sign(key),
      'invalid',
    );
    await expectRejected(
      await baseToken().setAudience('other-api').setExpirationTime('1m').sign(key),
      'invalid',
    );
  });

  it('rejects unsigned (alg: none) tokens', async () => {
    const token = new UnsecuredJWT({ email: principal.email })
      .setSubject(principal.userId)
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setIssuedAt()
      .setExpirationTime('1m')
      .encode();
    await expectRejected(token, 'invalid');
  });

  it('rejects tokens without an expiry', async () => {
    await expectRejected(await baseToken().sign(key), 'invalid');
  });

  it('rejects tokens whose claims have the wrong shape', async () => {
    await expectRejected(await baseToken({}).setExpirationTime('1m').sign(key), 'invalid');
    await expectRejected(
      await baseToken().setSubject('not-a-uuid').setExpirationTime('1m').sign(key),
      'invalid',
    );
  });

  it('rejects garbage', async () => {
    await expectRejected('not.a.jwt', 'invalid');
  });
});

describe('parseBearerToken', () => {
  it('extracts bearer tokens and ignores other schemes', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(parseBearerToken('bearer  abc')).toBe('abc');
    expect(parseBearerToken('Basic abc')).toBeUndefined();
    expect(parseBearerToken('Bearer')).toBeUndefined();
    expect(parseBearerToken(undefined)).toBeUndefined();
  });
});
