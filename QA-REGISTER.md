# RecopyFast QA Register

> **STATE: SHIPPED.** All four lanes are committed and live in production
> (`5ca6ac3..9b13eae`, deployed and Ready). The Enterprise vars have been
> removed from Vercel production now that the running build no longer reads
> them. `tsc` 0 errors, 1246 tests passing.
>
> ## 🔴 ONE MIGRATION IS OWED TO PRODUCTION
>
> `20260802020000_plan_constraint_and_credit_collapse.sql` has **not** been
> applied. Confirmed against the live database via the PostgREST schema:
> `credit_purchases.expires_at` is still NOT NULL. Two consequences:
>
> 1. **Credits.** The deployed code writes `expires_at: null`, which the live
>    schema rejects with 23502. Left alone that means charge the card, throw,
>    500, Stripe retries forever, customer gets nothing — the Starter failure
>    shape exactly. **Mitigated in code**, not left open: `insertNonExpiringGrant`
>    tries NULL, and on 23502 falls back to a far-future expiry that the
>    `expires_at.gt.<now>` arm of the balance filter treats as spendable. The
>    grant is identical either way, and the fallback stops being used the moment
>    the migration lands. Credits are sold through inline `price_data`, not a
>    price id, so the Starter trick of pulling an env var would not have worked
>    here.
> 2. **Starter is still unsellable** until the constraint is rewritten, and the
>    `tickets` balances are still not carried into `credit_purchases`.
>
> ## 🔴 DEPLOY ORDER — Starter is switched OFF in live on purpose
>
> `billing_subscriptions.plan` shipped with `CHECK (plan IN ('free','pro','enterprise'))`
> from a migration predating the Starter tier. Every Starter checkout raises
> 23514, the webhook returns 500, and Stripe retries forever — **card charged,
> subscription row never written, customer stranded on free.**
>
> `STRIPE_STARTER_PRICE_ID_LIVE` and `STRIPE_STARTER_YEARLY_PRICE_ID_LIVE` have
> been **removed from Vercel production** and the site redeployed, so Starter now
> fails at checkout creation instead of taking money. Pro is unaffected and still
> sells normally.
>
> **To re-enable Starter, in this order and no other:**
> 1. Run `supabase/migrations/20260802020000_plan_constraint_and_credit_collapse.sql`
>    against production. It rewrites the constraint to `('free','starter','pro')`
>    and grandfathers any enterprise subscriber to pro *before* tightening it —
>    that ordering is load-bearing and asserted by a test.
> 2. Deploy the committed code.
> 3. Re-add both Starter live price ids to Vercel, then **redeploy** — Vercel bakes
>    env vars per deployment, so adding a value without redeploying does nothing.
>    (Values are in local `.env`.)
> 4. Verify with a real Starter checkout that the subscription row is written.
>
> **To land everything:**
> 1. Fix `src/lib/stripe/__tests__/config.test.ts` (3 failures). It asserts the
>    OLD live-mode contract — `NODE_ENV=production` implying live Stripe keys.
>    That was the bug: Vercel sets `NODE_ENV=production` on *preview* builds too,
>    so PR previews took real money. The discriminator is now `VERCEL_ENV`
>    (`src/lib/stripe/mode.ts`). Rewrite the assertions to the new contract:
>    `VERCEL_ENV=production` → live; `preview` → test; unset/`development` → test;
>    and `NODE_ENV=production` with `VERCEL_ENV` unset → **test, not live**.
>    Do not delete assertions to get green.
> 2. `npx jest --json` to confirm zero failures, `npx tsc --noEmit -p tsconfig.build.json`
>    for 0 errors.
> 3. Commit in four chunks: embed core loop / auth security / billing / UI+a11y.
> 4. Deploy, then remove the Enterprise vars from Vercel (not before — the
>    running build still reads them).
>
> **Not QA any more, deliberately deferred:** P0-1 (widget has no client for the
> magic-code system), P0-2 (no enrollment UI), ~15 orphaned components. These are
> builds, not fixes, and want a fresh session.


## 🔵 NEXT TASK — remove the free plan (decided, not started)

Product decision: **no free plan, no access without payment.** The catalogue
currently seeds `free` at $0 and it is active.

**Do not deactivate the `free` row first.** `getEffectivePlanId` still ends in
`return subscription?.plan ?? "free"`, so switching the row off ahead of the code
would strand every unsubscribed account the moment it deployed — the same
code-before-schema ordering that broke credits this session.

