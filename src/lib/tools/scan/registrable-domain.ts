/**
 * The registrable domain (eTLD+1) of a scanned host, for the per-target hourly
 * cap (s96 review, minor 3).
 *
 * Keyed on the host name, the cap let anyone reach one victim through its
 * subdomains — `a.victim.com`, `b.victim.com`, … each its own bucket — so the
 * bucket is the registrable domain from the Public Suffix List. `tldts`
 * (MIT) was already in the lockfile through jsdom's tough-cookie; it is now a
 * direct dependency. PRIVATE suffixes count (`allowPrivateDomains`): two
 * Shopify stores or two GitHub Pages sites have different owners and must not
 * throttle each other.
 *
 * An IP literal, a single label or a bare public suffix has no registrable
 * domain; the host itself is the key then.
 */

import { isIP } from "node:net";
import { getDomain } from "tldts";

export function registrableDomain(hostname: string): string {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (isIP(host) !== 0) return host;
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}
