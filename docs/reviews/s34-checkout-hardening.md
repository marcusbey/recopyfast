# Review: s34-checkout-hardening (re-review of the fix commit)

## Scope and verdict

This is a fresh-context `/ks-review` **re-review** of draft PR #32 on
`feature/s34-checkout-hardening`, done after fix mode.

- Head: `23e56c1` (fix commit). The previous head was `d999b05`.
- Diffs reviewed:
  - `git diff d999b05..23e56c1`: the fix itself, 20 files.
  - `git diff origin/main...HEAD`: the whole story, 24 files, measured from merge base `c3b2b28`.
  - `origin/main` has since moved to `cbfb922` (PR #33, s35).
- Checked against:
  - the plan, including tasks F1–F5 (`validated: yes`);
  - the research;
  - AGENTS.md;
  - ADRs 019, 028, 029 and 031, plus the errata;
  - the operator's fix decisions for M1, m1, m2, m3, m4 and m5;
  - the previous verdict for this story.
- The reviewer changed no source file and committed nothing. The only file written is this review.
  - Every TypeScript mutation was reverted and proven clean with `git diff --exit-code`.
  - Every SQL mutation ran only on a throwaway loopback cluster. That cluster was stopped and
    deleted afterwards.

**Ship allowed. There is no critical or major finding.**

- **M1 is fixed as the operator decided.** Checkout no longer calls any Stripe cancellation.
  Every recoverable row is re-read from Stripe with its latest invoice. A processing payment
  blocks checkout with the exact approved 409. Otherwise the customer is sent to the hosted
  invoice, or to a billing portal session for a paused subscription.
- **Two live subscriptions stay impossible.** Two layers each refuse a replacement:
  - the route's recovery check;
  - the transactional claim guard in SQL.
- **m2 holds on real PostgreSQL**, including under three concurrent completions:
  - one grant;
  - duplicates return `refund_required` until the refund is recorded, then `refunded`;
  - the sold count does not change;
  - one entitlement.
- **The Stripe refund path is idempotent per Checkout Session.** It checks existing refunds
  before creating one, so it stays safe after Stripe's idempotency key expires.

What remains is seven minor items, listed under Findings. One of them is procedural and must be
handled before merge: the PR now conflicts with `main` in `docs/stories.md` (r6).

## Prior findings → status

| # | Prior finding | Status | Evidence (verified here) |
| --- | --- | --- | --- |
| **M1** (major) | The N2 fix could cancel a subscription whose payment was still in flight | **Fixed** | See "M1 evidence" below. |
| m1 | A `complete` session whose asynchronous payment later failed kept its founding spot forever | **Fixed, within the operator's scope** | See "m1 evidence" below. |
| m2 | One buyer could hold two founding spots in turn and pay for both | **Fixed** | See "m2" under "Operator decisions → verification". Residual: r1 and r2. |
| m3 | Rate-limit UX and sizing | **Fixed** (copy nit r5, retained-intent edge r4) | See "m3" under "Operator decisions → verification". |
| m4 | Untested guards and test hygiene | **Fixed** | See "m4 evidence" below. |
| m5 | Drift and inaccurate text | **Fixed** | See "m5 evidence" below. |
| m6 | The required E2E check was red on the head commit | **Fixed** | `gh pr checks 32` on `23e56c1`: E2E (Playwright), Lint/Test/Build, Type-Check incl. tests, realtime audit and Vercel all pass. |
| s33 n3/n4a/n4b/n4c/n5/n7/n8/m5, s28 N2 | Earlier source findings | **Still fixed** | The fix commit leaves `20260925100000`, the grace/skew/per-row logic, the billing page and ADRs 019/028/029 untouched. The founding DB suite passes **23/23**, and the targeted billing suites pass **445/445**. s28 N2 is now closed without the cancellation residual. |

**M1 evidence**

- There is no `subscriptions.cancel` call left on the checkout path:
  - `getRecoverableSubscriptionCheckout` is at `src/lib/stripe/subscription.ts:138-271`;
  - a test asserts that the mocked `subscriptions` surface holds only `retrieve`.
- Stripe is read with `expand: ["latest_invoice"]` (`:168-171`).
- The helper checks every invoice payment across pages for a PaymentIntent in `processing`
  (`:99-129`). A cursor that Stripe reports but does not supply fails closed (`:126-128`).
- What the route returns (`route.ts:485-528`):

  | Outcome | Response |
  | --- | --- |
  | Payment processing | 409 with the exact approved message |
  | `incomplete`, `past_due`, `unpaid` | 409 with the `hosted_invoice_url` as `resumeUrl` (`:260-265`) |
  | `paused` | 409 with a billing portal session URL (`:229-258`) |
  | No URL available | 409 `paused_without_portal` or `unavailable` |
  | Stripe reports `active` or `trialing` | The upgrade 409 (`:178-180`) |

- A Stripe-terminal row is only synchronised locally, scoped by id, user id and subscription id
  (`:182-204`).
- The route runs the check inside the user lock, before the claim (`route.ts:209-224`).
- The SQL claim still refuses every nonterminal status, even when a pending intent already
  exists. This was re-proven on PostgreSQL: a row seeded in `incomplete` with a pending intent
  created under the old schema gives P0001 after migrating.

**m1 evidence**

- `checkout.session.async_payment_failed` is dispatched at webhook `route.ts:262-264` and handled
  at `:1201-1216`. It releases the hold through the existing session-scoped release RPC.
- The runbook adds the event (15-event set).
- Residual, pre-existing and not in the operator's m1 scope: a paid session whose grant fails
  permanently (for example, the account was deleted) still retains its hold.

**m4 evidence**

- The terminal write now asserts all three `.eq` scopes. Removing `.eq("user_id")` gives
  **1 red**; it gave 0 in the previous review.
- `subscription-checkout-recovery.test.ts` now uses `resetAllMocks()`.
- The open/unpaid fixture now carries a real `checkout_expires_at` (`founding-agency.test.ts`).

**m5 evidence**

- ADR 031 now documents that a history-discovered session needs no rebind.
- The false rolling-deploy comment is corrected in the errata, and the unused two-argument
  overload is dropped forward-only (`110000:201-204`, **1 red** when the drop is removed).
- The "recovered to active" case now returns the upgrade 409 instead of a raw 500 (**2 red**).

## Operator decisions → verification

**M1: never cancel; 409 processing, or 409 plus `resumeUrl`.** Implemented as specified; see
"M1 evidence" above.

- The UI follows `resumeUrl` when present (`useCheckout.ts:93-99`, **1 red**).
- `past_due` is now a recoverable status. The route checks for recovery before the "already
  subscribed" conflict, so a `past_due` customer gets the invoice link. Reordering those two
  checks gives **5 red**.

**m2: one founding lifetime per account, refunded automatically and exactly once.**

`complete_founding_agency_purchase` in `20260925110000`:

- It takes the global capacity advisory lock and a row `FOR UPDATE` (`:39-49`).
- If another `completed` row exists for the same account (`:76-96`):
  - the duplicate is written as `released`, so it is not counted and frees its own hold;
  - it keeps its payment intent id and a sticky `duplicate_refund_required_at`;
  - no entitlement is inserted.
- Replays return `refund_required` until the refund is marked, then `refunded` (`:63-70`).

The webhook side:

- `grantLifetime` handles `refundRequired` (webhook `route.ts:833-917`).
- It resolves the exact Checkout Session: the event's `session.id`, or exactly one
  metadata-matched session found by payment intent (`:840-860`).
- It binds that session to the duplicate row (`:863`).
- It lists existing refunds by `founding_reservation_id` metadata **before** creating one
  (`:873-880`). This covers a refund that succeeded when its database write was lost, even after
  Stripe's idempotency key has expired.
- It creates the refund under `founding-agency-duplicate-refund-<sessionId>`, or
  `…-after-<failedRefundId>` when an earlier refund failed or was cancelled (`:883-896`).
- It refuses to record anything other than `succeeded` (`:899`).
- It marks the refund only once Stripe reports success (`:906`).

Exactly once under retries and concurrent deliveries:

- Different events for the same payment both reach `refund_required` under the lock.
  Both then use the same session-scoped key, so Stripe returns one refund.
- The same event, redelivered while an earlier attempt is still running, is re-run. The route
  re-runs any event whose `processed` flag is still false. The same key and the
  list-before-create step make that safe.
- Throwaway-DB probe, with 3 concurrent late completions of the released duplicate:

  | Check | Result |
  | --- | --- |
  | Each completion | `refund_required` |
  | `mark` | `t` |
  | `mark` with a different refund id | `f` |
  | Replay after the refund | `refunded` |
  | Completed count | 4 → 4 |
  | Agency entitlements | 1 |
  | `reserve` afterwards | `owned` |

- The duplicate's `charge.refunded` revokes by the duplicate's own payment intent. That revokes
  nothing, so the first grant is untouched (`entitlements.ts:132-157`).

Refund failure path:

- Any provider error, or a status that is not `succeeded`, throws. The generic webhook catch then
  logs it and returns 500.
- The `billing_events` row stays `processed = false`, so Stripe's redelivery re-runs the handler.
  This is **retryable only for as long as Stripe keeps retrying** (see r1).

The legitimate first grant cannot be blocked:

- The migration's only new constraint is a partial UNIQUE index on `stripe_refund_id`, and it
  is NULL for grants.
- The account check only sees *another completed* row. Completions are serialised by the
  advisory lock, so a first grant never sees a completed sibling.
- Proven on the throwaway DB, on rows created under the pre-s34 schema:
  - a first grant of a reserved hold → `granted`;
  - a late first grant of a released hold → `granted`;
  - a replay → `duplicate`.

**m3: split buckets; resumes excluded; UI retry time; fail closed only for founding.**

- IP bucket: `CHECKOUT_IP` 20 per 15 minutes, applied before auth, `allow` on store failure
  (`route.ts:142-154`).
- User new-session bucket: `CHECKOUT_USER` 10 per 15 minutes (`rate-limiter.ts:426`).
  - Subscription: charged only immediately before `createCheckoutSession`, `allow`
    (`route.ts:422-439`).
  - Founding: charged after a provider-confirmed open-session resume returns (`:620-623`), and
    before preflight, reconcile and reserve, with `deny` (`:625-635`).
  - Credits, payment method and Lifetime Pro: `allow` (`:738-748`).
- Resumes consume nothing:
  - subscription: an open attached session, or a Stripe-recovered session with the same choice;
  - founding: a provider-confirmed open session.
- An unattached reused intent is charged.
- The UI reads `X-RateLimit-Reset`, falling back to `Retry-After`, and renders
  `Try again at HH:MM` (`useCheckout.ts:53-65`, `:104-115`).
- Every one of these guards goes red when neutralized (T10–T16 below).

## Verification performed

| Check | Result |
| --- | --- |
| Full Jest, run with the CI placeholder wrapper (`bash ci-run-ssh.sh npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`), Node 20.15.1, nothing listening on 54322, `RCF_TEST_DB_URL` unset | **235 suites passed, 2 skipped. 3,143 tests passed, 38 skipped, 0 failed.** This matches the PR's claim. |
| Targeted billing suites: `api/billing`, `lib/billing`, `lib/stripe`, `components/billing`, `dashboard/billing`, `integration/trial-lifecycle` | 32 suites, **445/445** passed (the mutation baseline) |
| `npm run type-check` (CI wrapper) | Exit 0 |
| `eslint` and `prettier --check` on every changed `src/` file | 0 errors; formatting clean |
| `gh pr checks 32` (head `23e56c1`), run once | All checks pass: E2E (Playwright), Lint/Test/Build, Type-Check incl. tests, realtime audit, Vercel. CodeRabbit skipped because the PR is a draft. `mergeable: CONFLICTING` (r6). |
| Throwaway PostgreSQL 14.17 on `127.0.0.1:55497`, TCP only, minimal auth/role shim | All **59** `origin/main` migrations applied in order. Production-like rows were then seeded through the main RPCs: a completed sale, a bound hold, a released hold, and an `incomplete` subscription with a pending intent. Then `20260925100000` and `20260925110000` were applied, and the pair was **re-applied twice** in order with no error. |
| Second fresh database with all 61 branch migrations, plus the pair re-applied twice | Founding DB suite **23/23**. All DB suites: 66 passed, 2 skipped, 1 failed. The failure is the pre-existing `function-grants` failure `update_translation_coverage(uuid) -> authenticated`, a shim artefact already recorded in the s33 and s34 reviews and untouched by s34. |
| Function config and ACL (`pg_proc`), after migrating | See "ACL details" below. |
| Migration version | See "Migration version details" below. |

**ACL details**

- All 13 checkout and founding functions are `SECURITY DEFINER` with a pinned `search_path`:
  - `public, pg_temp` for the founding functions;
  - `''` for the checkout-intent functions.
- Every `proacl` is exactly `{postgres=X, service_role=X}`.
- For `complete`, `mark_founding_agency_duplicate_refunded`,
  `bind_founding_agency_duplicate_refund_session`, `release_unresolved…` and the five-argument
  claim, `has_function_privilege` is false for anon and authenticated and true for
  service_role.
- The three new columns are unreadable by anon and authenticated.
- RLS is on, and the only policy is service_role.
- The grants follow the `20260805190000` precedent exactly:
  `REVOKE ALL … FROM PUBLIC, anon, authenticated` then `GRANT EXECUTE … TO service_role`.

**Migration version details**

- Both new versions sort after production's `20260924070000`.
- No remote branch has a migration at the same version. `feature/s38` has `20260925120000`,
  which sorts after both.
- Main's move to `cbfb922` added no migration.

### Old code + new schema (migrations before the deploy)

Checked against `origin/main`'s call sites, which call these functions by named argument through
PostgREST, and probed in SQL on the upgraded database.

- **Every function main calls keeps its identity:**
  - reserve;
  - bind, in both its three-argument and four-argument forms;
  - release;
  - complete;
  - availability;
  - the five-argument claim;
  - attach, finish and expire-unattached.
- **The dropped two-argument claim overload has no caller.** `git grep` over main shows only the
  five-argument call in `checkout-reservation.ts:57-66`.
- **Main's `complete` handling:**
  - it grants a released hold late, which is the intended 100000 behaviour;
  - for a duplicate account it receives `refund_required`, which main's
    `completeFoundingAgencyPurchase` treats as an invalid result, so it throws and returns 500;
  - Stripe retries until the new code ships, and nothing is granted or counted meanwhile.
- **Main's checkout for an incomplete, unpaid or paused user** now gets a P0001, which it maps
  to the "use the upgrade flow" 409. That is a temporary dead end for those users, but it fails
  safe.
- **Nothing in the new schema blocks existing rows.** The three new columns are nullable, the
  new index is partial on a NULL column, and the seeded rows survived intact.

**Verdict: safe to apply before the deploy, in order, 100000 then 110000.** See r3 for the replay
caveat.

### Neutralization

Each TypeScript mutation ran against the 445 targeted tests. Each SQL mutation ran against the 23
founding DB tests. Every one was restored, and cleanliness was proven with `git diff --exit-code`
(TypeScript), or by re-applying the real 100000 and then 110000 (SQL).

| # | Neutralized | Red |
| --- | --- | --- |
| T01 | Processing predicate → `false` (`subscription.ts:119`) | **5** |
| T02 | Route ignores the recovery outcome (`route.ts:218-220`) | 8 |
| T03 | "Already subscribed" conflict moved ahead of the recovery check | 5 |
| T04 | active/trialing → upgrade 409 mapping removed (`:178`) | 2 |
| T05 | Terminal write loses `.eq("user_id")` (`:194`) | 1 (was 0, m4) |
| T06 | Invoice-payment pagination stops after page 1 (`:122`) | 1 |
| T07 | Hosted-invoice `resumeUrl` dropped (`:260`) | 3 |
| T08 | Stripe-terminal treated as recoverable (`:182-186`) | 1 |
| T09 | Nonterminal row with no URL returns `null` instead of `unavailable` (`:268-270`) | 1 |
| T10 | Subscription new-session limiter ignored (`route.ts:433`) | 1 |
| T11 | Founding limiter `deny` → `allow` (`:632`) | 1 |
| T12 | Founding open-session resume removed (`:621-623`) | 1 |
| T13 | IP limiter `allow` → `deny` (`:151`) | 1 |
| T14 | `CHECKOUT_USER` 10 → 5 (`rate-limiter.ts:426`) | 1 |
| T15 | UI no longer reads the 429 reset time (`useCheckout.ts:105-107`) | 1 |
| T16 | UI ignores `resumeUrl` (`:94`) | 1 |
| T17 | `async_payment_failed` not dispatched (webhook `:262-264`) | 1 |
| T18 | Existing Stripe refund ignored, so a new one is always created (`:882`) | 3 |
| T19 | Refund status not checked (`:899`) | 1 |
| T20 | Idempotency key made unstable (`:894`) | 3 |
| T21 | `refundRequired` branch skipped (`:833`) | 5 |
| T22 | Founding resume no longer requires `status === "open"` (`founding-agency.ts:159`) | 1 |
| T23 | `refund_required` result not mapped (`:431`) | 1 |
| T24 | Failed or cancelled refund reused instead of a follow-up key (webhook `:883`) | 1 |
| **T25** | **Session match filter on the payment-intent path loosened to `true` (`:846-852`)** | **0** (r2) |
| **T26** | **`bindFoundingAgencyDuplicateRefundSession` call skipped (`:863`)** | **0** (r2) |
| S1 | SQL: account-level duplicate check removed from `complete` (`110000:76-83`) | 2 |
| S2 | SQL: sticky `refund_required` / `refunded` branch removed (`:63-70`) | 1 |
| S3 | SQL: duplicate row kept `reserved` instead of `released`, so it still counts | 2 |
| **S4** | **SQL: `duplicate_refund_required_at IS NOT NULL` dropped from `mark_…` (`:189`)** | **0** (r2) |
| **S5** | **SQL: session-equality guard dropped from `bind_…duplicate_refund_session` (`:149-152`)** | **0** (r2) |
| S6 | SQL: `DROP` of the legacy claim overload removed (`:201-204`) | 1 |
| S7 | SQL: `mark_…` granted EXECUTE to authenticated | 1 (ACL test) |

## Findings

All findings are minor. None corrupts data or breaks the invariant the story turns on.

### r1 (minor): Nothing surfaces a duplicate whose refund never succeeded once Stripe stops retrying

**Where:** webhook `route.ts:899-905` and `docs/operations/stripe-setup.md`.

**How the retry works today:** a refund that throws, or stays `pending`, keeps the event
retryable. That retry exists only for as long as Stripe keeps redelivering, which is about three
days in live mode. Delayed refunds are realistic here:

- Klarna, Affirm, Bancontact and EPS refunds can sit in `pending`.
- A refund larger than the available balance is created as `pending`.

**Two failure modes:**

- *Stripe stops retrying while the refund is still pending.* The money is still returned, but the
  row keeps `duplicate_refund_required_at` set and `duplicate_refunded_at` NULL forever. No
  handler exists for `refund.updated` or `charge.refund.updated`.
- *The create keeps failing.* Stripe replays the cached error under the same key for 24 hours.
  An operator's manual Dashboard refund makes it fail with "already refunded", and so does a
  disputed duplicate. In that case the customer's second payment can sit with no entitlement,
  and only Stripe's failed-delivery emails reveal it.

The runbook's reconciliation query lists `reconciliation_required_at` rows only.

**Fix:**

- Add an operator query for
  `duplicate_refund_required_at IS NOT NULL AND duplicate_refunded_at IS NULL`, plus a line on how
  to finish the refund by hand.
- Optionally, treat a charge that Stripe already reports as fully refunded as done.

### r2 (minor): Four duplicate-refund guards are untested

Each of these goes 0 red when neutralized (T25, T26, S4, S5):

- the metadata filter used when the session is resolved by payment intent;
- the bind call;
- `mark`'s `duplicate_refund_required_at` predicate;
- the bind RPC's session-equality predicate.

All four are defence in depth. The invariant itself is covered by S1–S3 and T18–T24. Still,
nothing stops a future edit from loosening them.

Related hygiene: `lifetime-grant-plan.test.ts` and `checkout-concurrency.test.ts` still reset with
`clearAllMocks()` while queueing `…Once` values. This is the m4 leak pattern in the files the m4
fix did not touch.

### r3 (minor): The two migrations are idempotent only as an ordered pair

**The hazard:** `20260925100000` defines `complete_founding_agency_purchase` without the
duplicate check. Re-running 100000 alone after 110000 does two things, both proven on the
throwaway DB:

- it silently removes one-founding-per-account;
- it recreates the dropped two-argument overload.

A normal `supabase db push` applies each migration once, so this only bites a manual replay. The
runbook says to apply them "in order", and the ADR says to "reapply both to prove idempotence".

**Fix:** state explicitly that any replay must be 100000 followed by 110000.

**Naming nit:** the overload drop rides in a migration named for the founding-lifetime
constraint.

### r4 (minor): A subscription intent refused by the quota stays unattached and can lock the buyer out for up to an hour

**Where:** `route.ts:433-439`.

The fresh intent is deliberately kept, so a retry reuses the same Stripe idempotency key. The
cost:

- A retry with a *different* plan or period gets "Checkout recovery is still in progress" until
  the 60-minute intent expires (`route.ts:396-402`).
- A retry with the same choice more than 30 minutes later is blocked as well, because of
  `STRIPE_CHECKOUT_MIN_EXPIRY_MS` (`:410-420`).

The intent is known never to have reached Stripe. It is only reachable after 10 new sessions in
15 minutes.

**Fix:** document the behaviour, or mark the quota-refused intent so it can be released.

### r5 (minor): 429 copy and wording drift

- **The rendered text is `"Rate limit exceeded Try again at 14:07."`** It has no sentence break,
  and a test (`useCheckout.test.tsx`) pins that exact string. The route's friendlier `message`
  ("Too many checkout attempts…") is still never shown.
- **ADR 031 says the time is rendered "in the user's locale"**, but the formatter is fixed to
  `en-CA`, 24-hour.
- **The research says "the 429 payload carries its retry time"**, but the time is carried in
  headers (`Retry-After`, `X-RateLimit-Reset`), not the body.

### r6 (minor, process): PR #32 now conflicts with `main`

**The conflict:** after PR #33, `git merge-tree` shows a content conflict in `docs/stories.md`
only. The s35 code files (dashboard activation) are disjoint from this story, and main added no
migration.

**Why it matters:**

- The green CI is for the unmerged head. The merged tree has not been tested, by CI or by this
  review.
- The PR body's "origin/main remains the branch's current base" is out of date.

**Fix:** resolve `docs/stories.md`, then let CI re-run on the merged head before merge.

### r7 (minor): The paused-subscription portal ignores the deployment-origin resolver

**Where:** `subscription.ts:237-242` builds `return_url` from `NEXT_PUBLIC_APP_URL` directly.

**The problem:** `checkout.ts:154-177` (`getAppBaseUrl`) prefers the deployment's own origin,
precisely because of register F-14: a preview inherits production's `NEXT_PUBLIC_APP_URL`, and
the customer is returned to a host where they are logged out. On a preview, the portal return
repeats that incident class. Production is unaffected.

**Nits in the same area, no action required:**

- `getOpenFoundingAgencyCheckout` (`founding-agency.ts:86-168`) does not isolate a Stripe error on
  the buyer's own hold. The request returns a raw 500 before reconcile runs. This is bounded,
  because another buyer's reconcile releases the hold after expiry plus 10 minutes.
- Duplicate refunds could also set Stripe's `reason: "duplicate"`.

## Checks that passed

- **Plan conformance.** F1–F5 are all present. There is no unasked-for code change beyond the
  overload drop, which the research, errata and PR disclose.
  - F1: no cancellation. The helper and its old tests were removed.
  - F2: the new forward migration, DB tests and webhook tests.
  - F3: the buckets and their order.
  - F4: the async handler, the runbook and the hygiene fixes.
  - F5: the evidence, which this review reproduced independently.
- **Research facts respected.**
  - Entitlement eligibility is still active/trialing/past_due.
  - ADR 028's durable intents, immutable parameters and intent-scoped idempotency are intact.
  - Completed sales survive refunds.
  - Applied migrations are byte-identical.
  - `20260925100000` is unchanged by the fix commit.
- **Invented-reference check: everything used exists, with the exact signatures used.** Checked
  against `stripe@18.4.0` types, with the API pinned to `2025-07-30.basil`:
  - `stripe.invoicePayments.list({ invoice, expand, starting_after })` and
    `InvoicePayment.payment.{type, payment_intent}`;
  - `paymentIntents.retrieve`;
  - `subscriptions.retrieve(id, { expand })`;
  - `billingPortal.sessions.create({ customer, return_url, configuration? })`;
  - `refunds.list({ payment_intent })` and `refunds.create(params, { idempotencyKey })`;
  - `checkout.sessions.list({ payment_intent | customer, created })`;
  - `enforceRateLimit` and the `CHECKOUT_IP` / `CHECKOUT_USER` presets;
  - the three new RPCs, which exist with the argument names the TypeScript passes.
- **AGENTS.md.**
  - The rate limit runs before authorization.
  - Every bucket declares `onStoreFailure` explicitly, with a comment justifying it. The IP
    bucket failing open is the operator's decision, recorded in ADR 031.
  - The multi-step duplicate write happens inside one Postgres function.
  - No applied migration was edited.
  - No new table, so no RLS gap.
  - Tests changed with the behaviour, and the PR says so.
  - ADR 031 was edited in place, but it is still unmerged story material on this branch.
- **Security.**
  - No secret appears in code.
  - The portal configuration id is optional and comes from the environment.
  - `resumeUrl` values come only from Stripe objects.
  - New log lines carry ids, not provider error bodies or PII.

## Could not verify

- **Live Stripe.** Every Stripe call was mocked. Unverified:
  - that the `data.payment.payment_intent` expansion is accepted on invoice payments;
  - processing detection on a real Bancontact/EPS → SEPA renewal;
  - that hosted invoice pages can be paid for `unpaid` subscriptions;
  - that a default billing portal configuration exists in live and can resume a paused
    subscription;
  - Stripe's idempotency behaviour for refunds (a concurrent in-flight 409, and cached errors for
    24 hours);
  - how long refunds stay `pending` for Klarna, Affirm, Bancontact and EPS;
  - delivery of `checkout.session.async_payment_failed`;
  - whether Stripe can put a subscription into a terminal state while its payment is still
    processing. The helper does not check processing for Stripe-terminal rows; it only syncs them
    and allows the replacement.
