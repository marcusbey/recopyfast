import { createHash } from "node:crypto";

/**
 * The 24 h cache key of a scan: SHA-256 hex of `<tool>\n<normalised href>`.
 *
 * Tool-scoped, because two tools reading one page produce different reports.
 * Hashed, so the column has one fixed shape the DB CHECK can pin
 * (`^[0-9a-f]{64}$`) whatever the URL length. The href is the output of
 * `normalizeScanUrl`, so the query string — never stored — is never part of it.
 */
export function scanCacheKey(tool: string, href: string): string {
  return createHash("sha256").update(`${tool}\n${href}`, "utf8").digest("hex");
}
