import crypto from "crypto";
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
  } catch (error) {
    throw new Error("Invalid domain");
  }
}

function parseOrigin(originHeader?: string | null) {
  if (!originHeader) return null;
  try {
    return new URL(originHeader).hostname.toLowerCase();
  } catch (error) {
    return null;
  }
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

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
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
  const isLocalhost =
    requestOriginHost === "localhost" ||
    requestOriginHost?.startsWith("127.0.0.1");
  const isDemoToken = token === "demo-site-token";
  const isDevelopment = process.env.NODE_ENV !== "production";

  if (!(isDevelopment && isLocalhost && isDemoToken)) {
    if (!verifySiteTokenSignature(site.id, site.api_key, token)) {
      throw new Error("Invalid site token");
    }
  }

  const allowedDomain = normalizeDomain(site.domain);

  // Skip domain validation for localhost demo mode
  if (!(isDevelopment && isLocalhost && isDemoToken)) {
    if (requestOriginHost && requestOriginHost !== allowedDomain) {
      throw new Error("Origin not allowed");
    }
  }

  const allowedOrigin = requestOriginHost ? `${origin ?? referer}` : null;

  return {
    site,
    allowedOrigin,
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

  if (requestOriginHost && requestOriginHost !== allowedDomain) {
    throw new Error("Origin not allowed");
  }

  const allowedOrigin = requestOriginHost ? (origin ?? referer) : null;

  return {
    site,
    allowedOrigin,
  };
}
