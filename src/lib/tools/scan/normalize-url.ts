/**
 * The one spelling of a scanned address (s96, plan decision 3).
 *
 * Everything downstream keys on the string this returns — the 24 h cache, the
 * per-target limiter, the denylist, the stored row — so two spellings of one
 * page must collapse here or they become two cache entries and two budgets.
 *
 * - `https://` is added when no scheme was typed; only http and https pass.
 * - Only the scheme's DEFAULT port passes (`blocked_port` otherwise), so our
 *   egress cannot be pointed at an arbitrary service on a public host. The
 *   fetcher's tests widen this through `isAllowedPort`; production never does.
 * - User info is refused: it would ride in every fetch, row and log line.
 * - The query string and fragment are DROPPED. They carry reset links, edit
 *   tokens and tracking ids, and a public report must never store one. The
 *   form tells the visitor so.
 * - The host is lower-cased (WHATWG does it), IDN becomes punycode (WHATWG),
 *   and a trailing dot is stripped so `example.com.` is `example.com`.
 * - Decimal, hex and octal IPv4 spellings (`2130706433`, `0x7f.1`) are
 *   rewritten to dotted quads by WHATWG; the fetcher then classifies the
 *   literal before any socket opens. Zone ids make WHATWG throw.
 *
 * Returns a reason, never an exception text: the route maps it to fixed copy.
 */

import { TEXT_CONTROL_CHARACTERS } from "@/lib/tools/text";

export const MAX_SCAN_URL_LENGTH = 2048;

export type ScanUrlRefusal = "invalid_url" | "blocked_port";

export interface NormalizedScanUrl {
  href: string;
  hostname: string;
  origin: string;
}

export type NormalizeScanUrlResult =
  | { ok: true; value: NormalizedScanUrl }
  | { ok: false; reason: ScanUrlRefusal };

export type PortRule = (protocol: "http:" | "https:", port: string) => boolean;

/** WHATWG sets `port` to "" for the scheme's default, so "" is the only pass. */
export const DEFAULT_PORT_RULE: PortRule = (_protocol, port) => port === "";

const HAS_AUTHORITY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Schemes typed without `//`. Without this, `javascript:alert(1)` would get
 * `https://` prepended and parse as host `javascript`, port `alert(1)`.
 */
const BARE_SCHEME =
  /^(?:javascript|vbscript|data|blob|file|about|mailto|tel|ftp):/i;

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

function refuse(reason: ScanUrlRefusal): NormalizeScanUrlResult {
  return { ok: false, reason };
}

export function normalizeScanUrl(
  raw: unknown,
  options: { isAllowedPort?: PortRule } = {},
): NormalizeScanUrlResult {
  if (typeof raw !== "string") return refuse("invalid_url");

  const candidate = raw.trim();
  if (!candidate || candidate.length > MAX_SCAN_URL_LENGTH) {
    return refuse("invalid_url");
  }
  if (TEXT_CONTROL_CHARACTERS.test(candidate)) return refuse("invalid_url");
  if (BARE_SCHEME.test(candidate)) return refuse("invalid_url");

  const withScheme = HAS_AUTHORITY_SCHEME.test(candidate)
    ? candidate
    : `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return refuse("invalid_url");
  }

  if (!WEB_PROTOCOLS.has(url.protocol)) return refuse("invalid_url");
  if (url.username || url.password) return refuse("invalid_url");

  const hostname = url.hostname.replace(/\.+$/, "");
  if (!hostname) return refuse("invalid_url");

  const isAllowedPort = options.isAllowedPort ?? DEFAULT_PORT_RULE;
  if (!isAllowedPort(url.protocol as "http:" | "https:", url.port)) {
    return refuse("blocked_port");
  }

  if (hostname !== url.hostname) url.hostname = hostname;
  url.search = "";
  url.hash = "";

  const href = url.href;
  if (href.length > MAX_SCAN_URL_LENGTH) return refuse("invalid_url");

  return {
    ok: true,
    value: { href, hostname: url.hostname, origin: url.origin },
  };
}
