/** The identity established by authentication. Authorization is decided elsewhere. */
export interface Principal {
  userId: string;
  email: string;
}

/**
 * Verifies a bearer credential. The local JWT implementation is used in development;
 * a Cognito/OIDC implementation can replace it without touching callers.
 */
export interface AuthProvider {
  authenticate(token: string): Promise<Principal>;
}

export type AuthFailureReason = 'expired' | 'invalid';

export class AuthenticationError extends Error {
  constructor(public readonly reason: AuthFailureReason) {
    super(reason === 'expired' ? 'Token expired' : 'Invalid token');
    this.name = 'AuthenticationError';
  }
}
