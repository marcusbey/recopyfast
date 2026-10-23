# ADR 074 — DataFast funnel goals and Stripe revenue attribution

- Status: accepted (owner decision, 2026-10-22; review pending on the branch)
- Date: 2026-10-22
- Scope: branch `feature/datafast-funnel-goals`
- Supersedes: [ADR 073](./073-datafast-runs-on-every-document.md) Decision 5 ("No client-side goal
  calls"). Everything else in ADR 073 stands.
- Related: [ADR 059](./059-nonce-csp-on-the-app-surface.md) (the two CSPs),
  [ADR 070](./070-consented-server-conversions-are-separate-from-business-totals.md) /
  s111–s112 (GA4 server conversions, unchanged), [ADR 007](./007-account-milestones-write-once.md)

## Context

DataFast is on every document (ADR 073) and, by the owner's decision of 2026-10-22, runs before
consent; Google Analytics stays consent-gated and is untouched here. Pageviews alone cannot show
where the funnel leaks, and DataFast attributes revenue only when Stripe Checkout carries its
visitor/session ids. DataFast's API (docs, read 2026-10-22): `window.datafast(name, params)` or
`data-fast-goal` / `data-fast-goal-<kebab>` attributes in the browser; `POST
https://datafa.st/api/v1/goals` with `Authorization: Bearer <df_ key>` and
`{ datafast_visitor_id, name, metadata? }` on the server; Checkout `metadata.datafast_visitor_id` /
`metadata.datafast_session_id` for revenue. Names `a-z0-9 _ - :` ≤ 64; ≤ 10 params, values ≤ 255.

## Decision

1. **One taxonomy, one file.** `src/lib/analytics/datafast-goals.ts` holds every goal name, the
   params each may carry and the CTA locations. No goal name is spelled anywhere else.

   | Goal | Where it fires | Params |
   |---|---|---|
   | `cta_click` | `data-fast-goal` attributes on every signup/checkout/demo/try anchor (hero, header, mobile header, pricing plans, lifetime, founding, final CTA, founding offer, /demo, /try, blog, compare, comparison pages, tool pages, tool CTA) — no JS | `location`, `target` (`signup`/`checkout`/`demo`/`try`), `plan` (catalogue id) |
   | `demo_edit` | first text edit per page view: `/demo` (`InteractiveHero tracksDemoEdit`), `/try` (a `MutationObserver` on the sample; `rcf-try.js` itself is not instrumented — it also runs on third-party pages) | `surface` |
   | `tool_typo_finder_run` | spell checker scan produced a report (`ToolScanForm`) | — |
   | `tool_cost_calculator_used` | calculator result settled, once per view (`CostCalculator`) | — |
   | `tool_run` | any future /tools entry without its own goal | `tool` (slug) |
   | `install_snippet_copied` | a copy that reached the clipboard: dashboard snippet (site page, registration modal, quick setup), /docs/install agent brief | `location` |
   | `signup_email_submitted` / `login_email_submitted` | magic-link request succeeded | — |
   | `signup` + `app_trial_started` | server, `/auth/callback` and `/auth/confirm`, when `ensureTrialStarted` started the trial | `offer` (`founding`/`standard`) on the second |
   | `site_created` | server, `/api/sites/register` | — |
   | `script_installed` | server, embed content report whose guarded `markSiteLive` update matched | — |
   | `first_edit_published` | server, `/api/staging/publish` when the site's publish history equals this publish | — |

   None collides with DataFast's reserved payment names (`payment`, `free_trial`, `trial_*`,
   `subscription_*`); a test asserts it.

2. **PII rule.** No goal param is ever an email, name, site URL/domain, token, site id or user id.
   `sanitizeGoalParams` enforces it structurally: a value must be a lowercase slug ≤ 64, which no
   email, URL or token can be. Server goals carry the visitor id DataFast itself issued, nothing
   else about the person.

3. **No queue snippet.** DataFast's recommended inline `<script id="datafast-queue">` would need a
   hash in the static CSP and the nonce on the app surface. `trackGoal` instead installs the same
   queue (`window.datafast.q`) on first use. No CSP change. With
   `NEXT_PUBLIC_DATAFAST_DISABLED=true` (CI e2e, Lighthouse) it does nothing at all.

4. **`signup` is keyed on the trial.** Sign-up is passwordless: the first and the tenth sign-in run
   the same code, and s111's `freeze_analytics_signup` returns the same row each time, so neither
   can say "first". `ensureTrialStarted` can — it writes only for an account with no entitlement,
   and the one-trial index makes that once per account, ever. It now returns which trial it started
   (`"founding" | "standard" | null`) and the auth routes send both goals from a non-null answer.

5. **Server goals are inert until `DATAFAST_API_KEY` is set**, and respect the disable flag. Each
   call is bounded to 2 s, runs in `after()`, never throws, and on failure logs and reports to
   Sentry the goal name and an outcome code only. DataFast's 404 (visitor never seen) is a
   breadcrumb, not an error.

6. **`datafast_visitors` (migration `20261022120000`).** The embed check-in and the widget's publish
   arrive from the customer's domain, where our cookie is never sent. The auth routes store the
   account's latest valid `datafast_visitor_id` (one row per account, overwritten, `ON DELETE
   CASCADE`); the two milestone goals resolve the site owner (earliest `admin` row in
   `site_permissions`) to it. Service-role only: RLS on, all access revoked from PUBLIC, anon and
   authenticated; a CHECK pins the cookie charset. Nothing is written while the key is unset.

7. **Revenue attribution.** `/api/billing/checkout` reads the two cookies (`req.cookies`),
   validated to `[A-Za-z0-9_-]{1,128}`, and `createCheckoutSession` adds them to the session
   `metadata` for subscription, credits and lifetime — never setup mode — next to every existing
   key. For an **idempotent** create (pending subscription intent, Founding Agency reservation) they
   are deliberately kept out of the create params: Stripe refuses a retried key with different
   parameters, and the session cookie rotates after 30 idle minutes, which would strand the buyer
   behind a conflict. Those sessions get the keys by a best-effort metadata update after creation.

## Options considered and rejected

- **Queue snippet as an inline script:** two CSPs to keep in step; the helper is equivalent.
- **Key `signup` on `email_confirmed_at` recency or on the s111 freeze:** fuzzy, or not once-only.
- **Store the visitor id in `user_metadata`:** user-writable, rides every JWT, and the auth paths
  have broken twice already; a private table is smaller and reviewable.
- **Skip `script_installed` / `first_edit_published`:** they are the activation milestones the
  funnel exists for; the table is additive and service-only.
- **Account-level `first_edit_published`:** ADR 007's `account_milestones` never shipped; per site
  is exact with the data that exists.

## Consequences

- `ensureTrialStarted` returns a value; `markSiteLive` resolves whether it made the transition.
- Concurrent first publishes on one site may both see a larger history count and send nothing —
  rate-limited to 10/min per site; a missed goal is the safe failure.
- Cross-device confirmation (`/auth/confirm` on a phone that never loaded our site) has no cookie,
  so no signup goal is sent for that path.

## Owner steps

1. DataFast → Website Settings → **connect Stripe** (revenue attribution reads the Checkout
   metadata; no webhook on our side).
2. DataFast → Website Settings → API → **create a website API key** (`df_…`) → set
   `DATAFAST_API_KEY` in **Vercel production** only. Then apply migration `20261022120000`.
3. Optionally create the goals above in the DataFast dashboard funnel view.
