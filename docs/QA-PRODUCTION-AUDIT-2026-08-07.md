# Production failure audit — 2026-08-07

Ninety-one ways this application can break in production, found by eight
adversarial read-only audits run in parallel, one per failure domain: auth,
billing, widget, database, API, frontend, infrastructure, data integrity.

Every finding below was derived by reading the code. Each carries a `file:line`
the auditor read, the exact trigger, the mechanism, and the test that would have
caught it. Findings that already existed in
`docs/QA-USER-JOURNEY-2026-08-04.md` as B-1…B-20 are not repeated here; where an
audit sharpened one, it says which.

## What this document is not

It is not a claim that all ninety-one are exploitable today. Three limits, stated
rather than left to look green:

- **Nothing was executed against production.** The database is unreachable from
  the repo (B-3, the stale `SUPABASE_PASSWORD`). Two P0s and four other findings
  are branches of that single unknown.
- **The repo does not describe production.**
  `supabase/migrations/20260801200000_missing_base_tables.sql:42-51` records
  **seven migrations marked applied that rolled back in full**. For
  `content_history`, `staging_history`, `content_versions` and `security_events`,
  a database built from this repo and the live one behave differently, and for
  two of the four we cannot say which side production is on.
- **Only two findings were run rather than read** — the DOMPurify corruption in
  A-1, executed against the repo's own config and dependency, and the env
  precedence in A-8, resolved with the project's own loader.

## Confidence

Findings independently reached by more than one auditor, working from different
starting files, are the ones to trust first.

| Finding | Auditors | Note |
|---|---|---|
| A-1 discovery corrupts customer copy | 3 | two executed DOMPurify and got identical output |
| A-2 site token + optional Origin check | 3 | reached from the widget, the API and the auth lane |
| A-11 site registration is not atomic | 3 | |
| A-16 credit deduction is a lost update | 2 | |
| A-24 middleware runs on the embed asset | 2 | |

---

# Tier 0 — before any code or test work

## T-1. A root `.env.production` resolves live Stripe keys for every production-mode command

`.env.production:101` sets `VERCEL_ENV=production`. `src/lib/stripe/mode.ts:45`
decides live-vs-test on exactly that variable, and its own comment at `:15-22`
explains the fail-safe holds *because the platform sets it and nothing else
does*. A file in the repo root sets it by hand.

Next loads `.env.production` for every `NODE_ENV=production` command, so
`npm run build`, `npm run start` and `npm run prepush` all resolve live mode and
pick up the real `sk_live_…` from `.env`. A Checkout Session created from a local
`npm run start` is created on the live account against a real card — the outcome
`mode.ts` calls "not reversible by a redeploy".

Separately, `.env.production` outranks `.env`, so its placeholder
`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co` (`:10`) is inlined
into the client bundle at build time.

The file is gitignored, so Vercel's own builds are unaffected. This is a
laptop-and-deploy-from-laptop hazard.

**Do:** delete or rename the file (at minimum strip the `VERCEL_ENV` line), and
rotate `STRIPE_SECRET_KEY_LIVE` and `STRIPE_WEBHOOK_SECRET_LIVE` — they have
been resolvable in local production-mode runs for an unknown period.

**Guard:** `scripts/assert-env-sanity.mjs` on `prebuild`, failing when
`VERCEL_ENV`/`VERCEL_URL` are set without `VERCEL`, or when any resolved value
matches `/^(your-|https:\/\/your-)/`.

## T-2. Rotate `SUPABASE_PASSWORD` — it now blocks six findings

B-3 was filed as credential hygiene. It is now the single highest-leverage item
in this document: A-4 and A-9 are two branches of "is `20260731008000` applied to
production?", and A-6, A-13, A-23 and B-12 all wait on the same answer.

---

# P0 — data loss, cross-tenant access, or money taken wrongly

## A-1. Content discovery rewrites the customer's own copy, and truncates it

**Trigger.** A customer installs the widget on a page whose text contains `<` or
`>` — `Setup in <2 minutes`, `Save <50% today`, `Use <div> tags`, `a > b` — or a
paragraph over 2000 characters. No edit, no login, no publish. The first visitor
triggers it; every visitor after sees the damage.

**Evidence.** The widget sends plain `textContent`
(`public/embed/recopyfast.src.js:2363`). The route runs it through an **HTML**
sanitizer and stores the HTML serialization into `original_content`,
`current_content` **and** `published_content`
(`src/app/api/content/[siteId]/route.ts:188-200` →
`src/lib/security/site-auth.ts:195-197` → `content-sanitizer.ts:80-86`).
Executed against the repo's own config:

```
"Setup in <2 minutes"                   -> "Setup in &lt;2 minutes"
"Paste the <script> tag into your page" -> "Paste the "
"Use <div> tags"                        -> "Use  tags"
"Plans & <pricing>"                     -> "Plans &amp; "
```

**Mechanism.** Plain text through an HTML sanitizer, stored serialized, then
written back as plain text with `target.textContent = content`
(`recopyfast.src.js:3239`). `hydrateStoredContent` skips only when
`content === elementData.originalContent` (`:3322`) — the corrupted value always
differs, so it is always applied. `ignoreDuplicates` on the upsert makes it
permanent. Truncation at `MAX_CONTENT_LENGTH` happens *before* sanitizing, so a
cut can land mid-entity.

**Blast radius.** The customer's live page rewrites itself before they have
edited anything. `original_content` is poisoned too, so version restore restores
the mangled copy.