Order, and the six places that assume a plan always resolves:

1. `src/lib/billing/entitlements.ts` — `getEffectivePlanId` must return an
   explicit unentitled result instead of `?? "free"`, and `getEffectivePlan`
   must express "no plan" as a value callers are forced to handle rather than a
   zero-limit plan they can mistake for a real one.
2. `src/lib/feature-gating/permissions.ts` — decides access; needs the deny
   branch.
3. `src/lib/credits/system.ts` — `includedCredits = plan.limits.monthlyCredits`
   becomes 0, and the balance read must not throw for an unentitled user.
4. `src/lib/stripe/subscription.ts`
5. `src/app/api/billing/dashboard/route.ts` — must render an unentitled state.
6. `src/app/api/ab-tests/generate/route.ts`

Then, and only then: deactivate the `free` plan row, and decide separately
whether the `billing_subscriptions.plan` CHECK drops `'free'` — existing rows
may hold it, so that is a data question, not just a constraint edit.

Open question that blocks the signup flow: what does a newly registered account
see before it pays? There is no answer to that in the code today.

---

Living tracker for the full-journey QA pass. Findings are from four parallel
read-only recon agents (payments, auth, embed, UI) plus direct verification.

Status key: `[ ]` open · `[~]` in flight · `[x]` fixed + verified · `[!]` needs a decision

---

## 0. Blockers

- [x] **Production `REDIS_URL`** — was an EMPTY STRING in Vercel, not a stale
  host. Set to the verified `rediss://` value, redeployed, and confirmed: the
  Redis-gated path now returns 401 (auth rejecting an anonymous caller) instead
  of 503 (rate limiter unavailable). All ten fail-closed endpoints are back.
  Root cause of the confusion: Vercel bakes env vars per deployment, so editing
  a value does nothing to the running build until a redeploy.
- [x] Local `REDIS_URL` — fixed (scheme was `redis://`, Upstash is TLS-only).
- [x] `STRIPE_WEBHOOK_SECRET` was empty → every non-prod webhook 500'd, making
  local payment QA impossible. Pulled a real `whsec_` from Stripe CLI.
- [x] Production Stripe price ids synced (12 vars). Production had the old $29
  Pro price and no Starter/yearly/lifetime ids at all.
- [x] `EDITOR_GRANT_SECRET` was absent in production, so device grants were
  silently keyed off `SUPABASE_SERVICE_ROLE_KEY` — rotating that key would have
  killed every grant and hub session at once. Now has its own 64-char secret.
- [x] **`RESEND_API_KEY`** — added and verified live. `/api/editor/request-code`
  now returns a neutral 200 instead of 503. Same redeploy trap as `REDIS_URL`:
  storing the value in Vercel does nothing until a deployment picks it up.
- [ ] **Supabase email template still points at `/auth/callback`.** Until it is
  repointed at `{{ .SiteURL }}/auth/confirm?token_hash=…`, magic links break
  cross-device — request on a laptop, open on a phone, land on `/auth/error`,
  because the PKCE verifier cookie is not there. That is the most common
  real-world magic-link path. Console change, not code. **Owner: user.**
- [x] Enterprise env vars removed from Vercel production, after confirming the
  deployed build no longer reads them (`STRIPE_ENTERPRISE_PRICE_ID`,
  `_PRICE_ID_LIVE`, `_YEARLY_PRICE_ID`). The only surviving `ENTERPRISE` symbol
  in the source is the unrelated `RATE_LIMIT_CONFIGS.API_KEY_ENTERPRISE`.
- [ ] **Migration `20260802020000` not applied to production.** Owner: user —
  it needs credentials this session does not have. `supabase migration list
  --linked` fails SASL auth, there is no DB password or PAT in the environment,
  and PostgREST exposes no SQL-executing RPC. The hosted Supabase MCP server is
  now configured in `.mcp.json`; it needs `claude /mcp` → Authenticate, run
  from a real terminal, before an agent can apply it.

---

## 1. Core product loop — **BROKEN** (highest priority)

The central promise — edit copy, visitors see it — does not work on any real
site. Both verified directly, not just by reading.

