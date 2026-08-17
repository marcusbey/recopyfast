/**
 * SSRF guard for outbound webhook URLs.
 *
 * WHY THIS EXISTS. Until this module, the only validation a webhook URL got was
 * `new URL(url)` in the route — syntax, nothing else. `http://169.254.169.254/`
 * (the cloud instance-metadata endpoint), `http://localhost` and
 * `http://10.0.0.5` were all accepted and would have been fetched by our own
 * infrastructure, with our own network position, on a schedule the customer
 * controls. `ipaddr.js` had been a declared dependency the whole time and was
 * imported by zero files.
 *
 * WHY IT RUNS TWICE. This is called at configuration time *and* again
 * immediately before every delivery, and the second call is not redundant: DNS
 * is attacker-controlled between the two. A hostname that resolved to a public
 * address when the owner saved it can resolve to 169.254.169.254 an hour later
 * — that is DNS rebinding, and a config-time-only check is exactly the shape it
 * defeats. Nothing caches this result across the gap.
 *
 * WHAT IT DOES NOT DO. It narrows the rebinding window rather than closing it:
 * `fetch()` performs its own resolution after this one returns, so a record that
 * flips between the two still wins. Closing that fully means pinning the
 * resolved IP and forcing the connection to it through a custom dispatcher,
 * which is materially more machinery than the acceptance criterion asks for
 * ("resolve and re-check the address at delivery time"). Recorded here so the
 * next reader knows it was a decision, not an oversight — see
 * docs/plans/s16-webhook-config.md, "The point everything turns on".
 *
 * Validation returns `ValidationResult<T>` rather than throwing, per ADR 003 —
 * this project has no schema library and does not want one.
 */

import { promises as dnsPromises } from "dns";
import ipaddr from "ipaddr.js";
import type { ValidationResult } from "@/lib/api/validation";

/** Longest URL we will store. Well past any real endpoint. */
const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Only globally-routable unicast is allowed.
 *
 * Deliberately an allowlist, not a denylist of the ranges the story names.
 * `ipaddr.js` knows about ranges nobody thinks to enumerate — `6to4`,
 * `teredo`, `benchmarking`, `as112`, `broadcast` — several of which are routes
 * to an internal destination by another name, and new ones arrive with library
 * upgrades. A denylist silently admits whatever it has not heard of; this
 * silently refuses it, which is the correct direction to be wrong in.
 */
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

const PUBLIC_REACHABILITY_NOTE =
  "not something reachable from the public internet. A webhook endpoint must be a public URL your build system can reach from outside your network.";

function fail(error: string): ValidationResult<string> {
  return { ok: false, error };
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
 * actually goes. This is the specific smuggling pattern the story names.
 */
function refusalFor(
  rawAddress: string,
): { address: string; why: string } | null {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(rawAddress);
  } catch {
    // An address the resolver returned that ipaddr cannot read is not something
    // to connect to on the strength of not understanding it.
    return { address: rawAddress, why: "not a readable IP address" };
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      parsed = v6.toIPv4Address();
    }
  }

  const range: string = parsed.range();
  if (range === ALLOWED_RANGE) return null;

  return { address: parsed.toString(), why: describeRange(range) };
}

/** Strips the brackets an IPv6 literal wears inside a URL. */
function unwrapHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Validate a webhook URL against SSRF.
 *
 * @returns the normalized URL when every address it points at is publicly
 * routable; otherwise a refusal naming the address and its class, because
 * "invalid URL" teaches the owner nothing about why their build server's
 * internal hostname was rejected.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
): Promise<ValidationResult<string>> {
  if (typeof rawUrl !== "string") {
    return fail("Webhook URL must be a string");
  }

  const candidate = rawUrl.trim();
  if (!candidate) {
    return fail("Webhook URL is required");
  }
  if (candidate.length > MAX_URL_LENGTH) {
    return fail(`Webhook URL must be at most ${MAX_URL_LENGTH} characters`);
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("Webhook URL must be a valid absolute URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return fail(
      `Webhook URL must use http or https, not "${url.protocol.replace(":", "")}"`,
    );
  }

  const hostname = unwrapHostname(url.hostname);
  if (!hostname) {
    return fail("Webhook URL must include a hostname");
  }

  // A literal address needs no resolution — and must not get one, or a
  // resolver that happens to answer for "127.0.0.1" would decide the question.
  if (ipaddr.isValid(hostname)) {
    const refusal = refusalFor(hostname);
    if (refusal) {
      return fail(
        `${refusal.address} is ${refusal.why} — ${PUBLIC_REACHABILITY_NOTE}`,
      );
    }
    return { ok: true, value: url.toString() };
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dnsPromises.lookup(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    // Fail closed. A resolver outage must not become a window in which the
    // guard is off — that is precisely when nobody is watching.
    return fail(
      `${hostname} could not be resolved. A webhook endpoint must be a public hostname that resolves from the internet.`,
    );
  }

  if (!addresses || addresses.length === 0) {
    return fail(
      `${hostname} could not be resolved to any address. A webhook endpoint must be a public hostname that resolves from the internet.`,
    );
  }

  // EVERY address, not just the first: a hostname with one public A record and
  // one private one is a refusal. Which record `fetch()` would have picked is
  // not ours to guess.
  for (const entry of addresses) {
    const refusal = refusalFor(entry.address);
    if (refusal) {
      return fail(
        `${hostname} resolves to ${refusal.address}, ${refusal.why} — ${PUBLIC_REACHABILITY_NOTE}`,
      );
    }
  }

  return { ok: true, value: url.toString() };
}

/**
 * The reason line stored on a delivery that was refused at send time.
 *
 * Deliberately distinct from a connection failure: a URL that passed
 * configuration-time validation and then fails this check is signalling a
 * changed or rebound DNS record, and the owner needs that to read differently
 * from "your server didn't respond."
 */
export function describeDeliveryRefusal(safetyError: string): string {
  return `Blocked before sending — this endpoint resolved to a disallowed address at send time. ${safetyError} If the URL passed validation when you saved it, its DNS record may have changed since (DNS rebinding); update the URL if this persists.`;
}
