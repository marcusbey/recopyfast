import { isConsentRequiredCountry } from "@/lib/analytics/google-analytics/consent";
import { buildGtagInitScript } from "@/lib/analytics/google-analytics/init-script";
import { getMeasurementId } from "@/lib/analytics/google-analytics/measurement-id";

/**
 * `/analytics/gtag-init.js` — Google Analytics' first-party init script
 * (s107, ADR 063). Loaded by `GoogleAnalytics` on allowlisted marketing pages
 * only, before gtag.js.
 *
 * Per request, on purpose: the body depends on Vercel's `x-vercel-ip-country`
 * (and, for Canada, `x-vercel-ip-country-region`: Quebec asks first), which a
 * prerendered page cannot read without turning dynamic. Both are reduced to
 * one boolean (`isConsentRequiredCountry`, fail-closed) and nothing from the
 * request is written into the body. `private, no-store`: the same URL
 * answers differently per country, so neither Vercel's CDN nor a shared cache
 * may keep it.
 *
 * 404 when no measurement id is configured (every preview deployment): the
 * component does not request it then, and a stray request gets nothing.
 *
 * Sessionless in `src/middleware.ts`: no answer here depends on a session, and
 * a GoTrue round trip per marketing page view would buy nothing.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!getMeasurementId()) {
    return new Response(null, { status: 404 });
  }

  const consentRequired = isConsentRequiredCountry(
    request.headers.get("x-vercel-ip-country"),
    request.headers.get("x-vercel-ip-country-region"),
  );
  return new Response(buildGtagInitScript({ consentRequired }), {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