- [x] **P0 Element IDs regenerate every page load.** Fixed and verified against
  the artifact actually serving production (`/embed/recopyfast.js`, sha256
  `3d32b615…` — byte-identical to `public/embed/recopyfast.js`). Ids now derive
  from structure alone via `computeStableElementId`. Observed, not argued: a
  fixture with two structurally identical sections, six `<li>` sharing byte
  identical text, framework ids (`:r3:`, `radix-:r7:`, `css-1a2b3c`) and an
  authored anchor, loaded in **separate fresh browser contexts**, yields
  identical ids across all 10 probes — and still does after every string on the
  page is rewritten, and after a decorative `<div>` is inserted between the two
  sections. No id contains a timestamp; identical siblings stay distinct;
  `data-rcf-id="author-chosen-id"` is honoured verbatim. 13 elements stamped.
- [x] **P0 Published content is never fetched on load.** Fixed and verified. A
  plain visitor load now issues `GET /api/content/{siteId}` — request order
  captured off the wire was `fixture.html → recopyfast.js → /api/content →
  /api/ab-tests/active → socket.io`, so hydration precedes both the A/B
  pipeline and the socket handshake, as intended. With one element stored
  server-side, the visitor's heading rendered `PUBLISHED COPY FROM SERVER`
  rather than the author's markup.
- [x] **P1 `content_elements` grows with traffic, not edits.** Closed as a
  consequence of stable ids: the probe set is byte-identical across loads, so
  `(site_id, element_id, language, variant)` now collides and the upsert
  matches instead of inserting a fresh row set per page view.
- [ ] **Why it shipped:** the only e2e covering the loop hand-writes
  `data-rcf-id` into its fixture — a condition that never holds on a real site —
  and is skipped unless `RUN_RECOPYFAST_CORE_E2E=1`.

## 2. Editor auth — two systems, neither complete

- [x] **P1 Forwarding a *verified* invite URL granted full access.** Fixed:
  verification is now bound to a User-Agent fingerprint captured when the code
  is accepted, plus a 12h validity window. A forwarded URL yields
  `verified:false`, `permissions:[]` and a code prompt the holder cannot clear.
  Existing verified rows fail closed rather than being grandfathered — the whole
  bug was that already-forwarded URLs kept working. 6 regression tests.
- [x] **P1 A stale rotated grant revoked every device for that editor.** Fixed:
  the automatic lineage revoke is gone entirely. The inference it rested on does
  not hold — an honest stale tab and a thief present an identical token, so the
  detector cannot separate them and was firing on the common case. Response is
  now proportionate: that one token is dead. Grace window 60s → 5 min, because
  background timers throttle to minutes and a suspended laptop stops firing them
  altogether. Mutation-verified.
- [x] **P1 `staging/verify {action:"resend"}` had no rate limit.** Fixed:
  per-recipient and per-IP, both fail-closed. Keyed on the recipient address
  rather than the token, since one person can hold several invites. 6 tests.
- [x] **P2 Edit sessions extended without bound.** Fixed: 24h absolute ceiling
  from `created_at`, with the requested duration clamped rather than rejected.
  Added the revoke endpoint that did not exist — and found while implementing
  that `revokeEditSession` used the user-scoped client against a table with no
  UPDATE policy, so revocation matched zero rows and reported success.
- [x] **P3-11 Concurrent refresh forked the grant lineage.** Fixed: rotation is
  serialised claim-first via a conditional UPDATE, so exactly one caller wins.
  Mint-failure rollback preserved so a failed mint never strands the holder.
- [ ] **P0-1 Magic-code system has no client.** `/api/editor/*` + `/edit` are
  complete and well-built server-side. The widget has zero references to
  `rcf_handoff`. Every hub sign-in lands the user as an anonymous visitor.
  **Deferred — this is a build, not a fix.** Note for whoever wires it:
  `nextActionFor` can now return `"refresh"` as a third value alongside
  `verify`/`hide`; handle it or the tab falls through to a needless code prompt.
- [ ] **P0-2 No UI enrols a `site_editors` row.** `POST /api/editor/editors` has
  no caller. Share writes `staging_access` instead. An invited person requests a
  code, none is ever sent, and it is indistinguishable from a broken inbox.
  **Deferred — build, not fix.**
- [ ] **P2 `request-code` leaks editor existence via latency** — the recognised
  branch makes a blocking call to Resend before returning the neutral response.
  Still open, out of scope so far.
- [ ] **Optional, needs a migration:** durable replay telemetry. Removing the
  automatic lineage revoke removed its visibility too; the only trace now is a
  log line. Persisting replay counts on the grant row would make "is this editor
  actually under attack?" answerable.

## 3. Billing