**Test.** `src/__tests__/api/content/discovery-fidelity.test.ts` — POST a content
map containing `<`, a literal tag and a 2500-character string; assert every
stored value is byte-identical to what was posted. Note the existing suite cannot
see this: it mocks `sanitizeIncomingContent` as an identity function.

## A-2. The public site token is the only credential, and its Origin pin is optional

**Trigger.** View source on any customer page, copy `data-site-id` and
`data-site-token`, then call the API from a server sending **neither `Origin` nor
`Referer`**.

**Evidence.** `src/lib/security/site-auth.ts:111,128` — the whole domain check
sits inside `if (requestOriginHost && requestOriginHost !== allowedDomain)`. The
token ships as a plain HTML attribute (`src/lib/sites/embed-script.ts:53`).
`/api/content/[siteId]` carries no rate limit.

**Mechanism.** `Origin` is browser-enforced, never caller-enforced, so the one
check that makes a published credential safe is optional for exactly the caller
it is meant to stop. Element ids are deterministic —
`'rcf-' + hashPath(structuralPath(element))` (`recopyfast.src.js:819-824`) — so
an attacker renders the victim's page headlessly and computes the ids the widget
would use.

**Blast radius.** Unauthenticated read of every content row for a site, and
unbounded service-role writes. `ignoreDuplicates` protects already-recorded rows,
but any id not yet stored — every page the widget has never loaded, every element
added since the last scan, the entire window before first discovery — is
seedable, and `hydrateStoredContent` then serves the attacker's
`published_content` to every visitor. For `<img>` targets the string becomes the
`src`. The same missing check gates `authorizeIngestRequest`, so analytics can be
forged identically.

**Test.** `src/__tests__/lib/security/site-auth-origin.test.ts` — assert
`authorizeSiteRequest` with `origin: null, referer: null` **throws**; plus an
integration case asserting `POST /api/content/:siteId` without `Origin` is
refused.

## A-3. Three of six SECURITY DEFINER functions are still open to any anon caller

**Trigger.** `POST /rest/v1/rpc/revert_staging_content {"p_site_id":"<any site>"}`
with the public anon key. Site ids ship in every customer's snippet.

**Evidence.** `20251230000000_staging_workflow.sql:216,276-277` and
`20260803020000_restore_atomic_publish.sql:101-104` create
`revert_staging_content`, `publish_staging_content` and
`publish_staging_content_atomic` as SECURITY DEFINER with EXECUTE granted to
`authenticated`. `20260805190000_lock_down_content_version_rpcs.sql:50-53`
revokes only `create_content_version` and `restore_content_version`.

**Mechanism.** Identical to the hole that migration closed, and its own header
states the rule: *"Postgres grants EXECUTE to PUBLIC on every new function, so
the REVOKE FROM PUBLIC is what actually closes this"* (`:45-47`). No migration
issues that REVOKE for these three. There is no `FORCE ROW LEVEL SECURITY`
anywhere, so a definer function owned by the table owner bypasses RLS entirely.
None of the three asks who is calling.

**Blast radius.** `revert_staging_content(site, NULL)` overwrites
`staging_content` with `published_content` for every element of any tenant's site
— total silent destruction of unpublished work, no history row.
`publish_staging_content_atomic` pushes any tenant's drafts live.

**Test.** `src/__tests__/db/function-grants.test.ts` — assert
`SELECT proname, proacl FROM pg_proc WHERE prosecdef AND pronamespace='public'::regnamespace`
returns **zero** functions whose ACL contains `anon=X`, `authenticated=X` or a
bare `=X`. List-wide, not per-function, so the seventh such function fails by
default. This one assertion also closes A-5.

**Corrected 2026-08-07 after the invariant was run against a real database.**
An earlier draft claimed it also closed A-22. It does not — A-22 is a hardcoded
`grantLifetime(userId, "pro", …)` in the webhook and has nothing to do with
function ACLs. A-22 needs its own owner.

**And the invariant found more than this audit did.** Against a scratch database
with the migrations applied it reports **34 offending grants across 12
functions** — beyond the five named above, also `get_user_ticket_balance`,
`purge_expired_editor_artifacts`, `update_site_analytics`,
`update_translation_coverage` and three RLS predicate functions. The root cause
is broader than the three missed REVOKEs: Supabase's `ALTER DEFAULT PRIVILEGES`
grants EXECUTE to `anon` and `authenticated` on **every new function in
`public`**, so the next one is exposed at creation with no migration saying so.
The default is exposure, and the invariant is what makes that visible.

Three RLS predicate functions — `user_has_site_permission`, `user_is_team_member`,
`user_has_team_role` — are allowlisted for `authenticated` only. That is measured,
not assumed: revoking them and running `SET ROLE authenticated; SELECT count(*)
FROM site_editors;` gives `permission denied for function
user_has_site_permission`, because RLS predicates evaluate with the querying
role's privileges. Revoking would break every site-scoped policy rather than
harden anything. `anon` and PUBLIC remain forbidden for all twelve.

## A-4. A collaborator with `manager` can delete the owner's only proof of ownership

**Trigger.** Owner shares a site as `manager`, which maps to
`permission:"admin"`. The collaborator calls PostgREST directly with their own
JWT: `DELETE /rest/v1/site_permissions?site_id=eq.<siteId>&user_id=eq.<ownerId>`.

