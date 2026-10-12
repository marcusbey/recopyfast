# Review — s107-google-analytics

Implementer's self-check, written before the independent review. It is evidence for the
reviewer, not the gate.

## What was built

- **GA4 property** "RecopyFast" (558499366) in the owner's existing `marcusbey` account, web
  stream `https://www.recopyfa.st` (measurement id `G-DQ…`), every admin setting applied and read
  back: `docs/operations/analytics.md`. `NEXT_PUBLIC_GA_MEASUREMENT_ID` in Vercel, Production only.
- `src/lib/analytics/google-analytics/`: `routes.ts` (the one allowlist), `measurement-id.ts`,
  `consent.ts` (regions, defaults, choice cookie), `init-script.ts`, `page-location.ts`, `gtag.ts`
  (the only door: `track`, page views, consent choice, click → event).
- `src/app/analytics/gtag-init.js/route.ts`: the first-party init script (country hint → one
  boolean, `private, no-store`, 404 without an id). Sessionless in the middleware.
- `src/components/analytics/`: `GoogleAnalytics` (shell in the root layout, route + id gate),
  `GoogleAnalyticsRuntime` (own chunk: plain `import()` in `load-runtime.ts`, mounted in
  `startTransition`), `ConsentBanner`. `cookie-settings.ts` (import-free) for the footer.
- CSP: `buildContentSecurityPolicy({ analytics })`, set by the middleware for allowlisted paths
  with an id; ignored under a nonce.
- Events: `data-cta-location` on 13 CTAs; `try_started` in `TryExperience`;
  `tool_scan_completed` in `CostCalculator`. Footer "Cookie settings". `/privacy` §6 and §3.2.
- CI: the e2e and Lighthouse jobs build with the fake id `G-E2ETEST000`. Playwright 94 → 99 in
  `playwright.config.ts`, `ci.yml` and the contract test (`CI=true npx playwright test --list`:
  99 total, expected 99).
- Docs: ADR 063, `docs/operations/analytics.md`, `deployment-env.md`, `.env.example`, launch kit
  §10/§12, stories entry, plan.

## Checks against the brief

| Brief | Result |
|---|---|
| Property, time zone America/Toronto, USD, web stream | Done; read back from Property details and Data streams |
| Retention 14 months | Event and user data 14 months; "reset on new user activity" off (so /privacy can say a visit does not extend it) |
| Google signals off, ads personalisation off | Signals never turned on; ads personalisation allowed in 0 of 307 regions; code sends `allow_google_signals: false`, `allow_ad_personalization_signals: false` |
| Granular location/device off for the EEA | Off in 39 regions (EU 27, IS, LI, NO, GB, CH, AX, GF, GP, MF, MQ, RE, YT), on in 268 |
| Enhanced measurement | Page views on (page loads), scrolls on, outbound on, site search off, video off, file downloads on, forms off. **Browser-history page views off** — deviation 1 |
| Key events | `sign_up`, `generate_lead`, `begin_checkout`, `tool_scan_completed` (pre-created "with code", no default value). Objective defaults `close_convert_lead`, `qualify_lead` unmarked; `purchase` is Google's built-in and cannot be unmarked |
| Custom dimensions | `tool_slug`, `cta_location`, event scope |
| Referral exclusions | `checkout.stripe.com`, `js.stripe.com` |
| Internal traffic | Skipped: the owner's IP is not known to be stable. Developer Traffic filter created, state Testing |
| Vercel Production only | `vercel env ls`: `NEXT_PUBLIC_GA_MEASUREMENT_ID … Production` |
| Allowlist helper with tests | `routes.test.ts`: 55 cases incl. segment near-misses and malformed paths |
| Consent Mode v2 defaults, region list, `url_passthrough`, `ads_data_redaction` | `consent.test.ts`, `init-script.test.ts` (executed in a V8 context), e2e |
| Banner: only where required, region hint never stored, 6-month cookie, footer reopens, no CLS | Fixed bottom + in-flow spacer at the end of the document; e2e checks the cookie's `expires`; component tests cover keyboard, focus return, Escape, accessible name/description, live region |
| No inline script, `next/script` + first-party init | No `dangerouslySetInnerHTML`/inline added; `csp.spec.ts` marketing test still passes |
| CSP exactly GA4's hosts, nothing on the nonce policy | `content-security-policy.test.ts`, `middleware-csp.test.ts` (11 non-marketing paths, malformed id) |
| Playwright: gtag with zero CSP violations; dashboard never requests it; Google stubbed | `e2e/google-analytics.spec.ts` (5 tests). The gtag stub fires a beacon, a fetch and an image at GA hosts so connect-src/img-src are exercised for real |
| `afterInteractive` | Yes, both scripts; the runtime itself is code-split (deviation 3) |
| Typed `track()`, no PII, no query strings, `rcf_edit` stripped | `gtag.test.ts`, `page-location.test.ts` |
| `sign_up` | Not client-side (`/signup` is app surface); Measurement Protocol follow-up documented |
| Privacy page | `privacy-analytics.test.tsx`; s54 tripwires untouched (no "cookie consent", no "geolocation", no "anytime") |

## Deviations and notes for the reviewer

1. **Browser-history page views are off in GA; our code sends them.** Google documents that
   history page views fire "even if you set `send_page_view: false`" and use `location.href`: with
   them on, every SPA page view is double-counted, Google's copy carries the calculator's
   `?sites=…&rate=…`, and it fires before React can switch GA off on a page outside the
   allowlist. Reverting needs the GA checkbox AND the code changed together.
2. **Basic consent mode where consent is required.** gtag.js is not requested at all before
   "Allow analytics" (no cookieless pings). The `region` defaults still ship.
