# Research — Story s107-google-analytics

> **Retrospective artifact, 2026-10-12.** The story was planned, implemented and independently
> reviewed before this standalone research file existed. This document records source-verified
> facts from `feature/s107-google-analytics` at `12da10d`; it does not claim that `/ks-research`
> happened before the plan. The review gate in `docs/reviews/s107-google-analytics.md` remains the
> authority until a fresh reviewer reruns `/ks-review`.

No production account, Google Analytics admin page, Vercel setting or production request was
changed or re-read for this retrospective pass. The live-property observations belong to
`docs/operations/analytics.md`; the facts below come from the repository and the recorded PR
evidence.

Decision history: ADR 063 is the first accepted integration baseline. ADR 069 supersedes only its
later-refined route/document and consent clauses, preserving 063 instead of editing it in place.

## Target story

`docs/stories.md` defines one cross-cutting marketing story:

- run GA4 only on the named public marketing routes;
- ask before analytics cookies where the country or province rule requires it, while denying ads
  signals everywhere;
- keep the app, editor, API, widget, `/try` runtime and free-tool reports outside analytics;
- load no inline analytics script and keep the nonce policy unchanged;
- sanitise page locations and constrain event parameters before they reach Google;
- expose an accessible consent banner and a working footer control where that runtime exists;
- keep the comparison Lighthouse gate green;
- record the GA property settings that code cannot enforce.

The original story scores the work as complexity 3. The implementation crosses the root layout,
two CSP modes, middleware, a dynamic init route, a deferred client runtime, shared marketing UI,
several conversion surfaces, legal copy, Playwright and external GA configuration.

## Premise check

1. **The baseline had no Google Analytics integration.** `git grep` on `main` at `f4ecaa8` finds
   no `googletag`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `rcf_analytics_consent` or Google Analytics
   runtime under `src/`. The story adds the first visitor-analytics path.
2. **The root layout is the only reliable cross-route mount.** `src/app/layout.tsx` owns every
   document and now renders `GoogleAnalytics` after page content. The shell can observe client
   navigation without duplicating integration code in each marketing page.
3. **The CSP belongs to the document, not the current client route.** Middleware selects the
   policy for the original request. A `<Link>` navigation changes `usePathname()` but keeps that
   document and policy. `isAnalyticsPage(pathname, documentPathname)` therefore requires both the
   visible route and the document's first route to be allowlisted. This was a real review defect:
   `/login` to `/terms` could previously load analytics under the login document's nonce policy
   (ADR 069).
4. **Marketing prerendering and a per-request region hint conflict.** Reading `headers()` in a
   page would make static marketing pages dynamic. `/analytics/gtag-init.js` is the per-request
   boundary: it reads the Vercel country/province headers and emits only a consent-required
   boolean plus constant Consent Mode commands, with `private, no-store`.
5. **The scan report is a different security surface from its tool page.** Reports render scraped
   third-party text, their URL is a read capability, and ADR 062 puts them under the nonce policy.
   `isAnalyticsRoute` excludes `/tools/<slug>/r/…`; `ToolScanForm` records a successful scan on
   the allowlisted tool page before navigation instead (ADR 069).
6. **A footer control is useful only where the runtime listens.** The shared footer also appears
   on routes where analytics is absent. It must use the same page-and-document guard as the shell,
   otherwise `openCookieSettings()` dispatches an event with no listener. The current footer does
   that and its regression test includes a free-tool report path.

## Current implementation map

| Concern                     | Source anchor                                                                              | Verified behaviour                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route and document boundary | `src/lib/analytics/google-analytics/routes.ts`, `document-path.ts`                         | One segment-exact allowlist; reports and nonce-policy paths stay out; client navigation cannot cross a document-policy boundary into analytics                                                                |
| Configuration               | `measurement-id.ts`                                                                        | Only `G-` plus 4–20 uppercase alphanumerics enables the integration; invalid or absent means no shell, CSP hosts, banner or footer control                                                                    |
| Region decision             | `consent.ts`                                                                               | Assigned ISO country codes outside the configured consent regions may default analytics on; EEA, UK, Switzerland, Quebec, unknown/malformed codes and unknown Canadian provinces ask first; ads remain denied |
| First-party bootstrap       | `init-script.ts`, `src/app/analytics/gtag-init.js/route.ts`                                | Consent defaults are queued before gtag; request headers are reduced to a boolean and never reflected; response is JavaScript, `nosniff`, `private, no-store`; no id returns 404                              |
| Deferred runtime            | `GoogleAnalytics.tsx`, `load-runtime.ts`, `GoogleAnalyticsRuntime.tsx`                     | Runtime chunk loads after hydration only on an allowed page in an allowed document; gtag.js waits for init readiness and, where required, explicit consent                                                    |
| Consent UI                  | `ConsentBanner.tsx`                                                                        | Labelled/described region, equal-weight Allow/Decline actions, explicit effective state, close/Escape only after a choice exists, focus enters from and returns to the footer trigger                         |
| Footer access               | `Footer.tsx`, `cookie-settings.ts`                                                         | Import-free custom event reopens settings; the control renders after mount only where the guarded runtime can exist                                                                                           |
| Collection                  | `gtag.ts`, `page-location.ts`                                                              | Manual page views; fragments removed; query removed except safe landing `utm_*`; UUID segments redacted; event parameters accept slugs only; inactive tracking returns false                                  |
| CSP                         | `src/lib/security/content-security-policy.ts`, `src/middleware.ts`                         | GA hosts join only the static policy for an allowlisted request with a valid id; a nonce request ignores the analytics flag                                                                                   |
| Product events              | `Header.tsx`, `Pricing.tsx`, `TryExperience.tsx`, `CostCalculator.tsx`, `ToolScanForm.tsx` | Lead, checkout, try and completed-tool events are emitted from the visitor action that establishes them; no email, scanned URL or arbitrary text becomes an event parameter                                   |
| Disclosure                  | `src/app/privacy/page.tsx`, `docs/operations/analytics.md`                                 | Legal copy describes routes, data, cookies, retention and opt-out; the operations record separates code-enforced settings from GA-admin settings                                                              |

