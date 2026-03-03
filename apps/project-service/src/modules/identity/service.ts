import type { Principal } from '@dpp/auth';
import type { Database } from '@dpp/database';
import { notFound } from '../../http/errors.js';
import type { UserDto } from '../../http/schemas.js';
import { findUserById, upsertUserByEmail, type UserRow } from './repository.js';

export interface TokenIssuer {
  issue(principal: Principal): Promise<string>;
}

export const toUserDto = (row: UserRow): UserDto => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
});

export class IdentityService {
  constructor(private readonly db: Database) {}

  /** Development-only: trusts the supplied email. Never enabled outside local environments. */
  async devLogin(issuer: TokenIssuer, email: string, displayName: string) {
    const user = await upsertUserByEmail(this.db, email.toLowerCase(), displayName);
    const token = await issuer.issue({ userId: user.id, email: user.email });
    return { token, user: toUserDto(user) };
  }

  async me(principal: Principal): Promise<UserDto> {
    const user = await findUserById(this.db, principal.userId);
    if (!user) throw notFound('User');
    return toUserDto(user);
  }
}