3. **The runtime is its own chunk**, fetched by a plain `import()` after hydration and mounted in
   `startTransition`. s17's gate measured TBT at 172–185 ms against a 200 ms limit on `main`; see
   "Lighthouse" below for the run that went over and the fix.
4. **Additions beyond the brief, all privacy-tightening:** `_ga` cookie lifetime 13 months
   (`cookie_expires`); GA's "Allow user-provided data capabilities" (on by default, auto-detecting
   emails/phones/addresses on the page) turned off; GA URL-query redaction for `rcf_edit_token`,
   `rcf_token`, `rcf_handoff`, `email`; `page_referrer` sanitised like `page_location`; UUID path
   segments redacted (s96 report URLs are capabilities); landing-only `utm_*`.
5. **Fail-closed hint.** No `x-vercel-ip-country` = consent required. Every CI spec except the GA
   spec therefore runs with the banner showing (and no gtag.js) — that is deliberate coverage.
6. **s96 rebase:** its report pages are nonce-policy (its ADR 062) and get no GA hosts. Hook and
   options in `docs/operations/analytics.md`. ADR numbering: s96 holds 062, this is 063.
7. **Design system gap:** no banner/toast primitive (gap 1). The banner composes `Button` and card
   tokens, pinned light, `shadow-md` because it floats. Not added to `docs/design-system.md`.

## Verification (local, 2026-10-12)

- `npm test -- --ci --coverage`: 465 suites passed (2 gated), 6,485 tests passed, 38 gated skips;
  coverage lines 74.28 %, branches 67.01 %, functions 71.16 %, statements 73.72 % (ratchet
  69/61/65/68).
- `npm run type-check`, `type-check:build`: clean. `npm run lint`: 0 errors (31 pre-existing
  warnings, none in changed files). `format:check`: clean.
- `node scripts/build-embed.mjs --check`: up to date, 45,818 / 33,059 B (unchanged).
- `npm run build` with the fake id: `/`, `/compare`, `/privacy`, `/try`, the calculator stay
  static (`○`); `/analytics/gtag-init.js` dynamic (`ƒ`).
- Playwright against that build (`next start`): `google-analytics.spec.ts` 4/4 non-signed-in,
  `csp.spec.ts` 4/4 non-signed-in, tools calculator, public pages, hero demo mobile, comparison
  routes, `/try` preview, performance: 26/26. The two signed-in tests (GA dashboard, CSP dashboard)
  and the Supabase-backed landing pricing tests need the PG17 Supabase stack, which the local CLI
  (2.20.5) cannot start; CI runs them.
- `CI=true npx playwright test --list`: 99 total (expected 99).
- Lighthouse: see below. Local runs were discarded: the machine's load average was 100–400 from
  other agents' work.

## Lighthouse (comparison gate, ADR 061: mobile, 8 routes, 5 runs, medians)

| Run | Perf | LCP (ms) | CLS | TBT (ms) | Gate |
|---|---|---|---|---|---|
| Before — `main` 9541589, run 38194772674 | 96–97 | 1,673–1,691 | ≤ 0.0150 | 172–185 | pass |
| First PR run (8bb0173), run 38217319595 | 95–96 | 1,684–1,706 | ≤ 0.0150 | 187–210 | **fail** (TBT on 4 routes) |
| After the fix (fb3983d), run 38220513115 | 98–99 | 1,630–1,656 | ≤ 0.0150 | 92–103 | pass |

Diagnosis from the failing run's reports (`/compare/tinacms`): a new 63 ms long task at ~4.3 s,
when the runtime chunk arrived and React rendered it in one go; the gtag runtime (`gtag.ts` with
`consent.ts` and `page-location.ts`) copied into nine page chunks because the footer imported
`openCookieSettings` from it; `next/script` (~6 KB) placed in a shared chunk on the critical path.
Fix: the footer's event moved to the import-free `cookie-settings.ts` (the gtag runtime is now only
in the runtime chunk and the `/tools` and `/try` page chunks); the runtime is fetched by a plain
`import()` and mounted, and its init-ready update applied, in `startTransition`. `next/script` is
kept, as briefed. In the passing run the post-hydration long task is gone (`/compare/tinacms`:
long tasks only the page's own and the main chunk's hydration). The drop below `main`'s TBT is
partly runner-to-runner variance (the main chunk's hydration task measured 152 ms there against
233 ms on both earlier runs); the claim is the gate, green with margin, not an improvement. The
gate takes the consent-required path (no country header): init script and banner, no gtag.js.
gtag.js itself (≈150 KB gzipped, loaded `afterInteractive` for visitors outside the EEA/UK/CH)
is not measured by the gate, which never contacts Google.

## Bot review findings

| Source | Finding | Fix |
|---|---|---|
| Devin (PR #94) | 🟡 "Early calculator completions go uncounted": a result settling before analytics was active set the once-per-page-view flag although nothing was sent | `track()` returns whether it handed the event to gtag; the calculator marks the event sent only on `true`. Tests: `gtag.test.ts` (returns false inactive / true sent), `CostCalculator.test.tsx` ("keeps the event for later when analytics was not active yet") |

## Mutations the reviewer should try

Drop the `!nonce` guard in the CSP builder; render the gtag `<Script>` before `onReady`; make
`isConsentRequiredCountry` return false for a missing header; let `sanitizeEventParams` accept
any string; remove `/analytics/gtag-init.js` from `isSessionlessPath`; add `/settings` to the
allowlist; keep `utm_*` on client navigations.

Max severity: pending (independent review)
Ship allowed: pending (independent review)
