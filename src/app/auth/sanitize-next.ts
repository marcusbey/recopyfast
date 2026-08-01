/**
 * Validate the `next` redirect target so it can only be a same-origin
 * relative path.  Rules:
 *   - Must start with a single '/'
 *   - Must NOT start with '//' (protocol-relative URL — cross-origin)
 *   - Must NOT start with '/\' (IE-era cross-origin bypass)
 * Anything else falls back to '/dashboard'.
 *
 * Shared by every route that accepts a post-auth destination from the query
 * string, so the open-redirect guard cannot drift between them.
 */
export function sanitizeNext(value: string | null): string {
  const fallback = "/dashboard";
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  return value;
}
