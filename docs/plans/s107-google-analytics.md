---
validated: yes (architect: pre-approved scope 2026-10-12)
---

# Plan — Story s107-google-analytics

> Owner request, 2026-10-12: Google Analytics 4 on the public marketing site, "with the settings
> perfectly fine". Architect brief: GA4 on marketing routes only, Consent Mode v2 privacy-first,
> no inline script, nothing on the app (nonce) policy, Lighthouse gate kept green.

Branch: `feature/s107-google-analytics` from `main` `9541589`; `main` merged in after s96
(free-tools platform, `c905292`) landed first. Architect decision at that merge: s96's scan reports
carry no analytics; the scan is measured on the tool page.

Decision record: ADR 063 is the accepted integration baseline. ADR 069 records the later s96-merge
and independent-review decisions without rewriting that accepted history: report exclusion, the
document-path guard, assigned-country fail-closed handling and Quebec.

## Where the brief met the code

| Brief                                                                     | Code says                                                                                                                                                                                       | Adaptation                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Region hint from `x-vercel-ip-country` "passed to the page, never stored" | Every marketing page is prerendered under the static policy (ADR 059); reading `headers()` in a page would turn it dynamic and drop it off the CDN                                              | The hint travels in the first-party init script: `GET /analytics/gtag-init.js` is a route handler that reads the header per request and writes one boolean into the script it returns (`Cache-Control: private, no-store`). The page stays static; the country is never stored, logged or echoed |
| "Default consent set before gtag loads"                                   | `next/script` `afterInteractive` inserts every external script as an async `<script>` (`node_modules/next/dist/client/script.js`), so two of them run in whichever order they arrive            | The gtag.js `<Script>` is rendered only after the init script's `onReady`. Defaults always reach the dataLayer before `config` and before gtag.js exists                                                                                                                                         |
| Enhanced measurement "page views ON, including browser-history events"    | Google: history-based page views are sent "even if you set `send_page_view: false`" and use the raw `location.href`; they would also fire after a client navigation to a page off the allowlist | Code sends every `page_view` itself, with the sanitised URL, only on allowlisted routes. GA admin: page views ON, **"Page changes based on browser history events" OFF** (otherwise every SPA page is counted twice and unsanitised). Client-side navigation is still measured — by our code     |
| Consent banner "shown only where consent is required"                     | Consent Mode "advanced" loads gtag.js everywhere and sends cookieless pings before consent                                                                                                      | Privacy-first: where the hint says consent is required, gtag.js is **not requested at all** until "Allow analytics". The `region` defaults still ship, for visitors Google places in the EEA/UK/CH that the hint did not                                                                         |
| `sign_up` on the signup success screen "if marketing-scope"               | `/signup` is on the nonce policy (ADR 059), off the allowlist                                                                                                                                   | Not tracked client-side. Documented Measurement Protocol follow-up in `docs/operations/analytics.md`                                                                                                                                                                                             |
| `begin_checkout` "if a marketing page links into checkout"                | `Pricing.tsx` links "Buy Lifetime Pro" and "Buy founding access" to `/dashboard/billing`                                                                                                        | `begin_checkout` fires on a click of any same-origin anchor to `/dashboard/billing` from a tracked page                                                                                                                                                                                          |
| `tool_scan_completed`                                                     | s96 is unmerged; s98's calculator has no scan                                                                                                                                                   | Fired once per page view when the visitor's own inputs produce a settled result (the calculator's debounced URL sync); `tool_slug` from `TOOL_SLUG`. Documented hook for s96                                                                                                                     |
| s96 report pages `/tools/<slug>/r/<id>`                                   | Nonce policy (s96's ADR 062, merged)                                                                                                                                                            | ADR 069: no analytics on reports — the allowlist excludes `/tools/<slug>/r/…`, and a test pins that it never overlaps the nonce policy. `tool_scan_completed` fires from `ToolScanForm` on the tool page when a scan succeeds. UUID path segments are still redacted as a second line            |
| Analytics doc says "No visitor analytics"                                 | Launch kit §10 and §12                                                                                                                                                                          | Updated in the same commit                                                                                                                                                                                                                                                                       |

## CTO decisions

1. **One allowlist**, `src/lib/analytics/google-analytics/routes.ts`: `isAnalyticsRoute(pathname)`.
   Segment-exact (like `usesNoncePolicy`): `/`, `/try` (exact — never `/try/rcf-try.js`),
   `/pricing`, `/privacy`, `/terms`, `/demo`, and `/compare`, `/tools`, `/blog`, `/docs` with
   everything below them except `/tools/<slug>/r/…`. Everything else is false. Middleware asks
   this helper for the incoming document; the shell, runtime and footer ask
   `isAnalyticsPage(currentPath, documentPath)`, which applies the same helper to both paths
   (ADR 069).
2. **Measurement id** `NEXT_PUBLIC_GA_MEASUREMENT_ID`, Production only on Vercel. Validated
   against `^G-[A-Z0-9]{4,20}$`; anything else means "GA off". Off → no script, no CSP change,
   no banner, no footer link.
3. **Consent** (`consent.ts`):
   - `CONSENT_REQUIRED_REGIONS`: EU 27 + IS, LI, NO + the EU outermost regions that geolocate
     under their own ISO code (AX, GF, GP, MF, MQ, RE, YT) + GB + CH.
   - `CONSENT_REQUIRED_SUBDIVISIONS`: `CA-QC` (ADR 069).
   - `isConsentRequiredCountry(code, region)`: true for those countries, Quebec, an unknown
     Canadian province, and a missing, malformed or unassigned country code (fail closed: local,
     CI and any non-Vercel host ask first).
   - Defaults: `{ad_storage, ad_user_data, ad_personalization, analytics_storage: denied,
region: [...]}` then the visitor's own `{ads: denied, analytics_storage: hint ? denied :
granted}`. Ads are denied everywhere, always.
   - `url_passthrough: false`, `ads_data_redaction: true`.
   - Choice cookie `rcf_analytics_consent=granted|denied`, first-party, `Max-Age=15552000`
     (180 days), `Path=/`, `SameSite=Lax`, `Secure` on https. Read client-side.
4. **Init route** `src/app/analytics/gtag-init.js/route.ts`: dynamic, 404 when GA is off, JS with
   `nosniff`, `private, no-store`. Body is built by `buildGtagInitScript({ consentRequired })` from
   constants only — no request value is reflected. Sessionless in the middleware.
5. **Client** `src/components/analytics/GoogleAnalytics.tsx` (a shell in the root layout) and
   `GoogleAnalyticsRuntime.tsx` (its own chunk, fetched by a plain `import()` in
   `load-runtime.ts` after hydration and mounted in `startTransition`, so the banner and the gtag
   runtime stay out of the bundle every page hydrates with and never render as a long task — TBT,
   see T9). The footer's "Cookie settings" dispatches from the import-free `cookie-settings.ts`:
   - renders nothing when GA is off or the route is off the allowlist;
   - after mount, loads the init script; on `onReady` decides: load gtag.js now (no consent
     needed, or granted) or show the banner (consent needed, no choice);
   - `gtag('config', id, { send_page_view: false, allow_google_signals: false,
allow_ad_personalization_signals: false })`, then one `page_view` per allowlisted pathname;
   - leaving the allowlist by client navigation sets `window['ga-disable-<id>'] = true` (Google's
     documented opt-out flag), returning clears it;
   - Decline after Allow: consent update denied, the disable flag, `_ga`/`_ga_*` cookies deleted.
6. **Events** (`gtag.ts`): typed `track(event, params)`, a no-op unless analytics is active.
   Params are slugs (`^[a-z0-9][a-z0-9_-]{0,63}$`) or dropped, so an email, a URL or a query
   string can never be a value. Every event carries the sanitised `page_location`.
   - `generate_lead` {cta_location}: click on a same-origin anchor to `/signup`.
   - `begin_checkout` {cta_location}: click on a same-origin anchor to `/dashboard/billing`.
   - `try_started`: `/try` sample preview became active.
   - `tool_scan_completed` {tool_slug}: calculator result settled from the visitor's inputs, once
     per page view.
   - `cta_location` from the nearest `data-cta-location`, else header/footer/section id.
7. **`page_location`** (`page-location.ts`): drop the fragment (so `#rcf_edit=` never leaves),
   drop every query key but `utm_*`, drop a `utm_*` value containing `@`, cap values at 100
   characters, replace UUID path segments with `[id]`. `utm_*` are kept only on the first page view
   of a document: a client navigation is internal and its UTMs would overwrite the session's real
   campaign.
8. **CSP**: `buildContentSecurityPolicy({ ..., analytics })` adds, on the static policy only:
   script-src/script-src-elem `https://www.googletagmanager.com`; connect-src
   `https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`;
   img-src `https://*.google-analytics.com https://*.googletagmanager.com`. The middleware passes
   `analytics` only for an allowlisted path with a valid id. A nonce request ignores the flag.
9. **Banner** (`ConsentBanner.tsx`): fixed bottom, `data-theme="light"`, composed from `Button`
   and card tokens, `shadow-md` (it floats). A labelled `region`; "Allow analytics" and "Decline"
   at equal weight; Escape closes only when a choice already exists; reopening from "Cookie
   settings" moves focus to it and closing returns focus to the trigger. A spacer of the banner's
   height at the end of the document reserves its space; inserting it shifts nothing above.
10. **Footer** "Cookie settings" button (Legal column), only when GA is configured.
11. **Privacy page** §6 rewritten from code facts; Google added to §3.2.

## Tasks

- [x] T1 Plan, research folded in (this file).
- [x] T2 Unit tests then code: routes, measurement id, consent, init script, page location, gtag.
- [x] T3 Route handler + middleware sessionless entry, tests.
- [x] T4 CSP builder + middleware wiring, tests (`content-security-policy.test.ts`,
      `middleware-csp.test.ts`).
- [x] T5 `GoogleAnalytics` + `ConsentBanner` + footer button, component tests (keyboard, screen
      reader).
- [x] T6 Events: CTA attributes, `/try`, calculator.
- [x] T7 Privacy page, legal tests.
- [x] T8 Playwright `e2e/google-analytics.spec.ts` (googletagmanager stubbed), `csp.spec.ts`
      updated; CI e2e and Lighthouse jobs build with a fake id; strict count recomputed.
- [x] T9 Lighthouse before/after on the 8 comparison routes. Before: main's CI run 38194772674 (TBT 172–185 ms). First PR run 38217319595 failed TBT (187–210 ms); after the fix, run 38220513115 passes (TBT 92–103 ms). Local runs were meaningless at a load average of 100–400 from other agents.
- [x] T10 Docs: `docs/operations/analytics.md`, ADR 063 + superseding ADR 069, launch kit §10/§12,
      stories entry, review self-check.

## Out of scope

Server-side `sign_up` (Measurement Protocol) — documented follow-up. Internal-traffic rule (the
owner's IP is not known to be stable). Any change to the nonce policy.

## Approved release integration — 2026-10-12

The owner asked to finish the analytics release and had already authorized merging PR #94.
Integrated released `origin/main` `2b3f864abcff2f24398a42cabf33cc9aa5dd057a` into approved
analytics head `c0243682b0f15aa794d7dc14186baf31e01bf099`. The only conflict was the independent
s107 and s82 additions in `docs/stories.md`; both entries are retained verbatim. No runtime
behavior, dependency or migration was changed by conflict resolution.

- Every non-stories path changed by the two released stories matches `origin/main` byte for byte
  (69 paths checked).
- Every non-stories analytics path matches the approved analytics head byte for byte
  (73 paths checked before this evidence appendix).
- Node 24.14.0 focused validation passed 23 suites and 586 tests, including analytics routing,
  consent, sanitized events, runtime, footer, tool scan, calculator, try flow, CSP, privacy and
  CI contract checks. `git diff --cached --check` passed.
- Fresh integration review, normal hooks and hosted exact-head checks remain release gates.
  This evidence does not claim Google event receipt or production deployment.
