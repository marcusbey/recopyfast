/**
 * Is this IP address somewhere our own infrastructure may connect to?
 *
 * Extracted UNCHANGED from `webhook-url-safety.ts` in s96, so the outbound
 * webhook guard and the free-tools fetcher (`src/lib/tools/fetch/`) answer the
 * question with one classifier. Two copies would drift: the next range someone
 * remembers to refuse would land in one of them.
 *
 * Deliberately an allowlist, not a denylist of the ranges anyone thought of.
 * `ipaddr.js` knows about ranges nobody thinks to enumerate — `6to4`,
 * `teredo`, `rfc6052`, `benchmarking`, `as112`, `broadcast` — several of which
 * are routes to an internal destination by another name, and new ones arrive
 * with library upgrades. A denylist silently admits whatever it has not heard
 * of; this silently refuses it, which is the correct direction to be wrong in.
 *
 * The `why` text is for the webhook owner, who typed the URL and needs to know
 * which address was refused. The free-tools route never shows it: an anonymous
 * caller must not learn what our resolver answered (s96 plan, decision 1).
 */

import ipaddr from "ipaddr.js";

/** The one range a connection may go to: globally routable unicast. */
const ALLOWED_RANGE = "unicast";

/** How each refused range is described to the person who typed the URL. */
const RANGE_DESCRIPTIONS: Record<string, string> = {
  loopback: "a loopback address",
  linkLocal: "a link-local address",
  private: "a private address",
  uniqueLocal: "a private address",
  unspecified: "an unspecified address",
  multicast: "a multicast address",
  broadcast: "a broadcast address",
  carrierGradeNat: "a carrier-grade NAT address",
  reserved: "a reserved address",
  benchmarking: "a benchmarking-range address",
  ipv4Mapped: "an IPv4-mapped address",
  "6to4": "a 6to4 tunnelling address",
  teredo: "a Teredo tunnelling address",
};

export interface AddressRefusal {
  /** The address as classified — an IPv4-mapped address is unwrapped first. */
  address: string;
  /** ipaddr.js's range name, or `"unreadable"`. */
  range: string;
  /** The range in words, for a person who configured the URL themselves. */
  why: string;
}

function describeRange(range: string): string {
  return RANGE_DESCRIPTIONS[range] ?? "not a publicly routable address";
}

/**
 * Classify one address. Returns null when it is safe to connect to.
 *
 * An IPv4-mapped IPv6 address is unwrapped first: `::ffff:169.254.169.254`
 * carries a link-local IPv4 address inside an IPv6 shell, and reading the
 * shell's range answers "ipv4Mapped", which says nothing about where the packet
 * actually goes. This is the specific smuggling pattern the s16 story named.
 */
export function classifyAddress(rawAddress: string): AddressRefusal | null {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(rawAddress);
  } catch {
    // An address the resolver returned that ipaddr cannot read is not something
    // to connect to on the strength of not understanding it.
    return {
      address: rawAddress,
      range: "unreadable",
      why: "not a readable IP address",
    };
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      parsed = v6.toIPv4Address();
    }
  }

  const range: string = parsed.range();
  if (range === ALLOWED_RANGE) return null;

  return { address: parsed.toString(), range, why: describeRange(range) };
}

/** Strips the brackets an IPv6 literal wears inside a URL. */
export function unwrapHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}
