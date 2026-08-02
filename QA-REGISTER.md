# RecopyFast QA Register

> **HANDOFF STATE.** Four lanes of work are finished and sitting UNCOMMITTED in
> the working tree. One test suite is red and the pre-commit hook runs the full
> suite, so nothing can land until it is fixed.
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
- [ ] Enterprise env vars deliberately left in Vercel until the refactored code
  deploys; the currently-running build still reads them.

---

## 1. Core product loop — **BROKEN** (highest priority)

The central promise — edit copy, visitors see it — does not work on any real
site. Both verified directly, not just by reading.

- [~] **P0 Element IDs regenerate every page load.** `recopyfast.src.js:1385`
  falls back to an ID containing `Date.now()`; the only writer of `data-rcf-id`
  is line 1386, in memory. Saved content can never be matched back.
- [~] **P0 Published content is never fetched on load.** `init()` scans the DOM
  and opens a socket, never asks the server for content. The only fetch of
  `/api/content/{siteId}` sits in a socket-failure catch block.
- [~] **P1 `content_elements` grows with traffic, not edits.** Consequence of
  unstable IDs: the `(site_id, element_id)` upsert never collides, so every page
  view inserts a full row set. ~500k junk rows/day at 10k views.
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
- [~] **C1 Preview deploys transact against LIVE Stripe.** Branches on
  `NODE_ENV === "production"`, which Vercel sets on preview builds too. Must be
  `VERCEL_ENV`.
- [~] **C3 Every paying customer gets 0 AI credits.** Queries `plan_id`; the
  column is `plan`. The error is swallowed, plan falls back to FREE.
- [~] **H5 Credits purchasable but unspendable** — two parallel currencies, and
  nothing ever credits the one that is spent.
- [~] **H6 Plan limits are decorative** — no caller enforces them; a $9 customer
  can create unlimited sites.
- [~] **H8 Refunds and chargebacks revoke nothing.**
- [~] **M9 Failed webhooks return 200**, so Stripe never retries.
- [!] **M12 Pricing page advertises a 14-day free trial and "no credit card
  required".** Neither exists. Defaulting to deleting the claims — say so if you
  want a real trial implemented instead.

## 4. Dashboard / UI

- [~] P0 Analytics export hits a route that does not exist; failure swallowed.
- [~] P0 A/B wizard can never list an element (unauthenticated fetch → 401 →
  empty, with no empty state).
- [~] P0 `/sites` is auth-gated but has no page → 404 behind an auth gate.
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
