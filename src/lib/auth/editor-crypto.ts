/**
 * Cryptographic primitives for editor access.
 *
 * Everything the editor flow treats as a secret — verification codes, device
 * grants, handoff codes, hub sessions — is either signed or hashed with the key
 * resolved here. Nothing is stored in a form the server could hand back to a
 * caller, and nothing is compared with `===`.
 */

import crypto from "crypto";

/**
 * Domain separation tags. An HMAC key used for two purposes without a tag lets
 * a value minted for one purpose be presented as the other; the tag is prefixed
 * into every message so a grant signature can never be replayed as a hub-session
 * signature (or vice versa).
 */
export const CRYPTO_DOMAIN = {
  grant: "recopyfast/editor-grant/v1",
  code: "recopyfast/editor-code/v1",
  handoff: "recopyfast/editor-handoff/v1",
  hubSession: "recopyfast/editor-hub-session/v1",
} as const;

export type CryptoDomain = (typeof CRYPTO_DOMAIN)[keyof typeof CRYPTO_DOMAIN];

let cachedKey: Buffer | null = null;
let warnedAboutFallback = false;

/**
 * Resolve the server-side signing key.
 *
 * Prefers a dedicated `EDITOR_GRANT_SECRET`. Falls back to a key *derived from*
 * the service-role key so a deployment that has not yet been given the new
 * variable still fails closed rather than open — the derivation is one-way, so
 * this never exposes the service-role key, but rotating it silently invalidates
 * every outstanding grant, which is why the dedicated variable is the right
 * configuration and the fallback logs loudly.
 *
 * Throws when neither is available. Callers must let that propagate: an editor
 * endpoint that cannot sign has no safe degraded mode.
 */
export function getSigningKey(): Buffer {
  if (cachedKey) return cachedKey;

  const dedicated = process.env.EDITOR_GRANT_SECRET;
  if (dedicated && dedicated.length >= 32) {
    cachedKey = Buffer.from(dedicated, "utf8");
    return cachedKey;
  }

  if (dedicated) {
    throw new Error(
      "EDITOR_GRANT_SECRET is set but shorter than 32 characters. Generate one with `openssl rand -base64 48`.",
    );
  }

  const fallbackSource = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fallbackSource) {
    throw new Error(
      "Cannot sign editor credentials: set EDITOR_GRANT_SECRET (or SUPABASE_SERVICE_ROLE_KEY as a fallback).",
    );
  }

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[editor-auth] EDITOR_GRANT_SECRET is not set — deriving the signing key from SUPABASE_SERVICE_ROLE_KEY. " +
        "Set a dedicated secret so the two can be rotated independently.",
    );
  }

  cachedKey = crypto
    .createHmac("sha256", "recopyfast/editor-key-derivation/v1")
    .update(fallbackSource)
    .digest();
  return cachedKey;
}

/** Test seam: drop the memoised key so a test can change the environment. */
export function resetSigningKeyCache(): void {
  cachedKey = null;
  warnedAboutFallback = false;
}

/**
 * Keyed digest, base64url. Used wherever the stored value must be unforgeable.
 *
 * The separator is NUL, not a space, and that is load-bearing: NUL cannot occur
 * in a domain tag, an email address or a verification code, so a signed message
 * splits exactly one way. With a space, "a@b.com 1 23456" and "a@b.com 12 3456"
 * would feed the HMAC the same bytes — an ambiguity the caller does not get to
 * choose, but an attacker supplying one half of the pair would. Do not "tidy"
 * the escape below into a literal space.
 */
export function signValue(domain: CryptoDomain, value: string): string {
  return crypto
    .createHmac("sha256", getSigningKey())
    .update(`${domain}\u0000${value}`)
    .digest("base64url");
}

/**
 * Unkeyed digest, hex. Used for lookup keys whose preimage is already
 * high-entropy (a 48-byte grant), where the digest adds nothing to guess.
 * Never use this for low-entropy values such as 6-digit codes — see
 * `hashVerificationCode`.
 */
export function hashOpaqueSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Verification codes are keyed, not merely hashed: 10^6 possible codes means an
 * unkeyed digest is reversible by exhaustive search the moment the table leaks.
 * The email is mixed in so a stolen row cannot be replayed against a different
 * address that happened to draw the same code.
 */
export function hashVerificationCode(email: string, code: string): string {
  return signValue(CRYPTO_DOMAIN.code, `${email.toLowerCase()}\u0000${code}`);
}

/**
 * Constant-time string comparison.
 *
 * `crypto.timingSafeEqual` throws on length mismatch, which would itself leak
 * length through the exception path — so both sides are digested to a fixed
 * 32 bytes first and the comparison is always over equal-length buffers.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aDigest = crypto.createHash("sha256").update(a, "utf8").digest();
  const bDigest = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(aDigest, bDigest);
}

/** 6-digit code from a CSPRNG. `Math.random()` is predictable from prior output. */
export function generateVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** High-entropy opaque secret, URL-safe. */
export function generateOpaqueSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Normalise an Origin header to `scheme://host[:port]`, lowercased, with the
 * default port dropped. Returns null for anything unparseable or non-HTTP, so a
 * caller can treat "no usable origin" as a hard failure rather than matching on
 * an empty string.
 */
export function normalizeOrigin(
  origin: string | null | undefined,
): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const isDefaultPort =
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80");
    const port = isDefaultPort || !url.port ? "" : `:${url.port}`;
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
}

/** Stable fingerprint of an origin, stored on the grant and re-checked on use. */
export function hashOrigin(origin: string): string {
  return hashOpaqueSecret(`origin\u0000${origin}`).slice(0, 32);
}

/**
 * Fingerprint of the browser. Deliberately the whole User-Agent string: it is
 * stable for the life of a browser install and changes on update, which is the
 * behaviour we want (a browser update costs one extra code entry; a different
 * browser is refused).
 */
export function hashUserAgent(userAgent: string | null | undefined): string {
  return hashOpaqueSecret(`ua\u0000${userAgent ?? ""}`).slice(0, 32);
}

/**
 * Truncate a client IP to a network prefix for audit logging: /24 for IPv4,
 * /48 for IPv6. Full addresses are personal data and buy us nothing here — the
 * value is only ever eyeballed to answer "did this grant move continents?".
 */
export function toIpPrefix(ip: string | null | undefined): string | null {
  if (!ip || ip === "unknown") return null;
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}::/48` : null;
  }
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

/**
 * A compact signed token: `<prefix>.<base64url payload>.<signature>`.
 *
 * The payload is readable by the holder — it contains nothing secret, only the
 * binding the server will re-check — and the signature makes it unforgeable.
 * Verification is offline, so a forged token is rejected before it costs a
 * database round trip.
 */
export function encodeSignedToken(
  prefix: string,
  domain: CryptoDomain,
  payload: object,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const message = `${prefix}.${body}`;
  return `${message}.${signValue(domain, message)}`;
}

export function decodeSignedToken<T>(
  prefix: string,
  domain: CryptoDomain,
  token: string | null | undefined,
): T | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [tokenPrefix, body, signature] = parts;
  if (tokenPrefix !== prefix) return null;

  const expected = signValue(domain, `${tokenPrefix}.${body}`);
  if (!timingSafeEqualString(signature, expected)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