- [x] Stripe products + prices rebuilt; test now mirrors live exactly.
- [x] Live Enterprise archived. Junk test products archived.
- [x] Lifetime Pro $199 created in both modes.
- [x] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE` was never defined (missing
  prefix) → Stripe.js got `undefined` in production.
- [x] **C1 Preview deploys transact against LIVE Stripe.** Fixed: the decision
  lives only in `src/lib/stripe/mode.ts`, keyed off `VERCEL_ENV`, failing to
  TEST when absent, with `STRIPE_LIVE_MODE=true` as the explicit opt-in for a
  non-Vercel host. Verified live: production carries `VERCEL_ENV="production"`
  and 8 `STRIPE_*_LIVE` vars, so production is live and previews are test. No
  `NODE_ENV`-based mode branch remains outside comments.
- [x] **C3 Every paying customer gets 0 AI credits.** Fixed: reads use the real
  column `plan`. The surviving `plan_id` occurrences are Stripe *metadata* keys
  and a type field, not column names. `assertRead` now turns a PostgREST error
  into a throw rather than a silent zero balance.
- [~] **H5 Credits purchasable but unspendable** — code side done:
  `credit_purchases` is the single store and `addPurchasedCredits` is wired to
  the webhook. **Blocked on the migration** for the `tickets` carry-over; see
  the header. Not a regression from this deploy — balances read
  `credit_purchases` before it too, so `tickets` money was already invisible.
- [ ] **H6 Plan limits are decorative** — still open. No `enforcePlanLimit`-style
  caller exists; `src/app/api/sites/route.ts` has no count check. A $9 customer
  can still create unlimited sites.
- [x] **H8 Refunds and chargebacks revoke nothing.** Fixed: `charge.refunded`
  and `charge.dispute.created` both route to `handleMoneyReturned`, which claws
  back only unspent credits so a customer who already spent them is not driven
  negative.
- [x] **M9 Failed webhooks return 200**, so Stripe never retries. Fixed: failure
  paths answer 500. The one deliberate 200 is the already-processed case, where
  retrying would double-apply.
- [x] **M12 Pricing page advertises a 14-day free trial and "no credit card
  required".** Resolved by deleting the claims, with a comment at each site
  recording why. Verified on the live page: zero matches for "14-day", "free
  trial" or "no credit card". The two surviving "Free Trial" strings are sample
  copy *inside* the mock site on `/demo`, editable by the widget and explicitly
  commented as not a real CTA.

## 4. Dashboard / UI

- [~] P0 Analytics export hits a route that does not exist; failure swallowed.
- [~] P0 A/B wizard can never list an element (unauthenticated fetch → 401 →
  empty, with no empty state).
- [x] P0 `/sites` is auth-gated but has no page → 404 behind an auth gate.
  Fixed by removing the gate rather than inventing a page: site management lives
  at `/dashboard/sites`, nothing links to `/sites`, and gating it only turned a
  404 into a login redirect that led nowhere. Live `/sites` is now a plain 404.
- [~] P1 Dead buttons with no handler: Update Password, Enable 2FA, Generate API
  Key, theme tiles, Save Preferences, Save Appearance, Invite Member, Send
  Invite, remove-member, 6 blog category filters, Load More, newsletter
  Subscribe, 2 demo CTAs.
- [~] P1 Registration modal documents `data-recopyfast-editable`, an attribute
  the widget ignores — following the instructions literally yields nothing.
- [~] P1 The embed snippet renders invisible (`bg-foreground text-foreground`).
- [~] P3 Sign-in drops the redirect destination (`next` vs `redirectedFrom`).
- [~] P3 Integration Status is hardcoded "Verified"/"Connected".
- [~] P3 Header `#features`/`#pricing` are dead on every non-home page.
- [~] P3 Analytics chart bars unstyled (dynamic Tailwind class names).
- [~] P3 Share dialog defaults to a retired link type; the DB rejects it and the
  admin is told they lack permission on their own site.
- [ ] P4 ~15 orphaned components with zero importers, several backing live API
  routes that are therefore UI-unreachable.

## 5. Accessibility

- [~] 7 unlabelled icon-only buttons.
- [~] 3 mouse-only controls (A/B element picker, landing demo text, theme tiles).
- [~] 5 unassociated form labels.
- [~] 2 modals without a working focus trap.

---

## Verification protocol

No item moves to `[x]` on reasoning alone. Each needs: the command or click path
run, and the observed output pasted. For the embed fixes specifically, "the same
element yields the same id across two separate page loads" must be demonstrated,
not argued.
