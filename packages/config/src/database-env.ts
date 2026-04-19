/**
 * Database connection settings arrive in one of two shapes:
 *
 * - `DATABASE_URL` (local development, Docker Compose, tests)
 * - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (AWS: ECS injects the user and
 *   password from Secrets Manager as separate values, and the password may contain URL-special
 *   characters)
 *
 * This normalizes the second shape into the first so every service keeps a single
 * `DATABASE_URL` setting. An explicit DATABASE_URL always wins.
 */
export function withDatabaseUrl(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (env['DATABASE_URL']) return env;
  const {
    DB_HOST: host,
    DB_PORT: port = '5432',
    DB_NAME: name,
    DB_USER: user,
    DB_PASSWORD: password,
  } = env;
  if (!host || !name || !user || !password) return env;
  const url = new URL(`postgres://${host}:${port}/`);
  url.pathname = `/${encodeURIComponent(name)}`;
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return { ...env, DATABASE_URL: url.toString() };
}
