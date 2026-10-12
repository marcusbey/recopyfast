# ADR 063 — Google Analytics runs on the marketing surface only, consent-gated, with no inline script

- Status: accepted (architect: pre-approved scope 2026-10-12)
- Date: 2026-10-12
- Scope: story `s107-google-analytics`
- Related: [ADR 059](./059-nonce-csp-on-the-app-surface.md) (the two CSPs),
  [ADR 061](./061-lighthouse-comparison-gate-uses-applied-mobile-throttling.md) (the gate this
  story must keep green), [ADR 062](./062-free-tool-reports-are-service-role-reads-under-the-nonce-csp.md)
  (free-tool reports under the nonce CSP).

## Context

The owner asked for Google Analytics 4 on the public site. Until now there was no visitor analytics
at all (launch kit §12). Four constraints shaped the integration:

1. **The CSP.** Marketing pages are prerendered under a static policy with no nonce (ADR 059). The
   standard gtag snippet is an inline script; adding one would keep working only because the
   static policy allows `'unsafe-inline'` — the weakness ADR 059 confines to that surface, not a
   thing to lean on further. The app surface (dashboard, auth, editor) is under a nonce policy and
   renders text scraped off customers' pages.
2. **Consent.** Visitors in the EEA, the UK, Switzerland and Quebec must be asked before analytics
   cookies are set. A prerendered page cannot know the visitor's country without becoming dynamic.
3. **Third-party pages.** The embed widget and the `/try` runtime are served from our origin but
   run on other people's documents. Our banner, privacy page and CSP do not apply there.
4. **Performance.** The s17 comparison gate (mobile, 8 routes, ADR 061) must stay green.

## Decision

1. **One route allowlist** (`isAnalyticsRoute`) decides where GA may run: `/`, `/try`, `/pricing`,
   `/privacy`, `/terms`, `/demo`, and `/compare`, `/tools`, `/blog`, `/docs` with their subpaths,
   except the free-tool scan reports (`/tools/<slug>/r/…`, see Consequences). Both the client
   component and the middleware (CSP) ask it; it never overlaps the nonce policy.
   **The client asks it twice** (`isAnalyticsPage`, independent review F1): for the current path
   AND for the path the document was loaded on (`getDocumentPathname`: the navigation entry, else
   `location.pathname` when the module first ran). The CSP is the document's, and a client
   navigation (`<Link>`, back/forward) keeps it: `/login` → "Terms" is still the `/login` document
   under the nonce policy, whose `'strict-dynamic'` would admit a script-inserted gtag.js whatever
   its host list says; `/settings` → `/` keeps a static policy without Google's hosts. In both,
   nothing loads — not the runtime chunk, the init script, gtag.js, nor the footer's "Cookie
   settings".
2. **No inline script.** A first-party route handler, `/analytics/gtag-init.js`, returns the gtag
   queue and the Consent Mode v2 defaults. It reads `x-vercel-ip-country` (and, for Canada,
   `x-vercel-ip-country-region`) per request, reduces them to one boolean (consent required: EEA +
   UK + CH + Quebec; fail-closed when missing, malformed, not an assigned ISO 3166-1 code — XX,
   ZZ, T1, A1, A2, O1, EU, AP… — or a Canadian request without a known province), never echoes
   them, and is `private, no-store`. gtag.js is loaded through `next/script` (`afterInteractive`) only after the
   init script has run.
3. **Basic consent mode where consent is required.** There, gtag.js is not requested at all until
   "Allow analytics" — no cookieless pings. The `region` defaults still ship, denying everything for
   visitors Google places in those regions (the countries, plus `CA-QC`). Elsewhere analytics is granted by default and can be
   declined. Ads storage, user data and personalisation are denied for everyone.
4. **The static policy gains exactly GA4's hosts** on allowlisted pages with a configured id:
   `www.googletagmanager.com` for scripts, `*.google-analytics.com`, `*.analytics.google.com`,
   `*.googletagmanager.com` for connect and img. The builder ignores the flag under a nonce.
5. **Page views are sent by our code**, sanitised (no fragment, no query key but `utm_*` on the
   landing view, UUID path segments redacted), one per allowlisted pathname. GA's own
   browser-history page views are turned off in the property.
6. **Production only.** The id lives in Vercel's Production environment; previews build without it,
   and without an id nothing renders, no CSP changes and the init route answers 404.

## Options considered and rejected

- **The inline snippet** under the static policy. Works today, but adds an inline script to the
  surface ADR 059 tolerates them on only out of necessity, and would break the day the marketing
  surface moves to a nonce.
- **Consent Mode "advanced" in the EEA** (gtag.js loaded before consent, cookieless pings). More
  modelled data, but data about a visitor leaves for Google before they answered. Rejected for a
  privacy-first default; the region defaults remain as a second layer.
- **A cookie or response header carrying the country.** A cookie stores it; a document header is
  unreadable from script; reading `headers()` in the page makes every marketing page dynamic.
- **Enhanced measurement's history page views.** Google sends them even with `send_page_view: false`,
  from the raw URL (query string included — the calculator's figures), and before the app can switch
  GA off on a page outside the allowlist. They would also double-count our own.
- **GA on every non-nonce page** (CSP keyed on the nonce alone). `/settings`, `/auth/*` and the API
  are static-policy too; the allowlist keeps them out of both the script and the policy.

## Consequences

- New marketing pages are unmeasured until added to the allowlist — by design.
- `/signup` is unmeasured client-side; `sign_up` needs a server-side Measurement Protocol call
  (documented follow-up, `docs/operations/analytics.md`).
- **Free-tool scan reports carry no analytics** (architect decision on merging s96, 2026-10-12).
  `/tools/<slug>/r/<id>` stays on the nonce policy of s96's ADR 062 with no Google host, and the
  allowlist excludes it: a report renders text scraped off a stranger's site and its URL is a
  capability, so neither its content nor its address may reach Google. The scan is measured on
  the tool page instead (`tool_scan_completed` from `ToolScanForm`, slug only). Measuring reports
  would need a new ADR superseding this point.
- **Quebec asks first** (owner decision on the s107 independent review, 2026-10-12): Law 25, and
  the business is in Canada. Only Quebec, by Vercel's province header; a Canadian request without
  a known province asks too. Other GDPR-like regimes (Brazil's LGPD, Jersey, Guernsey, the Isle of
  Man, Gibraltar) stay "granted by default" until the owner decides otherwise; adding one is a
  code change in `consent.ts` plus the privacy page.
- The CI e2e and Lighthouse jobs build with a fake id (`G-E2ETEST000`), so they test what
  production serves; no request reaches Google in either.

## Watch

- Google changing what gtag.js loads from (new hosts) would show as CSP violations in the console
  and as missing data in GA Realtime; `e2e/google-analytics.spec.ts` only stubs the hosts it knows.
- If the marketing surface ever moves to a nonce policy, the analytics hosts move with it and
  `'strict-dynamic'` makes the script host entry redundant but harmless.
