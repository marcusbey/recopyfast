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
- CI: the e2e and Lighthouse jobs build with the fake id `G-E2ETEST000`. Playwright strict count
  in `playwright.config.ts`, `ci.yml` and the contract test: 94 → 99 on the first PR head, 102
  after merging s96 (`main` 97 + 5), **104** with the independent review's two e2e tests (`main`
  97 + 7; `CI=true npx playwright test --list`: 104 total, expected 104).
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
| Playwright: gtag with zero CSP violations; dashboard never requests it; Google stubbed | `e2e/google-analytics.spec.ts` (7 tests since the independent review's fixes). The gtag stub fires a beacon, a fetch and an image at GA hosts so connect-src/img-src are exercised for real |
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
6. **Merged with s96 (`c905292`).** Architect decision: s96's scan reports carry no analytics.
   `isAnalyticsRoute` excludes `/tools/<slug>/r/…` (test: no path is both allowlisted and
   nonce-policy); `ToolScanForm` sends `tool_scan_completed` (slug only) on the tool page when a
   scan succeeds, before the report opens; `ToolCta` is tagged `tool_cta`. /privacy says reports
   are not measured. Playwright count 97 (main) + 5 = 102; 104 after the independent review's
   fixes (+2 e2e tests).
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
- `CI=true npx playwright test --list`: 99 total (expected 99) on that head; 104/104 after the
  independent review's fixes (see "Fixes after the independent review").
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

## Fixes after the independent review (4e068e9)

Implementer's record, written after the review below; the review and its gate lines are kept
unchanged. Decisions on F1 and F3 are the architect's (2026-10-12).

| Finding | Fix | Pinned by |
|---|---|---|
| **F1 major** — GA loaded into a document whose CSP did not allow it | `isAnalyticsPage(pathname, documentPathname)` in `routes.ts`: the current path AND the path the document was loaded on must both be allowlisted. `getDocumentPathname()` (`document-path.ts`, new) reads it once at module evaluation (root layout, hydration, before any client navigation): the navigation entry's URL (unchanged by `pushState` — checked in Chromium and WebKit), else `location.pathname` at that moment; null on the server. The shell, the runtime and the footer all gate on it | `routes.test.ts` (14 cases), `document-path.test.ts` (5), `GoogleAnalytics.test.tsx` (9: `/login`→`/terms`, `/signup`→`/privacy`, `/edit`→`/`, dashboard→`/docs/install`, report→`/tools`, `/settings`→`/`, `/auth/error`→`/`, a walk through four pages, unknown document), `GoogleAnalyticsRuntime.test.tsx` (3); e2e "never loads Google Analytics into the /login document, after a client navigation to /terms and back" |
| F2 — M6, M18, M19 bit nothing | Tests only: `readConsentHint` without or with a malformed `__rcfAnalytics` (6 cases); landing `page_referrer` from token-bearing same-origin referrers (`/edit?rcf_edit_token=…`, `/dashboard/sites/<uuid>/billing?session_id=…`, `/auth/confirm?token_hash=…&email=…`) and a cross-origin one; `/compare` → `/blog` sends a second page view | `GoogleAnalyticsRuntime.test.tsx`, `gtag.test.ts`; e2e "sends one page view per client navigation between marketing pages" (`/` → header "Blog": a second `page_view`, `page_referrer` the landing page, same document, gtag.js fetched once). `/pricing` redirects to `/#pricing`, so it cannot be the second page |
| F3 — pseudo country codes failed open; Quebec | Consent required unless the code is one of ISO 3166-1's 249 assigned codes (list checked against CLDR region names): XX, ZZ, T1, A1, A2, O1, EU, AP, QO, AA, XA, UK… all ask. Quebec (Law 25): the init route also reads `x-vercel-ip-country-region`; `CA` asks unless the province is a known non-Quebec one (missing or unknown → asks); Google's regional default gains `CA-QC`. ADR 063, `analytics.md` and `/privacy` ("…Switzerland and Quebec… When it cannot tell, it asks.") updated | `consent.test.ts`, `route.test.ts`, `init-script.test.ts`, `privacy-analytics.test.tsx` |
| F4 — banner misdescribed state outside the consent regions; cookie domains untested | The runtime passes the choice in effect (`choice ?? (hint.consentRequired === false ? "granted" : null)`): copy per state ("May we…" / "Google Analytics is on… Decline turns it off and deletes them." / "Google Analytics is off…"), `aria-pressed` and the close button/Escape follow it. Cookie deletion extracted as `googleAnalyticsCookieDeletions(cookieHeader, hostname)`: host-only plus every dotted parent (`.recopyfa.st` from `recopyfa.st` and `www.recopyfa.st`), GA's cookies only | `ConsentBanner.test.tsx` (new), `GoogleAnalyticsRuntime.test.tsx`, `gtag.test.ts` (5) |
| F5 — dead "Cookie settings" off the allowlist | The footer renders it after mount only, and only where `isAnalyticsPage(usePathname(), getDocumentPathname())` and an id: not on reports, `/settings`, or a marketing page inside an app document. Not in the server HTML, so hydration matches | `Footer.test.tsx` (5 new cases incl. `renderToString`); the F1 e2e asserts it absent on `/terms` inside the `/login` document |
| F6 — vacuous Escape test | Escape now pressed with focus on "Allow analytics". Through the runtime that still cannot fail (the first-visit banner stays up whatever Escape does), so the contract is pinned on the banner itself | `ConsentBanner.test.tsx` (M21 now red) |
| F7 — stale counts | Self-check above corrected. Strict count 104 = `main` 97 + 7 in `playwright.config.ts`, `ci.yml` (×8) and `playwright-ci-contract.test.ts` | `CI=true npx playwright test --list`: 104 total (expected 104) |

### F1 reproduced in a browser

Production build with `G-E2ETEST000`, `next start`, Chromium, `x-vercel-ip-country: US`, Google
stubbed. `/login` (nonce policy) → click "Terms of Service" (same document) → wait 6 s:

- guard removed (`isAnalyticsPage` returning `isAnalyticsRoute(pathname)`): `/analytics/gtag-init.js`
  fetched, `gtag/js?id=G-E2ETEST000` requested **and executed**, `dataLayer` 8 entries, "Cookie
  settings" shown, **no script-src violation** — `'strict-dynamic'` admitted both scripts, as the
  review predicted (the probe's stub sends no hits, so `connect-src` was not exercised there). The
  new e2e failed on it (`requested`: gtag.js and the stub's three hits).
- with the fix: nothing fetched, no `dataLayer`/`gtag`, no Google script element, no "Cookie
  settings"; the e2e passes, Back to `/login` included.

### Mutations (each restored; `git diff` identical before and after the run)

| Neutralised | Red |
|---|---|
| F1: `isAnalyticsPage` ignores the document | 22 (4 suites); e2e red on a build |
| F1: shell passes the current path as the document's | 9 |
| F1: runtime passes the current path as the document's | 3 |
| F1: `getDocumentPathname` reads the current location | 5 |
| F1: navigation entry ignored | 1 |
| F5: footer passes the current path as the document's | 2 |
| F5: footer renders before mount | 1 |
| M6: missing hint = no consent needed | 1 |
| M18: landing `page_referrer` = raw `document.referrer` | 5 |
| M19: page-view effect without `pathname` | 1 |
| M21: Escape dismisses with no choice in effect | 1 |
| F3: any two letters is a country | 8 |
| F3: Quebec not asked | 12 |
| F3: `CA-QC` missing from Google's regional default | 3 |
| F3: route ignores the province header | 1 |
| F4: cookie deletion host-only | 2 |
| F4: banner gets the stored choice only | 1 |
| F4: banner copy ignores the choice | 4 |

### Verification (local, 2026-10-12)

- `npx jest --ci`: 499 suites passed (2 skipped), 7,290 tests passed, 38 skipped. One suite
  first failed on the footer change: `src/app/blog/[slug]/__tests__/page.test.tsx` mocks
  `next/navigation` with `notFound` only, and the footer now calls `usePathname`; the mock gained
  `usePathname: () => ""`, as in `jest.setup.js`.
- `npm run type-check`: clean. `npm run lint`: 0 errors; 34 warnings, none in a changed file
  (`ToolCta.tsx`'s two are `main`'s, shifted one line). Prettier: changed files clean.
- `npm run build` with `G-E2ETEST000`: `/`, `/compare`, `/blog`, `/privacy`, `/terms` static (`○`),
  `/analytics/gtag-init.js` and `/login` dynamic (`ƒ`).
- `node scripts/build-embed.mjs --check`: up to date, 45,818 / 33,059 B (unchanged).
- `CI=true npx playwright test --list`: 104 total (expected 104).
- Playwright against that build (`next start`): `google-analytics.spec.ts` 6/6 and `csp.spec.ts`
  4/4 (the signed-in test of each needs the PG17 Supabase stack: CI); `public-pages`,
  `comparison-routes`, `performance`, `tools-maintenance-cost`, `try-preview`,
  `hero-demo-mobile`, and `tools.spec.ts`'s hub test: 19/19. `tools.spec.ts`'s scan tests need
  Supabase (`fetch failed` locally): CI.

### Not done here

- GA admin "Granular location and device data collection" was not changed for Canada when Quebec
  joined the consent rule (no browser work in this pass); recorded in `analytics.md`. The privacy
  page's city-level sentence names the EEA, the UK and Switzerland only, so it stays true.
- The review's other could-not-verify items (cookie deletion on the real domain, `sendBeacon` at
  unload, Lighthouse with gtag.js loaded, the banner on screen) are unchanged.

## Independent review of 4e068e9

Fresh-context reviewer, 2026-10-12. Read-only on code. Diff reviewed: `origin/main...4e068e9` (66
files; local `main` is stale at `f4ecaa8`, `origin/main` is `c905292`, the merge base).

### What was run

- `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx jest src/lib/analytics src/components/analytics src/lib/security --silent`:
  12 suites, 307 tests, all passed.
- Touched paths (analytics, security, middleware CSP/matcher, privacy, layout, tools, try, ci,
  app): 66 suites, 1,177 tests, all passed.
- Full `npx jest --ci`: 497 suites passed (2 skipped), 7,182 tests passed, 38 skipped.
- `gh pr checks 94`: every check green on head `4e068e99` (run 38224775638's `headSha` matches):
  Lint/Test/Build, type-check, E2E (Playwright), built embed fixture, Comparison Lighthouse,
  Vercel.
- Every import and API in the diff was opened: `next/script` `onReady` and its App Router
  `ReactDOM.preload` + `createElement('script')` path (`node_modules/next/dist/client/script.js`,
  Next 16.3.8), `React.startTransition`, `Button` `variant="outline"|"ghost"` and
  `size="icon-sm"` (`src/components/ui/button.tsx:39,47,59`), `TOOL_SLUG`
  (`src/lib/tools/maintenance-cost/copy.ts:13`), `usesNoncePolicy` and the nonce policy's
  `'strict-dynamic'`. No invented reference.

### Mutations (each restored, `git diff --exit-code` clean after each)

| # | Neutralised | Red |
|---|---|---|
| M1 | `isConsentRequiredCountry` fails open on a missing/malformed hint | 10 |
| M2 | CSP builder: drop `!nonce` | 1 |
| M3 | `sanitizePageLocation` keeps every query key | 4 |
| M4 | `utm_*` kept on client navigations | 1 |
| M5 | allowlist no longer excludes `/tools/<slug>/r/…` | 6 |
| M6 | `readConsentHint` fails open (missing `__rcfAnalytics` = no consent needed) | **0** |
| M7 | gtag.js `<Script>` rendered before `onReady` | 5 |
| M8 | Decline no longer deletes `_ga*` | 1 |
| M9 | event params accept any string | 1 |
| M10 | middleware adds GA hosts without `isAnalyticsRoute` | 6 |
| M11 | init route `public, max-age=3600` | 1 |
| M12 | init route removed from `isSessionlessPath` | 1 |
| M13 | runtime unmount no longer raises the opt-out flag | 1 |
| M14 | calculator marks its event sent even when `track` returned false | 1 |
| M15 | `ToolScanForm` no longer tracks | 1 |
| M16 | UUID path segments not redacted | 1 |
| M17 | `utm_*` values containing `@` kept | 1 |
| M18 | landing `page_referrer` = raw `document.referrer` | **0** |
| M19 | page-view effect loses its `pathname` dependency (no page view on a client navigation) | **0** |
| M20 | stored "denied" ignored outside the consent regions | 2 |
| M21 | banner Escape dismisses without a stored choice | **0** (vacuous test, see F6) |

### Findings

**F1 — major. Google's script loads into documents served under the nonce (app) policy, and
into static documents whose CSP has no Google host.**
`src/components/analytics/GoogleAnalytics.tsx:33` gates on the *current* pathname only; the CSP
is a property of the *document*, chosen by the middleware from the path the document was loaded
on. App → marketing crossings are client navigations: `src/app/login/page.tsx:22,64,68` and
`src/app/signup/page.tsx:22,48,52` (`<Link href="/">`, `/terms`, `/privacy`),
`src/components/dashboard/SiteInstallationCard.tsx:200` (`<Link href="/docs/install">`), and the
report page's `Header`/`Footer` links (`src/components/layout/Header.tsx:68`). Scenario: a
visitor outside the EEA on `/login` clicks "Terms" → the shell mounts the runtime → `next/script`
inserts `/analytics/gtag-init.js`, then gtag.js, with `document.createElement('script')` from a
trusted chunk → the nonce policy's `'strict-dynamic'` allows both whatever the host list says
(the "builder ignores the flag under a nonce" guard does not keep Google out of that document).
Hits are then refused by the nonce policy's `connect-src` (lost page views, CSP violations), and
when the visitor presses Back, `/login` re-renders client-side in a document where gtag.js stays
resident (inert behind `ga-disable-<id>`) while they type credentials. This contradicts ADR 063
decision 1 ("it never overlaps the nonce policy"), ADR 059's reason for putting `/login`,
`/signup`, `/edit` under the nonce policy, and the privacy page's "It never runs … on our sign-in
and sign-up pages". No data leaves (blocked `connect-src`, opt-out flag, sanitised URL), so not
critical. The converse — a static document loaded off the allowlist (`/settings`, `/auth/error`,
any 404) client-navigating onto `/` — requests gtag.js under a policy without
`www.googletagmanager.com`: blocked, lost data, console violations.
Fix: also require that the *document* was loaded on an allowlisted path — capture
`window.location.pathname` once per document on the client (module scope in the shell, or
`performance.getEntriesByType("navigation")[0].name`) and gate on
`isAnalyticsRoute(documentPath) && isAnalyticsRoute(pathname)`. Pin it with a shell test (landing
`/login`, pathname becomes `/terms` → runtime never fetched) and an e2e (`goto("/login")`, click
"Terms", assert no `googletagmanager` request and no CSP violation). Alternative: make every
app → marketing crossing a native anchor and extend `app-document-boundary-links.test.ts` to that
direction.
Not run in a browser (the worktree's `.next` was built without an id, and a rebuild was not
attempted at a load average of ~100); established from Next 16.3.8's `script.js` and CSP3's
`'strict-dynamic'` semantics.

**F2 — minor. Three guards no test bites (M6, M18, M19: 0 red).** The code is correct by
reading; nothing would catch its regression.
- `src/lib/analytics/google-analytics/gtag.ts:132-136`: the landing `page_referrer` is the
  sanitised `document.referrer`. Under `Referrer-Policy: strict-origin-when-cross-origin`
  (`src/middleware.ts:339`) a same-origin referrer carries its full query string, e.g.
  `/dashboard/billing?session_id=…`, `/edit?rcf_edit_token=…`, `/auth/confirm?…`. Neither unit nor
  e2e sets `document.referrer`. Add a `trackPageView` case with a token-bearing same-origin
  referrer.
- `src/components/analytics/GoogleAnalyticsRuntime.tsx:111-113`: a page view per client
  navigation between two allowlisted pages (the brief's "client nav, back/forward" path, and the
  reason GA's history page views could be turned off) rests on `pathname` in the deps. The only
  navigation test goes on → off → on, which flips `isActive` anyway; the e2e counts one page view.
  Add a `/compare` → `/blog` rerender case expecting two `trackPageView` calls.
- `GoogleAnalyticsRuntime.tsx:27-36`: `readConsentHint`'s fail-closed branch (no
  `__rcfAnalytics` → ask first). Add a case that fires `onReady` without the global.

**F3 — minor. Pseudo country codes fail open.** `src/lib/analytics/google-analytics/consent.ts:91-93`
treats any two letters outside the list as "no consent needed". GeoIP sources use `XX`/`ZZ`
(unknown), `T1` (Tor), `A1`/`A2` (anonymous proxy/satellite), and legacy `EU`/`AP`. Vercel's
documentation does not say what it sends for an unlocatable IP, so this is unverified — but the
fail-closed promise ("missing or malformed → consent required") should cover "not a real
country". Fix: fail closed on a small reserved set, or on anything outside an ISO 3166-1 list.

**F4 — minor. The banner misdescribes state for visitors outside the consent regions.** Opened
from "Cookie settings" with no stored choice (`GoogleAnalyticsRuntime.tsx:166`,
`currentChoice={choice}` = `null`), it says "It sets cookies only if you allow it"
(`src/components/analytics/ConsentBanner.tsx:103-105`) although `_ga` is already set, shows
neither answer pressed although analytics is on, and has no close button or Escape
(`canDismiss` false): a visitor who opened it voluntarily must answer to close it. Fix: pass the
effective state (`choice ?? (hint.consentRequired ? null : "granted")`) for `aria-pressed` and
`canDismiss`, and word the sentence for both cases.

**F5 — minor. "Cookie settings" is a dead button on the free-tool report pages.**
`src/components/layout/Footer.tsx:70,153` renders it whenever an id is configured; the report page
and its not-found render this footer (`src/app/tools/[slug]/r/[id]/page.tsx:134`) but are off the
allowlist, so no listener exists and the click does nothing. Fix: also gate on
`isAnalyticsRoute(usePathname())`, or fall back to `/privacy#analytics`.

**F6 — minor. A vacuous banner test.** "does not take focus on first display, and Escape does not
dismiss it" (`src/components/analytics/__tests__/GoogleAnalyticsRuntime.test.tsx:244-255`)
presses Escape with focus on `<body>`; the panel's `onKeyDown` never sees it (M21: 0 red). The
behaviour still holds because `needsChoice` keeps the banner up. Focus a banner button first.

**F7 — minor (docs). Stale counts in this file's self-check:** "Playwright 94 → 99" and
"`--list`: 99 total (expected 99)" against 102 in `ci.yml`, `playwright.config.ts` and
deviation 6.

### The brief's six questions

1. **Privacy.** Every `page_view` goes through `trackPageView`: origin + path, fragment always
   dropped, query dropped except landing `utm_*` (no `@`, 100 chars), UUID segments → `[id]`;
   `set` carries the same `page_location`/`page_referrer` to later and automatic events.
   Back/forward and client navigations re-run it (by reading; see F2). Event params are slug-only
   and per-event keyed; the scanned URL and calculator figures never reach a param; no
   `document.title` write exists and titles are static per route. Referrers from app pages are
   sanitised (untested, F2). Outbound-click/file-download events carry link URLs of links the
   site authors, none built from visitor input on allowlisted pages.
2. **Consent.** Region = `x-vercel-ip-country`, read per request by the init route, reduced to one
   boolean, never echoed or stored; missing/malformed → consent required (pseudo codes: F3).
   Google's own `region` default denies everything in the same 39 codes. Ads storage, user data
   and personalisation are denied everywhere. Choice: first-party cookie, 180 days, `SameSite=Lax`,
   `Secure` on https. Decline: consent update denied, `ga-disable-<id>`, `_ga`/`_ga_*`/`_gid`/`_gat*`
   deleted on the host and each parent domain. Banner: labelled/described region, native buttons
   of equal weight, focus moved and returned on reopen (F4, F6).
3. **CSP.** Only the static policy gains hosts, only for an allowlisted path with a valid id;
   nonce paths, `/dashboard`, `/edit`, `/login`, `/signup`, `/embed/*`, `/settings`, `/auth/*`,
   the API and report pages get none (unit + e2e). No `'unsafe-inline'` added (the static policy
   already had it; the nonce policy is unchanged). `connect-src` additions are exactly Google's
   documented GA4 set. Header-level only — see F1 for the document-level gap.
4. **Init route.** `force-dynamic`, `application/javascript; charset=utf-8`, `nosniff`,
   `private, no-store`, 404 without an id; body built from constants and one boolean, nothing from
   the query, headers or env value reflected.
5. **Performance.** Runtime chunk via `import()` after hydration, mounted in `startTransition`,
   allowlisted routes only; both scripts `afterInteractive`; gate green (run 38220513115 and on
   this head). The gate takes the consent-required path only (see below).
6. **Tests.** Meaningful, behaviour-level, and most guards bite (17 of 21 mutations red); the gaps
   are F2 and F6.

### Could not verify, and what a human should do instead

- **F1 in a real browser.** Build with `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-E2ETEST000`, `next start`,
  open `/login` with `x-vercel-ip-country: US`, click "Terms", watch DevTools Network for
  `googletagmanager.com` and the console for CSP violations, then press Back.
- **Cookie deletion on the real domain.** jsdom only proves host-only deletion. In production:
  allow, confirm `_ga` on `.recopyfa.st`, decline, confirm it is gone.
- **`tool_scan_completed` surviving `location.assign`.** Relies on gtag.js flushing with
  `sendBeacon` at unload; only mocked. Check in GA Realtime/Tag Assistant after one real scan.
- **GA admin settings** (history page views off, user-provided data capture off, Google signals
  off, redaction keys). The URL privacy depends on "Page changes based on browser history events"
  staying off: re-read it in the property; it is not enforceable from code.
- **Performance for visitors outside the EEA.** The Lighthouse gate never loads gtag.js. Run it
  once with `--extra-headers '{"x-vercel-ip-country":"US"}'` (Google stubbed or real) to see TBT
  with gtag.js.
- **Banner on screen.** Never rendered visually: contrast, and whether the fixed banner hides a
  focused element while a keyboard user tabs the page before answering (WCAG 2.2 SC 2.4.11; a
  `scroll-padding-bottom` while it shows would prevent it). Tab through `/compare` on a phone-size
  viewport.
- **Lawfulness of "granted by default" outside EEA/UK/CH.** The list matches Google's EU user
  consent policy scope. Not legal advice and not decidable from code: Quebec's Law 25 (the
  business is in Canada; Quebec geolocates as `CA`, Vercel's `x-vercel-ip-country-region` would
  say `QC`), Brazil's LGPD, and GDPR-like regimes in Jersey, Guernsey, the Isle of Man and
  Gibraltar are owner/legal decisions.
- **Vercel's value for unlocatable IPs** (F3): not documented; check a request through a Tor exit.

Max severity: major
Ship allowed: no
