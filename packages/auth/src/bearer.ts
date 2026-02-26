/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