**Evidence.** `20260731008000_rls_policies_for_locked_tables.sql:125-130` — the
DELETE policy is `USING (public.user_has_site_permission(site_id, ARRAY['admin']))`.
`20250817000000_complete_database_setup.sql:16-23` — `sites` has **no owner
column**. `src/app/api/sites/route.ts:22-25` — the dashboard derives the site list
solely from `site_permissions`.

**Mechanism.** The policy authorises per-site, not per-row, so an admin may
delete any row of that site including the creator's. Postgres consults only the
DELETE policy's `USING` for a non-`RETURNING` delete, so the narrow SELECT policy
does not shield it. No last-admin guard, no creator guard. Through the HTTP route
the attack 404s — but only because a pre-read runs under the caller's client and
the SELECT policy hides the row. That is an accident of a read policy, and it
does not exist on the PostgREST path. F-1 already proved this vector is real.

**Blast radius.** The owner irrecoverably loses a paid site: every authorization
helper keys off `site_permissions`, so they cannot read, edit, publish, manage
editors, see analytics, or re-share. The collaborator solely controls the tenant.

**Test.** `src/__tests__/api/sites/share-owner-lockout.test.ts` — assert a user
holding shared `admin` cannot delete the creator's `site_permissions` row, and
that deleting the last `admin` row for a site is refused.

## A-5. Any signed-in user can mint their own wallet balance or zero someone else's

**Trigger.** `POST /rest/v1/rpc/add_tickets {"user_uuid":"<self>","ticket_amount":1000000}`
or `consume_tickets` against another user's id.

**Evidence.** `20260731009000_billing_status_and_ticket_idempotency.sql:152-154`
and `20260617001000_ticket_wallet_compat.sql:176-178` — SECURITY DEFINER with
EXECUTE to `authenticated`; `user_uuid` is caller-supplied and never compared to
`auth.uid()`. The idempotency guard is bypassed by omitting the payment intent
(`20260731009000:118-119`).

**Blast radius.** Bounded *today*: the wallet is orphaned — no caller anywhere in
`src/`, `server/` or `scripts/` — because `20260802020000` collapsed spending onto
`credit_purchases`. But that same migration converts `tickets.balance > 0` into
real `credit_purchases` rows, so a balance minted now becomes spendable if the
chain is ever replayed on a rebuilt database. `consume_tickets` against another
user is a live cross-tenant write regardless.

**Test.** Covered by the A-3 `pg_proc` invariant.

## A-6. Plan change, cancel and reactivate charge Stripe, then fail on an RLS-blocked write

**Trigger.** Any existing subscriber clicks Change plan, Cancel, or Reactivate.

