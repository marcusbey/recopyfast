/**
 * Object naming for the public `assets` bucket.
 *
 * The bucket name matches what GET /api/health already probes
 * (src/app/api/health/route.ts → supabase.storage.getBucket("assets")), so
 * creating it clears the standing "Bucket not found" storage check.
 */

import crypto from "crypto";

export const ASSETS_BUCKET = "assets";

/**
 * Bytes of randomness in an object name. 16 bytes = 128 bits, which makes the
 * key unguessable: enumerating a site's images by brute force is not feasible
 * even though the bucket is world-readable.
 */
const KEY_RANDOM_BYTES = 16;

/**
 * Build a storage key for a site's image.
 *
 * Shape: `sites/<siteId>/<yyyy>/<mm>/<random>.<ext>`
 *
 * Two properties matter here:
 *
 *  1. The user's filename never appears. Reflecting it would import every
 *     filename attack into the storage key — `../../` traversal out of the site
 *     prefix, NUL bytes, RTL-override characters that disguise the extension,
 *     and unicode that normalises into a different path on some backends.
 *     A random name sidesteps the entire class instead of trying to filter it.
 *
 *  2. Objects are namespaced under `sites/<siteId>/`. `siteId` is a UUID that
 *     has already been format-validated *and* proven to belong to the caller by
 *     the endpoint's token check, so it cannot contain a separator or escape its
 *     prefix. This is the boundary storage policies key on, and it is what stops
 *     one tenant's objects colliding with another's.
 *
 * The date segment exists purely to keep any single prefix from accumulating
 * unbounded objects, which keeps listing and lifecycle rules manageable.
 */
export function buildAssetKey(siteId: string, extension: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(KEY_RANDOM_BYTES).toString("hex");

  return `sites/${siteId}/${year}/${month}/${random}.${extension}`;
}
