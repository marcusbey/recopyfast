/**
 * What a page URL may say to Google (s107, ADR 063).
 *
 * GA4's default `page_location` is `location.href` without the fragment —
 * query string included. On this site the query string carries a visitor's
 * own figures (the s98 calculator's `?sites=&rate=…`), the legacy edit
 * credential `?rcf_edit_token=` (ADR 055's tombstone: old links still exist)
 * and anything a link-sharer pasted. So every page view and event sends an
 * explicit, sanitised `page_location`:
 *
 * - origin and path only, credentials and fragment dropped (`#rcf_edit=` is a
 *   one-time edit code, ADR 055);
 * - `utm_*` kept on the landing page view only, so GA's standard campaign
 *   fields still fill. A client-side navigation is internal by definition —
 *   s98 puts `utm_source=tools` on its own /try link — and GA would otherwise
 *   credit our own page as the campaign;
 * - a `utm_*` value holding an `@` is dropped (email campaigns put addresses
 *   in `utm_content`), and values are capped at GA's 100 characters;
 * - UUID path segments become `[id]`: s96's report URLs are capabilities
 *   (anyone with the link reads the report), and Google does not get the link.
 */

const CAMPAIGN_PREFIX = "utm_";
const MAX_PARAM_VALUE_LENGTH = 100;
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SanitizeOptions {
  /** True only for the first page view of a document (the landing). */
  keepCampaign?: boolean;
}

export function sanitizePageLocation(
  href: string,
  { keepCampaign = true }: SanitizeOptions = {},
): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const path = url.pathname
    .split("/")
    .map((segment) => (UUID_SEGMENT.test(segment) ? "[id]" : segment))
    .join("/");

  const campaign = new URLSearchParams();
  if (keepCampaign) {
    for (const [key, value] of url.searchParams) {
      if (!key.startsWith(CAMPAIGN_PREFIX) || value.includes("@")) continue;
      campaign.append(key, value.slice(0, MAX_PARAM_VALUE_LENGTH));
    }
  }
  const query = campaign.toString();

  return `${url.origin}${path}${query ? `?${query}` : ""}`;
}
