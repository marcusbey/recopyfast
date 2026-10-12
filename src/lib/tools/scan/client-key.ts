/**
 * Who is scanning, for the free tools' limiters (s96, plan decision 2).
 *
 * - IPv4: the address. IPv6: its /64 — one subscriber's allocation, so
 *   rotating the interface identifier buys nothing — plus its /48, for the
 *   wider daily bucket (`TOOLS_SCAN_DAILY_48`).
 * - An IPv4-mapped IPv6 address (`::ffff:1.2.3.4`) is the IPv4 it carries;
 *   keyed as IPv6 it would be a fresh /64 bucket of its own.
 * - Anything unreadable — `getClientIp`'s "unknown" above all — is null, and
 *   the route answers 403: a caller we cannot meter is a caller we do not
 *   serve. On Vercel it is unreachable (the platform overwrites
 *   `x-forwarded-for`, s77 review).
 *
 * The key lives only in Redis keys that expire about 24 h after their window
 * opens (the window's end plus a 10 s grace, `rate-limiter.ts`). It is never
 * logged and never stored with a report.
 */

import ipaddr from "ipaddr.js";

export interface ScanClientKey {
  key: string;
  /** The IPv6 /48, or null for an IPv4 caller. */
  network48: string | null;
}

export function scanClientKey(rawIp: string): ScanClientKey | null {
  const raw = rawIp.trim();
  if (!raw || !ipaddr.isValid(raw)) return null;

  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(raw);
  } catch {
    return null;
  }
  if (address.kind() === "ipv4") {
    // `ipaddr.isValid` accepts shorthand IPv4 ("1.2.3"); only four parts are a client.
    if (!ipaddr.IPv4.isValidFourPartDecimal(raw)) return null;
    return { key: address.toString(), network48: null };
  }

  const v6 = address as ipaddr.IPv6;
  if (v6.isIPv4MappedAddress()) {
    return { key: v6.toIPv4Address().toString(), network48: null };
  }
  const network64 = ipaddr.IPv6.networkAddressFromCIDR(`${v6.toString()}/64`);
  const network48 = ipaddr.IPv6.networkAddressFromCIDR(`${v6.toString()}/48`);
  return {
    key: `${network64.toString()}/64`,
    network48: `${network48.toString()}/48`,
  };
}
