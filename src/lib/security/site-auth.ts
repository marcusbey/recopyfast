import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";

interface SiteRecord {
  id: string;
  domain: string;
  api_key: string;
}

export interface SiteAuthContext {
  site: SiteRecord;
  allowedOrigin: string | null;
}

export function normalizeDomain(domain: string) {
  const trimmed = domain.trim();
  if (!trimmed) {
    throw new Error("Invalid domain");
  }

  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    return url.hostname.toLowerCase();
  } catch {
    throw new Error("Invalid domain");
  }
}

/**
 * The host a request claims to come from, or null.
 *
 * Exported so callers that need to *record* a rejected origin resolve it the
 * same way the authorization decision did. A raw `Referer` is not that: it is a
 * full URL with a path, a port and whatever casing the browser sent, and
 * comparing or storing it verbatim is how the two ends of "did this match"
 * drift apart. Returns `URL.hostname` lowercased, so a port is already stripped
 * and an IPv6 loopback arrives bracketed.
 */
export function parseOrigin(originHeader?: string | null) {
  if (!originHeader) return null;
  try {
    return new URL(originHeader).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The exact hosts that can only be a developer's own machine.
 *
 * Shared by the request and preflight paths below so the two cannot drift into
 * disagreeing about what "local" means — they did, and the disagreement was
 * invisible because only one of them is reached without a browser.
 *
 * EXACT, never a prefix. This read `host.startsWith("127.0.0.1")`, which is true
 * of `127.0.0.1.attacker.example` — a domain anyone can register and point
 * anywhere. That handed the development bypasses (the demo-token exemption in
 * `authorizeSiteRequest`, the preflight grant in `authorizeSiteOrigin`) to an
 * attacker-controlled origin. The prefix was there to tolerate a port, which
 * `parseOrigin` already strips: it returns `URL.hostname`, so `127.0.0.1:8080`
 * arrives as `127.0.0.1` and an IPv6 loopback as the bracketed `[::1]`.
 */
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalhostHost(host: string | null): boolean {
  if (!host) return false;
  return LOCALHOST_HOSTS.has(host);
}

export function buildSiteToken(siteId: string, apiKey: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${siteId}.${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", apiKey)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

/** Maximum lifetime of a site token: 90 days in seconds. */
const SITE_TOKEN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export function verifySiteTokenSignature(
  siteId: string,
  apiKey: string,
  token: string,
) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [tokenSiteId, issuedAt, signature] = parts;
  if (tokenSiteId !== siteId) return false;

  if (!/^[0-9]+$/.test(issuedAt)) return false;

  // Reject tokens that are older than the maximum allowed age.
  const issuedAtSeconds = parseInt(issuedAt, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - issuedAtSeconds > SITE_TOKEN_MAX_AGE_SECONDS) return false;

  // Guard against clock-skew / future-dated tokens (allow 60 s of leeway).
  if (issuedAtSeconds > nowSeconds + 60) return false;

  const expectedSignature = crypto
    .createHmac("sha256", apiKey)
    .update(`${tokenSiteId}.${issuedAt}`)
    .digest("hex");

  const presented = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  // Length first, and a `try` around the compare regardless.
  //
  // `timingSafeEqual` THROWS `RangeError: Input buffers must have the same byte
  // length` on mismatched sizes — it does not return false. That exception used
  // to escape this function, escape `authorizeSiteRequest`, and land in the
  // route's `catch (authError)`, which hands `authError.message` straight back
  // to an unauthenticated caller (api/content/[siteId]/route.ts:296-308). A
  // one-character signature was enough to produce it.
  //
  // The length check leaks nothing a caller does not already know: they chose
  // the length. Comparing the two full-length digests is what has to stay
  // constant-time, and it still is. `server/auth.js:73-77` does the same, and
  // the two copies are watched for drift by the auth-parity suite.
  if (presented.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(presented, expected);
  } catch {
    return false;
  }
}

export async function authorizeSiteRequest(options: {
  siteId: string;
  token: string | null;
  origin?: string | null;
  referer?: string | null;
}): Promise<SiteAuthContext> {
  const { siteId, token, origin, referer } = options;

  if (!token) {
    throw new Error("Missing site token");
  }

  const supabase = createServiceRoleClient();
  const { data: site, error } = await supabase
    .from("sites")
    .select("id, domain, api_key")
    .eq("id", siteId)
    .single();

  if (error || !site) {
    throw new Error("Site not found");
  }

  // Allow demo mode for localhost in development
  const requestOriginHost = parseOrigin(origin) || parseOrigin(referer);
  const isLocalhost = isLocalhostHost(requestOriginHost);
  const isDemoToken = token === "demo-site-token";
  const isDevelopment = process.env.NODE_ENV !== "production";
  const isLocalDemo = isDevelopment && isLocalhost && isDemoToken;

  if (!isLocalDemo) {
    if (!verifySiteTokenSignature(site.id, site.api_key, token)) {
      throw new Error("Invalid site token");
    }
  }

  const allowedDomain = normalizeDomain(site.domain);

  // The domain pin is mandatory, not conditional on a header being offered.
  //
  // `data-site-token` ships as a plain attribute in the customer's page markup
  // (src/lib/sites/embed-script.ts:76), so the token is readable with View
  // Source and this check is the only thing that makes a published credential
  // safe. It used to read `if (requestOriginHost && requestOriginHost !==
  // allowedDomain)`. Origin and Referer are set by browsers and cannot be forged
  // cross-origin — but nothing obliges a non-browser caller to send either, so
  // treating "no header" as "nothing to check" enforced the pin only against
  // the caller that could never have beaten it, and skipped it entirely for
  // curl. A caller that cannot present the registered domain is refused. (A-2)
  //
  // The localhost demo token stays exempt: it is the only bypass, it requires a
  // non-production build, and `isLocalhost` is itself derived from a present
  // Origin or Referer.
  if (!isLocalDemo && requestOriginHost !== allowedDomain) {
    throw new Error("Origin not allowed");
  }

  const allowedOrigin = requestOriginHost ? `${origin ?? referer}` : null;

  return {
    site,
    allowedOrigin,
  };
}

/**
 * There are two legitimate callers of the content routes, and they cannot
 * prove themselves the same way. The embed widget runs on the customer's own
 * domain, cross-origin from us, and proves itself with a site token whose
 * Origin must match the registered domain (authorizeSiteRequest, above). The
 * dashboard is same-origin against our own app — its Origin is never the
 * customer's domain, so it can never pass that check — but it already carries
 * an authenticated Supabase session. This function authorizes that second
 * caller on session + site_permissions instead of Origin, and never inspects
 * Origin at all. Returns null (not throw) whenever the session path doesn't
 * apply, so callers fall through to the widget path unchanged.
 */
export async function authorizeFirstPartySiteRequest(
  siteId: string,
): Promise<SiteAuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: permission } = await supabase
    .from("site_permissions")
    .select("id")
    .eq("site_id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!permission) {
    return null;
  }

  const serviceClient = createServiceRoleClient();
  const { data: site, error } = await serviceClient
    .from("sites")
    .select("id, domain, api_key")
    .eq("id", siteId)
    .single();

  if (error || !site) {
    return null;
  }

  // Same-origin caller: no cross-origin grant is needed, and withCors() in the
  // route already falls back to NEXT_PUBLIC_APP_URL when this is null.
  return {
    site,
    allowedOrigin: null,
  };
}

export function sanitizeIncomingContent(content: string) {
  return sanitizeHTML(content ?? "", "BASIC_TEXT");
}

export async function authorizeSiteOrigin(
  siteId: string,
  origin?: string | null,
  referer?: string | null,
) {
  const supabase = createServiceRoleClient();
  const { data: site, error } = await supabase
    .from("sites")
    .select("id, domain")
    .eq("id", siteId)
    .single();

  if (error || !site) {
    throw new Error("Site not found");
  }

  const allowedDomain = normalizeDomain(site.domain);
  const requestOriginHost = parseOrigin(origin) || parseOrigin(referer);

  // What this decides is narrower than it looks: whether the caller's origin is
  // granted, never what the preflight answers. The OPTIONS handler returns 204 to
  // everyone and varies only the `Access-Control-Allow-Origin` it echoes, so a
  // throw here withholds the grant rather than producing a distinguishable status
  // — see the comment on OPTIONS in api/content/[siteId]/route.ts.
  //
  // The preflight still has to agree with the request it precedes.
  // `authorizeSiteRequest` exempts the localhost demo token on a non-production
  // build, but the browser sends an OPTIONS before any cross-origin GET or POST,
  // and this function — which answers it — has no token to inspect. Refusing the
  // grant here blocked the very request that exemption exists to allow: the local
  // test page in docs/archive/project-report.md:435 never got past its preflight, so its
  // fetch was never sent and the exemption on the other side was unreachable.
  //
  // Development only, and it admits nothing by itself: the GET or POST behind the
  // preflight still needs a site token, and any token but the demo one still needs
  // the exact registered domain. In production this branch is dead and the domain
  // pin is absolute.
  const isLocalDevPreflight =
    process.env.NODE_ENV !== "production" && isLocalhostHost(requestOriginHost);

  // Otherwise unconditional, for the same reason as authorizeSiteRequest above: a
  // caller that sends no parseable Origin has not proved it is on the registered
  // domain. A browser preflight always sends Origin, so a missing one is never a
  // preflight. (A-2)
  if (!isLocalDevPreflight && requestOriginHost !== allowedDomain) {
    throw new Error("Origin not allowed");
  }

  const allowedOrigin = requestOriginHost ? (origin ?? referer) : null;

  return {
    site,
    allowedOrigin,
  };
}