**Evidence.** `src/lib/stripe/subscription.ts:86,186,246` — `await createClient()`,
the caller's RLS-scoped client. `:120-134` — `stripe.subscriptions.update(...
proration_behavior: "always_invoice" ...)` runs **first**. `:147-170` — the DB
update, then `throw`. `20260804130000_restore_missing_rls_policies.sql:54-62`
gives `authenticated` **SELECT only** on `billing_subscriptions` and drops the
old `FOR ALL USING (user_id = auth.uid())` policy that permitted this.

**Mechanism.** With no UPDATE policy, Postgres updates zero rows and returns no
error; `.select().single()` returns PGRST116, the function throws, the route
500s. Stripe is not rolled back. This is the F-1 shape — every other billing
write uses the service-role client; these three were missed.

**Money.** Upgrade: card charged the prorated difference, UI says it failed.
Reactivate: set back to renewing, user told it failed, charged next cycle for
something they believe is cancelled. Cancel: cancelled at Stripe, user told it
failed — the classic chargeback prelude.

**Test.** `src/__tests__/lib/stripe/subscription-rls.test.ts` — against a real
project with an authenticated (non-service-role) client, assert `updateSubscription`
resolves and the stored plan actually changed. The current suite is green because
`src/__tests__/api/billing/subscription.test.ts:18-22` mocks these out entirely.

## A-7. `subscription.updated` / `.deleted` silently succeed on zero rows

**Trigger.** Stripe delivers `updated` before `created` (explicitly unordered;
also the normal SCA sequence, where the subscription is born `incomplete`), or a
`deleted` is lost after Stripe exhausts its retry window.

**Evidence.** `src/app/api/webhooks/stripe/route.ts:367-388` and `:398-405` —
`.update(...).eq("stripe_subscription_id", ...)` with no `.select()`. The guard,
`assertWritten` (`:295-307`), inspects only `error`.

**Mechanism.** supabase-js returns `{error: null}` for a zero-row update.
`assertWritten` passes, the route 200s, Stripe discards the event permanently.
Nothing reconciles from Stripe — `vercel.json` has one cron and it writes blog
posts.

**Money.** Lost `updated`: the row settles at `incomplete`, absent from
`LIVE_SUBSCRIPTION_STATUSES` (`src/lib/billing/effective-plan.ts:19-23`), so a
paying customer is held at the paywall forever while `hasWebhookLanded` reports
success. Lost `deleted`: the account keeps its plan forever, unpaid.

**Test.** `src/__tests__/api/billing/stripe-webhook-ordering.test.ts` — deliver
`updated` (active) with no matching row, then `created` (incomplete); assert the
final stored status is `active`.

## A-8. Winning a dispute leaves the entitlement revoked forever

**Trigger.** A Lifetime Pro buyer files a chargeback and the bank rules in our
favour, or they withdraw it.

**Evidence.** `src/app/api/webhooks/stripe/route.ts:222-223` handles
`charge.dispute.created`. There is no `charge.dispute.closed` case anywhere in
the switch (`:177-240`). `revokeEntitlementForPayment` sets `revoked_at`
(`src/lib/billing/entitlements.ts:118-127`); `revokePurchasedCredits` zeroes the
wallet (`src/lib/credits/system.ts:385-388`).

**Mechanism.** Revocation fires on dispute *creation*, which is provisional. The
compensating event is not subscribed to and the revocation has no reversal.

**Money.** We keep the $199, the customer keeps nothing, and re-granting requires
a manual `plan_entitlements` edit — there is no admin surface.

**Test.** `src/__tests__/api/billing/dispute-lifecycle.test.ts` — post `created`
then `closed` with `status: "won"`; assert `revoked_at` is back to `null`.

---

# P1 — a primary journey blocked, or a paying customer misled

## A-9. Collaborator sharing writes `site_permissions` with a user-scoped client

`src/app/api/sites/[siteId]/share/route.ts:46,195-206` inserts with the anon-key
client. The INSERT policy permitting that exists only in `20260731008000:110-116`;
the migration recorded as applied to production
(`20260804130000:71-80`) restores only SELECT-for-self and FOR ALL to
`service_role`. Both branches are bad: if `20260731008000` is not live, every
collaborator invite 500s and no customer can add a teammate; if it is live, A-4
is fully armed. **Test:** `src/__tests__/api/sites/share-rls.test.ts` — as a site
admin, `POST .../share` returns 200 and the row is readable afterward.

## A-10. Every Edit Board endpoint returns 401 to every caller

`src/lib/auth/staging-access.ts:236-246` passes
`device ?? { userAgentHash: "", ... }`; `staging-device.ts:155` compares that `""`
against a 32-char digest, which can never match. Fifteen call sites omit the
device argument — `edit-board/languages`, `styles`, `styles/apply`, `themes`,
`history`, `history/[versionId]`. Styles, translation, themes and in-widget
version history are dead for 100% of users, and the widget renders an empty list
rather than an error (`recopyfast.src.js:5650-5653`). **Test:**
`src/__tests__/api/edit-board/staging-token-device.test.ts` — verify a token via
`POST /api/staging/verify` with a fixed User-Agent, then assert
`GET /api/edit-board/styles` with the same token and UA returns 200.

## A-35. Site deletion cannot succeed at all — an AFTER DELETE trigger blocks it

**Found while writing the tests for A-11, and measured against a real database
rather than inferred.** It makes A-11 understated: the second delete does not
merely risk failing, it always fails.

`content_change_trigger` is an `AFTER INSERT OR UPDATE OR DELETE` trigger
(`20250817000000_complete_database_setup.sql:542-544`) whose function inserts the
affected row into `content_history`, a table whose FK requires that
`content_elements` row to still exist. On DELETE it does not. Every content
element delete therefore raises:

```
ERROR: insert or update on table "content_history" violates foreign key
constraint "content_history_content_element_id_fkey"
CONTEXT: PL/pgSQL function log_content_change() line 10
```

and the `ON DELETE CASCADE` from `sites` inherits it. The test harness works
around this with `session_replication_role = 'replica'`; the product has no such
escape.

**Blast radius.** No customer can delete a site, and — per A-11 — the attempt
first removes their `site_permissions` row, so the failure leaves them with a
site they can no longer see while it keeps serving content to visitors. A
compliance-motivated deletion does the opposite of what was asked.

**Test.** Covered by `src/__tests__/db/restore-reports-rows.test.ts`'s harness
discovery and by `src/__tests__/api/sites/delete-atomicity.test.ts`; a dedicated
DB-gated case asserting `DELETE FROM sites` succeeds and cascades is the direct
form.

## A-11. Site registration and deletion are both non-atomic

Registration inserts `sites`, then upserts `site_permissions` separately, and on
failure returns 500 **without deleting the site**
(`src/app/api/sites/register/route.ts:120-155`). `domain` is UNIQUE and the
`sites` SELECT policy authorises *through* `site_permissions`, so the orphan is
invisible and undeletable, and the real owner gets "Domain already registered"
forever. Deletion removes `site_permissions` **first**
(`src/app/api/sites/[siteId]/route.ts:47-71`), so a failure on the second delete
leaves a site the customer cannot see while the widget keeps serving its content
— the widget authorises on site token, not permissions. **Tests:**
`src/__tests__/api/sites/register-rollback.test.ts` and
`delete-atomicity.test.ts`.

## A-12. The entire Teams feature is dead on a normal path

Four handlers embed `auth.users` over PostgREST, which cannot resolve it —
`teams/[teamId]/members/route.ts:44`, `invitations/route.ts:49,237`,
`activity/route.ts:48`. The repo already documents and fixed exactly this in
`sites/[siteId]/share/route.ts:14-18,24` via `auth.admin.getUserById`; teams
never got the fix. `invitations/route.ts:168-172` also does `.from("auth.users")`
with the error discarded, so the "already a member" guard silently never runs and
a retry after a 500 answers "Invitation already sent" with no way forward.
**Test:** `src/__tests__/api/teams/members.test.ts` — 200 with a populated
`members[].user.email`.

## A-13. Production may have no INSERT policy on `content_history`, killing bulk update and AI translate

`20250817000000:542-544` creates `content_change_trigger` calling
`log_content_change()`, declared at `:524` **without** `SECURITY DEFINER`, so it
writes as the invoking role. `src/app/api/bulk/update/route.ts:20-30` and
`src/app/api/ai/translate/route.ts:142` both use the anon-key user client. The
policy permitting the insert exists only in the migration recorded as aborted.
An `AFTER ... FOR EACH ROW` refusal aborts the user's own UPDATE. Blocked on B-3.
**Test:** `src/__tests__/api/bulk/update.integration.test.ts` against a local
Supabase seeded to production's policy set.

## A-14. Two pages sharing a layout share one content row

`structuralPath` is built from tag names, sibling indices and the nearest
author-written ancestor `id` — **no URL or pathname component**
(`recopyfast.src.js:731-764`), and the row key carries no page either. `/about`
and `/pricing` on one template hash to the same id; `/about` is discovered first,
`ignoreDuplicates` means `/pricing`'s real headline is never recorded, and
hydration then overwrites `/pricing`'s headline with `/about`'s. Editing either
changes both. The dashboard shows one row where there should be several, so it is
invisible in the product. **Test:**
`src/__tests__/embed/element-id-page-scope.test.ts` — two documents with
identical structure and different text must yield different ids.

## A-15. Rollback collapses every language and A/B variant into one value

`20260805120000_reconcile_create_content_version.sql:66-75` aggregates with
`jsonb_object_agg(element_id, …)` and no `language`/`variant` predicate, but
uniqueness is `(site_id, element_id, language, variant)`
(`20250817000000:38`). N rows collapse to whichever the scan emitted last,
nondeterministically, and `20260804150000:78-82` writes that one string back into
all N. Publish it and the French site serves German. The pre-restore snapshot
collapses identically, so undo cannot recover. `src/lib/ab-testing/lifecycle.ts:188-196`
has the same unscoped-`element_id` bug, and its `content_history` insert at
`:211-215` writes `change_type: "ab_test_winner"` against a CHECK allowing only
create/update/delete — it fails 23514 and the result is never read. **Tests:**
`src/__tests__/db/content-version-i18n.test.ts`,
`src/__tests__/lib/ab-testing/promote-winner-scope.test.ts`.

## A-16. Restore reports success while restoring nothing

`20260804150000:76-85` — a loop of `UPDATE ... WHERE element_id = ...` followed by
an unconditional `RETURN TRUE`. Zero-row updates are not an error in plpgsql, so
neither the function nor the route can tell "restored 40" from "matched none".
After any customer redesign the ids change — the widget concedes this at
`recopyfast.src.js:814-816` — so rollback gives a green toast, an unchanged page
and no error, and the orphaned rows keep counting toward "active".
**Test:** `src/__tests__/db/restore-reports-rows.test.ts`.

## A-17. Concurrent edits are last-write-wins, and the audit trail hides it

`src/app/api/staging/content/[siteId]/route.ts:203-233` — a `select` then a bare
`.update()` with no `updated_at` precondition, version column or `FOR UPDATE`.
`staging_history.previous_content` is read in the same non-atomic window
(`:249`), so the loser's history entry claims `A→C` and denies `B` ever existed.
A real per-element lock exists at `src/lib/collaboration/permissions.ts:243-259`
and is called from nowhere. **Test:**
`src/__tests__/api/staging/content-concurrent-write.test.ts` — two PUTs carrying
the same `expectedUpdatedAt`; the second must 409.

## A-18. Credit deduction is a lost update, and the ledger is written first

`src/lib/credits/system.ts:207-212` inserts `credit_usage`, then `:227-252` does
a read-modify-write on `credits_remaining` with no lock and no compare-and-swap.
Two concurrent 5-credit spends against a 10-credit balance deduct 5 and record 10
used. Conversely a failed deduction leaves the usage row committed, and
`refundCredits` cannot compensate — its idempotency key uses `Date.now()`
(`:349`), which collides at millisecond resolution. **Test:**
`src/__tests__/lib/credits/concurrency.test.ts`.

## A-19. Annual subscribers get 500 credits per year, not per month

`src/lib/credits/system.ts:128-144` uses the subscription's
`current_period_start` as the window; for a yearly plan that is twelve months
back, while `monthly_credits: 500` is defined per month
(`20260802000000_plans_catalog.sql:295`). The variable is named `usedThisMonth`.
An annual Pro customer pays ~$189 up front for one twelfth of the advertised
allowance, then is told to buy credit packs. Extends **B-2**. **Test:**
`src/__tests__/lib/credits/system.test.ts` — `current_period_start` 11 months
ago, 500 used 10 months ago; `total` must be 500, not 0.

## A-20. A partial refund revokes the entire entitlement and the whole wallet

`src/app/api/webhooks/stripe/route.ts:218-219,740-750` routes `charge.refunded`
into `handleMoneyReturned`, which reads only `payment_intent` and revokes
unconditionally. Neither `amount_refunded` nor the `refunded` boolean is
consulted, and Stripe emits this event for partial refunds too. A $10 goodwill
refund on a $199 purchase costs the customer lifetime Pro. **Test:**
`src/__tests__/api/billing/stripe-webhook.test.ts` — `amount: 19900,
amount_refunded: 1000, refunded: false` must not revoke.

## A-21. Two concurrent checkouts create two subscriptions

`src/app/api/billing/checkout/route.ts:106-117` guards with
`getUserSubscription`, reading a table only written by the webhook **after** the
first payment completes. Both sessions are created while the DB shows nothing;
both land as separate rows. The lifetime intent has a real server-side
precondition beside it (`:129-149`); the subscription intent has no
concurrency-safe equivalent. **Test:**
`src/__tests__/api/billing/checkout-concurrency.test.ts` — two parallel POSTs;
exactly one session, second returns 409.

## A-22. `checkout.session.completed` hardcodes the granted plan

`src/app/api/webhooks/stripe/route.ts:723` calls `grantLifetime(userId, "pro", …)`
while `:691` uses `metadata.grants_plan_id`. Session metadata deliberately omits
that key (`src/lib/stripe/checkout.ts:215`). `plan_entitlements.stripe_payment_intent_id`
is UNIQUE, so whichever event arrives first silently decides what a $199 purchase
bought, and the `grantsPlanId` validation is bypassed on that path. **Test:**
`src/__tests__/api/billing/one-time-purchases.test.ts`.

## A-23. `create_content_version` races its own UNIQUE constraint

`20260805120000:59-60` computes `MAX(version_number) + 1` with no lock, inserting
into a table declared `UNIQUE(site_id, version_number)`. The window is the whole
snapshot build, which aggregates every row for the site — milliseconds to
seconds. Worse, `restore_content_version` takes its pre-restore snapshot *inside*
the restore (`20260804150000:70-72`), so a collision aborts the rollback — the
one operation a customer reaches for when something has already gone wrong.
**Test:** `src/__tests__/db/content-version-concurrency.test.ts` — 20 concurrent
calls must yield 20 distinct version numbers.

## A-24. Middleware runs on the embed asset and every widget API call

`src/middleware.ts:231` excludes `_next/static` and five image extensions but not
`.js`, so `/embed/recopyfast.js` — a static file in `public/` — is served through
a Node middleware (`:10`) that calls `await supabase.auth.getUser()` (`:84`), a
GoTrue round trip, before returning bytes to a visitor with no cookie. Volume
scales with *customers'* traffic. It also couples widget availability to GoTrue.
**Test:** extend `src/__tests__/middleware.test.ts` with a matcher table
asserting `/embed/**`, `/robots.txt` and `/sitemap.xml` do not match.

## A-25. Site tokens expire at 90 days with nothing rotating the installed copy

`src/lib/security/site-auth.ts:53,71` enforces a 90-day age. `buildSiteToken` is
called only when the dashboard renders a fresh snippet
(`sites/register/route.ts:158`, `sites/route.ts:98`); nothing rotates the static
string already pasted into the customer's HTML, and the widget has no refresh
path. The dashboard always shows a valid snippet, so the owner cannot notice.
Compounding it, the 401 at `content/[siteId]/route.ts:74-87` is returned
**without** `withCors(...)`, so the browser blocks the body and the widget lands
in its network `catch`. **Tests:** assert auth-failure responses carry CORS
headers; assert a 91-day-old token surfaces an actionable state.

## A-26. Link and image-alt edits are accepted, confirmed, and thrown away

The widget sends `href` and `alt` as extras (`recopyfast.src.js:4675,4612-4617`);
the PUT handler updates only `staging_content`, `staging_updated_at`,
`updated_at` (`staging/content/[siteId]/route.ts:223-233`) — `grep href` returns
nothing. `persistContentUpdate` treats any 2xx as success and applies the change
locally, so the editor watches the link change in their own tab. Visitors keep
clicking through to the old destination forever. **Test:**
`src/__tests__/api/staging/content-href.test.ts` — assert on the persisted row,
not the 200.

## A-27. `data-ws-url` is always emitted, so "opt-in" real-time is on everywhere

`src/lib/sites/embed-script.ts:26-42` falls through to the app origin when
`NEXT_PUBLIC_WS_URL` is unset and always emits the attribute (`:53`). So
`RECOPYFAST_WS` is truthy, the early return at `recopyfast.src.js:2703` never
fires, and `io()` retries against an origin serving no Socket.IO endpoint. Worse,
`this.socket` is non-null but never `connected`, so `sendContentMap`
(`:2826-2834`) pushes the full content map into socket.io's `sendBuffer` on every
rescan — every 500ms on a carousel or infinite-scroll page — and it is only
flushed on connect. Extends **B-4/B-5**. **Test:**
`src/lib/sites/__tests__/embed-script.test.ts` — omit the attribute when the env
var is unset; plus a jsdom test that `sendContentMap` does not emit while
disconnected.

## A-28. Device grants have no absolute lifetime and the client picks its own TTL

`src/app/api/editor/refresh-grant/route.ts:31` takes `rememberDevice` from the
request body and passes it to `issueDeviceGrant`
(`src/lib/auth/editor-grants.ts:450-456,162-165`). The server never re-derives
the choice from the row it is rotating, and rotation re-anchors expiry from
`Date.now()` with no reference to when the lineage began — so a grant can be
rotated forever. Contrast `edit-sessions.ts:50`, which has an issue-time-anchored
ceiling. `editor-grants.ts:250-256` is explicit that the origin binding "stops a
copied token, not a forged header". Extends **B-13**. **Test:**
`src/lib/auth/__tests__/editor-grants.ttl.test.ts`.

## A-29. Edit-session tokens are handed to the browser inside a URL

`src/app/api/edit-sessions/create/route.ts:121` builds
`https://${site.domain}?rcf_edit_token=${token}`. The widget strips it only after
the page loads (`recopyfast.src.js:91-100`), by which time the full URL is in the
customer's access logs, any CDN or server-side analytics on that host, and
readable by every third-party script via `location.search`. The token carries the
owner's permissions, has no origin or device binding, and its IP check
deliberately does not reject. Secondary: `site.domain` is stored with a scheme in
some rows, yielding `https://https://example.com?…`. **Test:**
`src/__tests__/api/edit-sessions/create.test.ts` — the token must not appear in
`editUrl`.

## A-30. `/api/health` is blind to Redis, the dependency that takes down editor login

`src/app/api/health/route.ts:20` declares `cache?: ServiceCheck` and nothing
populates it; `:193-197` runs database, storage and external services only, and
`HEAD` (`:299-305`) checks the database alone. Meanwhile
`src/lib/security/rate-limiter.ts:172-176` throws without `REDIS_URL` in
production and `src/lib/api/rate-limit.ts:99` defaults to `onStoreFailure: "deny"`
— `.env.example:110-114` states in capitals that blowing the command quota takes
down editor login. The uptime probe reports green through exactly that outage.
**Test:** add `checkCache()`; assert a throwing limiter yields 503.

## A-31. One failing site blanks the entire Content page

`src/app/dashboard/content/page.tsx:149-159` — `Promise.all` over every site
rejects on the first failure and discards the resolved results, and the error
short-circuits the whole render at `:223-246`. The F-4 fix traded "shows nothing,
says you have none" for "shows nothing, names one site". A Pro customer with one
broken site cannot reach content on any working one. **Test:**
`src/__tests__/app/dashboard/content/page.test.tsx` — site A renders while site B
shows a per-site failure notice.

## A-32. The pinned hero demo fights touch scrolling, and has no reduced-motion escape

Two owners of `scrollTop`: the demo viewport is `overflow-y-auto`
(`InteractiveHero.tsx:738`) and `applyDemoScroll` writes it on every MotionValue
change (`:172-177`). Lenis is constructed without `syncTouch`, `prevent` or
`allowNestedScroll` (`useLenis.ts:157-172`) and does not `preventDefault` on
touch, so a swipe scrolls the nested element natively while page scroll
overwrites it — the demo snaps back to its top on every gesture that chains to
the page. No `overscroll-behavior` or `touch-action` anywhere in `src/`.
Separately `HeroDemo.tsx:43-99` never calls `useReducedMotion`, so a reader who
asked for less motion gets a 320vh pinned scroll-driven track *and* inherits the
conflict, because `useLenis.ts:127` skips Lenis for them. **Tests:**
`e2e/hero-demo-mobile.spec.ts`; `src/components/landing/__tests__/HeroDemo.test.tsx`.

## A-33. The editor toolbar's Save and Cancel sit off-screen on a phone

`InteractiveHero.tsx:204` declares `toolbarWidth: 420`;
`useFloatingPosition.ts:95-98` clamps `left` to a minimum but never shrinks,
wraps or reflows, and `FloatingEditorToolbar.tsx:97-101` renders `fixed` with
~410px of content. On a 390px viewport Save and Cancel — the last two children —
are past the right edge and nothing can scroll to them. The demo's advertised
primary action has no reachable confirm or cancel on mobile. **Test:**
`src/components/editor/__tests__/FloatingEditorToolbar.viewport.test.tsx` —
`left + scrollWidth <= innerWidth` at 390px.

## A-34. The attract loop does not stop on `/demo`

The engagement signal lives inside the `if (!demoScrollProgress) return` branch
(`InteractiveHero.tsx:180-192`), and `src/app/demo/page.tsx:83` renders
`<InteractiveHero />` with no scroll progress. So on the page the hero's "Watch
it work" button targets, the tabs keep cycling every 6s while the visitor reads,
discarding their scroll position on each switch. Introduced 2026-08-06 with the
hero demo; the verification covered the landing page only. **Test:**
`src/components/landing/__tests__/InteractiveHero.test.tsx` — fire a scroll on
the demo viewport, advance 7s with fake timers, assert the active tab is
unchanged.

---

# P2 / P3 — real cost, no immediate customer harm

Recorded so they are not rediscovered. Each has a `file:line` in the source
audits.

- **CORS credential reflection.** Seven routes reflect the caller's `Origin`
  alongside `Access-Control-Allow-Credentials: true` — the combination
  `src/lib/http/public-cors.ts:17-24` exists to prevent. Latent only because
  Supabase's SSR default is `sameSite: "lax"`, a library default never pinned.
- **Token-authorized responses marked `Cache-Control: public`.**
  `ab-tests/active/[siteId]` with `ACAO: *` and no `Vary`; a cached 401 poisons
  the widget for 5 minutes, a cached 200 is replayable without the token.
- **A second, worse rate limiter.** `src/lib/api/rate-limiter.ts:165-174` fails
  open by design, `:131-134` runs an unscoped `DELETE` per request, `:137-157` is
  a non-atomic count-then-insert. The correct Redis limiter already exists.
- **Unvalidated `limit`/`offset` reach `.range()`** in four routes — `?limit=abc`
  yields a 500, a huge limit is honoured. The `security_events` count query is
  not scoped to the caller's sites.
- **In-memory "security" state on serverless** — `abuseDetector`,
  `ContentRateLimiter`, `DomainVerificationChecker.verificationCache`. Per-isolate
  Maps that enforce nothing; two have no callers.
- **`originBelongsToSite` accepts any subdomain** while `authorizeSiteRequest`
  demands an exact host — two answers to one question, and the weaker one guards
  grant minting.
- **The A/B lifecycle cron exists only in a comment.** `vercel.json` has one
  cron and it writes blog posts, so tests never complete.
- **`ALLOWED_ORIGINS` is read by no code that runs**, while
  `docs/DEPLOYMENT-ENV.md:17` instructs operators to maintain it.
- **CI never sets `STRIPE_LIFETIME_PRICE_ID`** — the one variable whose absence
  made Lifetime Pro unbuyable (F-9) is the one the CI env block omits.
- **The CI E2E job cannot pass once enabled.** `next start` is
  `NODE_ENV=production`, the limiter then demands Redis, the job defines none,
  and deny-by-default turns that into 503 on every gated route.
- **`/api/v1/content` writes live columns with no draft, snapshot or history.**
- **Version snapshots prefer `staging_content`**, so no version records what
  visitors were actually seeing; "roll back to Tuesday" is unanswerable.
- **`edits_count` reads a table the edit path never writes.** Either always 0, or
  it counts the discovery insert — one "edit" per discovered element on day one.
  `total_page_views` reads `user_activity_logs`, whose only producer is
  instantiated nowhere. Explains **B-15**.
- **The version-id existence oracle is still open** — `hasAnyCredential` tests for
  the presence of a token, not its validity.
- **`/api/edit-sessions/extend` cannot extend anything** with its own documented
  payload, and has no caller — the other half of **B-19**.
- **The demo puts 21+ `role="button"` stops** between the hero and Pricing;
  `role="tablist"` promises arrow-key navigation `BrowserWindow.tsx:86-112` does
  not implement. Extends **B-8**.
- **The layered sky shader runs at 60fps for the whole visit on every phone** —
  the small-screen guard downgrades the path but never stops the loop.
- **Double-loading the snippet creates two widgets**, the first unreachable and
  un-destroyable; `document.currentScript` is read unguarded twice, so a
  `type="module"` load throws on the customer's page; `startPolling` runs forever
  applying nothing (`elementId` vs `element_id`).
- **The floating toolbar never re-measures** its target; its rescue listener walks
  upward from `body` and can never reach the demo's scroller.
- **Root `dependencies` ships the whole Express/socket.io stack** no deployed file
  imports, gating every PR behind `audit:prod`.
- **`next.config.ts`'s `webpack()` is dead** — Next 16 builds with Turbopack.
- **Two sources of truth for security headers disagree**, and neither sets HSTS.
- **`POST /api/security/events` has no authentication call at all**; only RLS
  stops the write, and this codebase's habit for that is to swap in the service
  role.
- **`billing/checkout` returns raw internal error text** — it already shipped a
  Postgres policy name to a paying customer.
- **`sites/register` lets any account squat any domain**; verification gates
  nothing.
- **Malformed site tokens surface as a Node `RangeError`** from
  `timingSafeEqual` on a length mismatch.
- **Unbounded ingest** on `ab-tests/track` and `bucket/[siteId]`; `null` body
  yields a 500.
- **`POST /api/bulk/import`** has no item cap and does 2 sequential round trips
  per item, dying mid-loop and leaving `status: "running"` forever.
- **Every rescan walks `querySelectorAll('*')`** and the element map only grows —
  no `isConnected` check, no cap.
- **The analytics dashboard pulls 30 days of rows into Node** to compute a count.
- **Version history renders server strings via `innerHTML`** in three places, in
  the customer's origin.

---

# Disproved — do not re-chase

Auditors were asked to try to refute their own findings. These were dropped:

- **WebGL-unavailable crash on `/`** — `three` does throw, but R3F 9 constructs
  the renderer inside an un-awaited `async run()`, so it lands as an unhandled
  rejection, not a React error, and the CSS gradient fallback does show through.
- **`EditableImage`'s `fixed inset-0` dialog inside a transformed ancestor** —
  framer emits `transform: none` at rest, so there is no containing block and the
  dialog is genuinely viewport-fixed.
- **`useContentElements` stale-fetch race** — its only consumer is under
  `_ab-tests/`, which the `_` prefix keeps unrouted.
- **`STRIPE_CONFIG.PUBLISHABLE_KEY` resolving the wrong key in a browser bundle**
  — nothing outside its own file references it.
- **`winston-daily-rotate-file` as a serverless hazard** — file transports were
  already removed; it is a dead dependency, not a runtime risk.

---

# Test conventions for this backlog

1. **A test for an unfixed defect uses `test.failing()`.** Jest 30 passes it
   while the bug exists and **fails it the moment the bug is fixed**, which is the
   signal to delete the marker. The suite stays green, and no marker can be
   forgotten silently. Never `skip` — a skipped test verifies nothing.
2. **Tests needing a database are gated**, not skipped by hand: they check for a
   local Supabase and are excluded from the default run, so `npm test` works on a
   laptop with no DB.
3. **Assert on stored state, not on the response code.** Half the findings here
   are routes that answer 200 while writing nothing, or write the wrong thing.
4. **Where an existing mock hides the defect, the test must not use it.**
   `sanitizeIncomingContent` is mocked as an identity function, and the three
   Stripe subscription functions are mocked out entirely — both are why the suite
   is green today.
