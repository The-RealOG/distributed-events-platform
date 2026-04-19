import { readFileSync } from 'node:fs';

/**
 * Reads the CA bundle named by DATABASE_TLS_CA_FILE, if set. Deployed images ship the RDS
 * trust bundle at /app/certs/rds-global-bundle.pem; local development sets nothing (no TLS).
 */
export function databaseTlsCaFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const file = env['DATABASE_TLS_CA_FILE'];
  return file ? readFileSync(file, 'utf8') : undefined;
}