## Representative flow

1. Middleware receives a full marketing-page request. With a valid measurement id and an
   allowlisted path, the static CSP gains only the recorded Google script, connect and image
   hosts. A report, app route or invalid id gains none.
2. The root layout renders an inert `GoogleAnalytics` shell. After hydration it checks both the
   current path and the document's first path, then imports the runtime in a transition.
3. The runtime loads `/analytics/gtag-init.js`. That response establishes Consent Mode defaults
   and leaves `window.__rcfAnalytics.consentRequired` as one boolean.
4. If consent is required and no choice exists, the banner appears and Google receives no
   request. Allow starts analytics; Decline stores the decision and keeps Google disabled.
5. If consent is not required, analytics starts by default. Opening Cookie settings describes
   that effective granted state and lets the visitor decline. Declining raises Google's disable
   flag and deletes GA cookies for the host and parent domains.
6. Active analytics sends one sanitised page view per allowed pathname and listens for typed CTA
   events. Leaving the allowlist disables analytics; a full load on another allowed document can
   initialise it again.

## Existing tests and evidence

- Unit/component suites cover the allowlist, document-path snapshot, measurement id, country and
  province rules, init script, init route, location sanitising, typed events, banner states,
  runtime order, shell gating, footer gating and CSP construction.
- `src/components/layout/__tests__/Footer.test.tsx` names the regression from Devin's PR review:
  `/tools/website-spell-checker/r/<id>` has no Cookie settings button. The same table covers an
  app document navigated to marketing and `/settings`.
- `e2e/google-analytics.spec.ts` stubs Google and exercises consent, client navigation, report
  exclusion and the app-document boundary. `e2e/csp.spec.ts` exercises the browser policy.
- PR #94 head `12da10d` has green CI, type-check, Playwright, build, production dependency audit
  and comparison Lighthouse checks. These are branch/CI facts, not production analytics proof.
- `docs/reviews/s107-google-analytics.md` records the independent review, its mutation attempts
  and its unresolved manual checks. Its terminal gate remains `Max severity: major` / `Ship
allowed: no` until a fresh review supersedes it.

## Traps and constraints

1. **Never duplicate the allowlist.** Middleware, shell, runtime and footer must ask the same
   helper. A route added in only one place either collects without the needed CSP or exposes dead
   UI.
2. **Never gate only on `usePathname()`.** That forgets which CSP the document owns. The original
   F1 regression demonstrated that `'strict-dynamic'` can admit dynamically inserted scripts on a
   nonce document even when the host list does not name Google.
3. **Do not turn browser-history enhanced measurement back on independently.** Google would send
   raw `location.href`, count client navigation before the app can disable analytics, and duplicate
   the manual page view.
4. **Do not load gtag.js merely to send denied pings where consent is required.** This story chose
   basic, privacy-first consent: no Google request until Allow.
5. **Do not reflect GeoIP headers into JavaScript.** The route must reduce them to the fixed
   boolean. Storing or logging them would be a new privacy decision.
6. **`next/script` ordering is not dependency ordering.** gtag.js renders only after the init
   script's `onReady`; two independent `afterInteractive` scripts could race.
7. **The footer import must stay small.** Importing the analytics runtime through Footer copied it
   into marketing chunks and failed the comparison TBT gate. `cookie-settings.ts` intentionally
   has no imports.
8. **A result before analytics is active must not consume its once-per-page event.** `track()`
   returns whether it sent, and calculators mark completion only on `true`.
9. **Report exclusion is part of ADR 069's security decision.** Restoring analytics to reports
   needs a new ADR; hiding the settings button there is the correct current design, not a missing
   control.

## Evidence boundary and open questions

- The GA property, web stream, retention, signals, enhanced-measurement switches, redaction keys,
  custom definitions and filters are not enforceable from this repository. The dated read-back in
  `docs/operations/analytics.md` may become stale and must be rechecked in GA before publication.
- Real-domain deletion of `_ga` cookies, report-event delivery during navigation, outside-region
  performance and the on-screen mobile/keyboard banner still require the manual checks listed in
  the review.
- `sign_up` remains a Measurement Protocol follow-up because `/signup` is deliberately outside
  client analytics.
- Activating the developer filter, defining internal traffic and carrying landing UTMs into an
  account remain operational/product follow-ups, not hidden work in s107.

## Real complexity

The story is scored **3** in `docs/stories.md`; the source-verified retrospective score is **4**.
The number of small modules is not the risk. The risk is keeping route policy, document policy,
consent order, CSP, code splitting, legal copy and external GA settings consistent across client
navigation. The independent review found a major at exactly that seam.

No split is proposed after implementation. The route/CSP/runtime/consent pieces need to land as
one coherent boundary, and the admin settings are already isolated in the operations record. A
future Measurement Protocol `sign_up` is correctly separate.
