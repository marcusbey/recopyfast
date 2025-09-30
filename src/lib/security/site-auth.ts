import crypto from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { sanitizeHTML } from '@/lib/security/content-sanitizer';

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
    throw new Error('Invalid domain');
  }

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch (error) {
    throw new Error('Invalid domain');
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
    .createHmac('sha256', apiKey)
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

export function verifySiteTokenSignature(siteId: string, apiKey: string, token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [tokenSiteId, issuedAt, signature] = parts;
  if (tokenSiteId !== siteId) return false;

  if (!/^[0-9]+$/.test(issuedAt)) return false;

  const expectedSignature = crypto
    .createHmac('sha256', apiKey)
    .update(`${tokenSiteId}.${issuedAt}`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

export async function authorizeSiteRequest(options: {
  siteId: string;
  token: string | null;
  origin?: string | null;
  referer?: string | null;
}): Promise<SiteAuthContext> {
  const { siteId, token, origin, referer } = options;

  if (!token) {
    throw new Error('Missing site token');
  }

  const supabase = createServiceRoleClient();
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, domain, api_key')
    .eq('id', siteId)
    .single();

  if (error || !site) {
    throw new Error('Site not found');
  }

  if (!verifySiteTokenSignature(site.id, site.api_key, token)) {
    throw new Error('Invalid site token');
  }

  const allowedDomain = normalizeDomain(site.domain);
  const requestOriginHost = parseOrigin(origin) || parseOrigin(referer);

  if (requestOriginHost && requestOriginHost !== allowedDomain) {
    throw new Error('Origin not allowed');
  }

  const allowedOrigin = requestOriginHost ? `${origin ?? referer}` : null;

  return {
    site,
    allowedOrigin,
  };
}

export function sanitizeIncomingContent(content: string) {
  return sanitizeHTML(content ?? '', 'BASIC_TEXT');
}

export async function authorizeSiteOrigin(siteId: string, origin?: string | null, referer?: string | null) {
  const supabase = createServiceRoleClient();
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, domain')
    .eq('id', siteId)
    .single();

  if (error || !site) {
    throw new Error('Site not found');
  }

  const allowedDomain = normalizeDomain(site.domain);
  const requestOriginHost = parseOrigin(origin) || parseOrigin(referer);

  if (requestOriginHost && requestOriginHost !== allowedDomain) {
    throw new Error('Origin not allowed');
  }

  const allowedOrigin = requestOriginHost ? (origin ?? referer) : null;

  return {
    site,
    allowedOrigin,
  };
}
