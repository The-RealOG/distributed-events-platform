import { SignJWT, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { AuthenticationError, type AuthProvider, type Principal } from './types.js';

export interface LocalJwtOptions {
  /** HMAC secret; at least 32 bytes so HS256 is not brute-forceable. */
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

const ALGORITHM = 'HS256';

const claimsSchema = z.object({
  sub: z.uuid(),
  email: z.email(),
});

export class LocalJwtAuthProvider implements AuthProvider {
  readonly #key: Uint8Array;

  constructor(private readonly options: LocalJwtOptions) {
    if (Buffer.byteLength(options.secret) < 32) {
      throw new Error('JWT secret must be at least 32 bytes');
    }
    this.#key = new TextEncoder().encode(options.secret);
  }

  async issue(principal: Principal): Promise<string> {
    return new SignJWT({ email: principal.email })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(principal.userId)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.options.ttlSeconds}s`)
      .sign(this.#key);
  }

  async authenticate(token: string): Promise<Principal> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.#key, {
        // Pinning the algorithm rejects `alg: none` and algorithm-confusion tokens.
        algorithms: [ALGORITHM],
        issuer: this.options.issuer,
        audience: this.options.audience,
        requiredClaims: ['exp', 'iat', 'sub'],
      }));
    } catch (err) {
      throw new AuthenticationError(err instanceof errors.JWTExpired ? 'expired' : 'invalid');
    }

    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) throw new AuthenticationError('invalid');
    return { userId: claims.data.sub, email: claims.data.email };
  }
}
