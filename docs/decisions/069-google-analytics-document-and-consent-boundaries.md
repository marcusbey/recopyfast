# ADR 069 — Google Analytics requires an allowed document and an expanded consent boundary

- Status: accepted (architect and owner decisions already implemented 2026-10-12)
- Date: 2026-10-12
- Scope: story `s107-google-analytics`, after the s96 merge and independent review
- Supersedes: ADR 063 Decision 1's route scope and client guard; Decision 2's country-header
  interpretation; Decision 3's regional default; and the report-page consequence
- Preserves: every other decision in ADR 063, including no inline script, basic consent mode,
  the GA host list, manual sanitised page views and Production-only configuration
- Related: [ADR 059](./059-nonce-csp-on-the-app-surface.md) (document CSPs),
  [ADR 062](./062-free-tool-reports-are-service-role-reads-under-the-nonce-csp.md) (report
  documents)

## Context

ADR 063 was accepted before s96's free-tool branch merged and before s107's independent review.
Three later facts changed parts of that decision without changing the product's goal:

1. s96 put `/tools/<slug>/r/<id>` under the nonce policy because a report renders text scraped
   from a stranger's site and its URL is a read capability. ADR 063's original allowlist included
   every `/tools` subpath while its consequence said report pages received no GA hosts. The merge
   had to make that boundary explicit.
2. The CSP belongs to the loaded document. A Next `<Link>` changes the client route but keeps the
   document and its policy. The independent review reproduced `/login` → `/terms` loading the init
   script and gtag.js inside the login document: its nonce policy and `'strict-dynamic'` admitted
   the dynamically inserted scripts even though the current route looked like Marketing.
3. A syntactically valid two-letter value is not necessarily an assigned country. GeoIP systems
   use values such as `XX`, `ZZ`, `T1`, `A1`, `A2`, `O1`, `EU` and `AP` when they cannot place a
   visitor. The owner also decided during the review that Quebec asks before analytics runs, using
   Vercel's province header; Canada without a known province must fail closed.

The same review found the UI consequences of those boundaries: a footer control must not dispatch
to an absent runtime, and a reopened banner must describe the consent state already in effect.

## Decision

1. **Free-tool reports are excluded from analytics.** `isAnalyticsRoute` rejects
   `/tools/<slug>/r` and everything below that segment. The report document keeps ADR 062's nonce
   policy and no Google host. A successful scan sends `tool_scan_completed` from the allowlisted
   tool page, with only the tool slug, immediately before the browser opens the report as a new
   document.
2. **Client analytics requires both routes to be allowed.** The client calls `isAnalyticsPage`
   with the current path and document path; it applies `isAnalyticsRoute` to both. The document
   path comes from `getDocumentPathname`, which captures the navigation entry's pathname, or the
   location at hydration when no entry is available, before client navigation can change it. The
   analytics shell, runtime and footer use this two-part guard. Middleware continues to apply the
   one route allowlist to the incoming document request. On an initially excluded document, no
   analytics resource or Cookie settings control loads. When a previously allowed document
   navigates client-side to an excluded route, the guard prevents new analytics loads, the runtime
   unmounts and raises the disable flag, no further events are sent, and Cookie settings
   disappears. Resources fetched earlier may remain in that document or the browser cache; this
   decision does not claim to unload them.
3. **Only an assigned country with a settled rule may default analytics on.**
   `isConsentRequiredCountry(country, region)` asks for consent when the country is missing,
   malformed or not one of ISO 3166-1's 249 assigned alpha-2 codes. It also asks for every country
   in ADR 063's consent set. For Canada, Quebec asks; a missing or unknown province asks; a known
   province or territory outside Quebec keeps the existing granted-by-default rule.
4. **The first-party init route reads the province only to make that decision.** It reads
   `x-vercel-ip-country-region` beside `x-vercel-ip-country`, reduces both to the same one boolean,
   and reflects neither value. Google's regional denied default gains `CA-QC`; the global default
   follows the per-request boolean. Ads remain denied everywhere.
5. **Consent settings UI follows the effective boundary and state.** Cookie settings renders only
   where the guarded runtime can listen. Reopening it outside a consent-required region with no
   stored choice shows the effective granted state; declining disables analytics and deletes the
   GA cookies the integration recognises. Reports and excluded documents do not offer a dead
   control.

## Options considered and rejected

- **Continue editing ADR 063.** Rejected: it is an accepted historical decision. Later review and
  merge decisions belong in a superseding record so the reason for the change remains reviewable.
- **Check only the current client pathname.** Rejected by the reproduced login-to-terms case. It
  reasons about the route while scripts execute under the document's retained CSP.
- **Add Google hosts to every nonce document.** Rejected: app, auth, editor and report documents
  are deliberately outside visitor analytics. Under `'strict-dynamic'`, the host list would not
  repair the reproduced dynamic-script path anyway.
- **Measure report views and redact only the report id.** Rejected: the report renders untrusted
  scraped content under ADR 062, and the product decision measures the scan where it starts.
- **Treat every two-letter GeoIP value as a country.** Rejected: reserved and provider-specific
  placeholders would silently take the granted path when the visitor's location is unknown.
- **Ask throughout Canada.** Rejected: the owner decision added Quebec. Failing closed when the
  province is absent preserves that boundary without silently guessing outside it.

## Consequences

- A marketing route reached inside an app, auth, settings or report document remains unmeasured
  until a full navigation loads an allowed Marketing document. Its footer has no Cookie settings
  control during that client-only transition.
- Free-tool reports send no page view and load no analytics runtime. The originating tool page may
  send `tool_scan_completed`; a failed or refused scan sends nothing.
- Quebec and an unlocatable visitor see the first-choice banner and make no Google request before
  Allow. Known Canadian provinces and territories outside Quebec keep the ADR 063 default.
- The GA admin setting for granular location remains the separately recorded operational state;
  this decision changes the site's consent gate and Google's `CA-QC` regional default.
- ADR 063 is restored byte-for-byte to its first accepted form. Future structural changes to these
  boundaries require another ADR rather than an edit to 063 or 069.

## Watch

- A new public route is measured only after the allowlist and both policy-boundary test sets name
  it. A new report-like route needs an explicit decision rather than inheriting `/tools`.
- `getDocumentPathname` depends on navigation-entry semantics with a hydration fallback. Chromium
  and WebKit coverage must stay alongside the unit cases for client transitions.
- The consent jurisdiction list is a product/legal decision. Adding another country or subdivision
  changes code, privacy copy, the init response and the GA regional default together.