- **Live Stripe configuration.** The endpoint's current event set was not seen.
- **Redis/Upstash.** The limiter was mocked in the route tests. Unverified: real bucket counts,
  that `X-RateLimit-Reset` survives the Vercel edge, and the outage policies.
- **Supabase/PostgREST.** The SQL ran on vanilla PostgreSQL 14 with a hand-written shim.
  Unverified: PostgREST's schema-cache reload after `DROP FUNCTION`, and the RPC returning TEXT
  `refund_required` over PostgREST.
- **Rendered UI.** No browser was run. The `resumeUrl` redirect and the "Try again at" text are
  covered by an RTL hook test only.
- **The merged tree with `main` (#33).** Not built or tested (r6).
- **Production.** Nothing was done there: no migration applied, no endpoint change, no deploy.

**Human gestures, in Stripe TEST mode unless noted:**

1. **Processing payment.** Subscribe with a SEPA test IBAN that stays `processing`. While it
   processes, POST another subscription checkout. Expect the exact "payment is still processing"
   409 and no new session. Repeat with a `past_due`/`unpaid` subscription and confirm `resumeUrl`
   opens a payable hosted invoice.
2. **Paused subscription.** Pause a trial subscription (no payment method) and POST checkout.
   Expect a portal URL, confirm the portal can resume the subscription, and confirm the return
   lands on the same host.
3. **Duplicate founding purchase.** Reserve and let the hold release, then reserve again. Pay both
   sessions. Expect:
   - exactly one grant;
   - one automatic refund whose metadata carries the reservation id;
   - `duplicate_refunded_at` set;
   - no refund created a second time by `stripe events resend` of either the completed event or
     the payment-intent-succeeded event.
4. **Async payment failure.** Trigger `checkout.session.async_payment_failed` for a founding
   session with an async method, and confirm the hold is released.
5. **Rate limits, on a preview with `REDIS_URL`.**
   - An 11th new session within 15 minutes gets a 429 and shows "Try again at HH:MM".
   - With Redis blocked, founding returns 503 while subscription and credits proceed.
6. **Operator, production.**
   - Apply `20260925100000` then `20260925110000`, exactly once each.
   - Verify `to_regprocedure('public.claim_subscription_checkout_intent(uuid,timestamptz)') IS NULL`
     and that `complete_founding_agency_purchase` returns `refund_required` for a duplicate.
   - Then deploy.
   - Then update the live endpoint and `retrieve` it to confirm the exact 15-event set.
7. **Before merge.** Resolve the `docs/stories.md` conflict and require green CI on the merged
   head.

## Live Stripe endpoint

The endpoint must hold exactly the 15 events in `docs/operations/stripe-setup.md`.

- **Add now:** `checkout.session.async_payment_failed`, which is new in this fix.
- **Confirm present:** `checkout.session.expired`, which the s33/s34 cutover requires.
- **Not required:** `checkout.session.async_payment_succeeded`, because the grant rides on
  `payment_intent.succeeded`. The route has no handler for `refund.updated` either (see r1).

Max severity: minor
Ship allowed: yes
