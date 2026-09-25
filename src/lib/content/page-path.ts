const MAX_PAGE_PATH_LENGTH = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export type NormalizedPagePath =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Canonicalize the page identity reported by the widget.
 *
 * The same index/trailing-slash fold lives in `normalizedPagePath()` in the
 * embed source. The widget has already called `decodeURI` before it sends this
 * value, so the server must validate that canonical output as opaque path data.
 * Decoding again rejects a legitimate literal `%` (`/%25` in the browser) and
 * changes `/%20` into a space (`/%2520` in the browser), splitting discovery
 * from every later read. Repeating the widget's index/trailing-slash fold is
 * unsafe for the same reason: `/index.html/` becomes the canonical
 * `/index.html` in the widget, then a second fold would collapse it to `/`.
 * This boundary therefore validates and preserves the canonical string exactly.
 * The byte bound matters in addition to the character bound: PostgreSQL's
 * btree limit is measured in bytes, so a 1,024-character non-ASCII path can be
 * several times larger than its JavaScript length suggests.
 */
export function normalizePagePath(value: unknown): NormalizedPagePath {
  if (typeof value !== "string") {
    return { ok: false, error: "Page path must be a string" };
  }

  const normalized = value;

  if (!normalized.startsWith("/")) {
    return { ok: false, error: "Page path must start with /" };
  }
  // `document.location.pathname` never contains query or fragment delimiters.
  // Accepting them from a forged discovery report would create a scope no real
  // widget read can request. Encoded reserved delimiters remain encoded after
  // decodeURI and are valid pathname data.
  if (/[?#]/.test(normalized)) {
    return { ok: false, error: "Page path must not include query or fragment" };
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    return { ok: false, error: "Page path contains control characters" };
  }
  if (
    normalized.length > MAX_PAGE_PATH_LENGTH ||
    new TextEncoder().encode(normalized).length > MAX_PAGE_PATH_LENGTH
  ) {
    return {
      ok: false,
      error: `Page path must be at most ${MAX_PAGE_PATH_LENGTH} characters and bytes`,
    };
  }

  return { ok: true, value: normalized };
}
