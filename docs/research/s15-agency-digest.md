# Research — Story s15-agency-digest

> **Review status warning.** `docs/reviews/stories.md` (second-pass review) ends `Max severity:
> major` / `Stories ready: no`. The blockers are renumbering/reference defects in `prd.md` and
> dependency-graph issues in `s07`/`s08`/`s13` — none of the six majors name `s15` directly.
> Operator confirmed proceeding despite `Stories ready: no`. This research therefore treats
> `s15`'s own text as reviewed-but-not-cleared: its dependencies (`s13`, `s14`) carry defects
> recorded in the review that this document does not re-litigate.

## The five structuring facts

1. **`src/lib/email/resend.ts:48-141`** — `send()` takes `{to, subject, html, text}` with no
   HTML→text conversion; every caller hand-writes both parts independently, and there is no
   shared template shell.
2. **`docs/design-system.md:182-205`** — confirms the premise verbatim: `system-ui` font stack,
   Tailwind slate hexes (`#0f172a`, `#475569`, `#94a3b8`, `#f1f5f9`), zero teal, duplicated
   markup across the two existing templates, and explicitly names `s15-agency-digest` as the
   story that must keep the plain-text-part criterion.
3. **No `account_milestones` table exists** (`grep` across `supabase/migrations/` and `src/`
   returns nothing) — `s03-activation-funnel`, which `s15` depends on for its activity data, is
   itself unbuilt. `s15` cannot be planned against data that does not exist.
4. **No "agency" plan and no plural client-grant view exist** — `plans.ts` holds only `starter`,
   `pro`, `credits`, `lifetime_pro` (`grep "agency"` returns nothing); `s13-agency-plan` and
   `s14-agency-client-handoff`, both direct dependencies of `s15`, are unbuilt. "Each agency
   account" and "edits per client site" have no referent in the current schema.
5. **No unsubscribe/preference storage exists** — `grep -rl "unsubscribe\|email_preferences\|
   notification_preferences\|digest"` across migrations and `src/` returns zero hits outside this
   story's own future work. The unsubscribe criterion has nothing to check against or write to.

## Target story

`s15-agency-digest` — "show the agency what it saved." Complexity in `stories.md`: **3**
("scheduled job, aggregation and email"). Dependencies declared: `s14-agency-client-handoff`,
`s03-activation-funnel`.

### Acceptance criteria (verbatim from `docs/stories.md:752-759`)

- [ ] A monthly email to each agency account reports edits per client site for the period, read from `s03`'s activity data.
- [ ] The email states a total edit count and an estimated time saved, and names the per-edit assumption used.
- [ ] An account with zero edits in the period receives no email.
- [ ] The digest is idempotent: what was sent is recorded before sending, and a re-run for the same period sends nothing twice.
- [ ] The email renders correctly as plain text, asserted by a test on the text part — no HTML tags, all links present as URLs.
- [ ] Recipients can unsubscribe from the digest without affecting transactional email.
- [ ] Send failures are logged with account and period, and are retryable without duplicating successful sends.

## Current state of the code

- **Email**: `src/lib/email/resend.ts` (141 lines). Two exported senders,
  `sendStagingVerificationEmail` and `sendEditorAccessCode`, both following the same shape:
  hand-built `text` (array of strings joined with `\n`), hand-built inline-styled `html`, both
  passed to a private `send()` that calls `resend.emails.send()`. `isEmailProviderConfigured()`
  exists for callers that must answer "can we even mail" before doing a lookup — the digest job
  should use the same check before querying accounts, not after.
- **Cron**: two examples exist, both same shape. `src/app/api/cron/generate-blog-post/route.ts`
  (scheduled in `vercel.json`, daily 14:00) and
  `src/app/api/cron/ab-test-lifecycle/route.ts` (route exists, **not** in `vercel.json` — confirmed,
  `vercel.json` has exactly one cron entry). Both authorize via
  `Bearer ${process.env.CRON_SECRET}` compared to the `authorization` header, fail closed
  (`401`) when the secret is unset or mismatched. `ab-test-lifecycle` uses
  `createServiceRoleClient()` and loops over rows with per-row try/catch so one failure doesn't
  abort the batch — the right shape to imitate for per-account send failures.
- **`vercel.json`** — one cron only (`generate-blog-post`, `0 14 * * *`). A digest job needs a
  new entry, e.g. monthly (`0 9 1 * *` or similar) — the story's own agentic notes say "vercel.json
  carries cron configuration," confirmed exactly.
- **Activity/milestone data**: `s03`'s `account_milestones` table does not exist. What does exist:
  `user_activity_logs` (`supabase/migrations/20250817000000_complete_database_setup.sql:305`,
  columns extended by `20260731005000_analytics_schema_alignment.sql` — `action_type`,
  `resource_type`, `resource_id`, `session_id`, `timestamp`), and `src/lib/analytics/tracker.ts`.
  Neither is per-client-site edit counts scoped to an agency account; both are raw event logs, not
  the aggregated read model `s15`'s criteria assume.
- **Idempotency precedent in this codebase**: `billing_events` has a
  `UNIQUE (stripe_event_id)` constraint (`20260731003000_missing_tables_billing_credits.sql:35-36`)
  — the "insert-first, let the unique constraint reject a duplicate" pattern. This is the closest
  existing model for "record what was sent before sending" and is a stronger primitive than what
  `webhook_deliveries` does (webhook delivery logs are append-only with no dedupe constraint;
  retries create new rows with no protection against double-processing at the caller level —
  **not** a pattern to copy for this story's idempotency criterion).
- **Site ownership / "agency account"**: `site_permissions` (`admin` row) is the ownership record,
  read via `countOwnedSites` in `src/lib/feature-gating/permissions.ts:79`. An "agency account" as
  a concept (vs. any account that owns >1 site) is not defined anywhere in code or schema today —
  it is a `plans.id = 'agency'` row that `s13` has not created.
- **Grants**: single-site, non-plural editor grants exist and are functional —
  `src/lib/auth/editor-*.ts`, `/api/editor/*`. The "plural" cross-site version and the "recent
  edits across all sites" view that `s15`'s AC1 depends on ("edits per client site... read from
  s03's activity data") is `s14`'s undelivered scope, not today's.

## Anchor points

- `src/lib/email/resend.ts:48-82` — `send()`, the seam every new template must call through.
- `src/lib/email/resend.ts:44-46` — `isEmailProviderConfigured()`, the pre-flight check.
- `src/app/api/cron/ab-test-lifecycle/route.ts` — closest existing cron shape: auth, per-row
  try/catch, structured JSON response.
- `vercel.json` — cron registration point.
- `20260731003000_missing_tables_billing_credits.sql:19-45` — `billing_events`, the idempotency
  ledger pattern (unique constraint written before/at the send attempt).
- `src/lib/feature-gating/permissions.ts:79-95` — `countOwnedSites`, the only existing
  "how many sites does this account own" function; a digest job needs an analogous
  "which accounts own ≥1 site with ≥1 edit this period" query and none exists.
- `docs/design-system.md:182-205` — the email design gap this story must close (shared shell,
  literal token-derived hex values, plain-text-part rule).

## Verified APIs / functions

- `send(opts: {to, subject, html, text}): Promise<SendResult>` — private to `resend.ts`, not
  exported. A new template function must be added to `resend.ts` itself (or a new module that
  imports and calls the same private surface indirectly by adding an exported wrapper) — there is
  no public generic "send arbitrary email" export today. Confirmed by reading the full file: only
  `isEmailProviderConfigured`, `sendStagingVerificationEmail`, `sendEditorAccessCode` are exported.
- `SendResult = { sent: boolean; error?: string }` — the return shape any digest send-failure
  logging must key off.
- Cron auth: `authHeader !== \`Bearer ${cronSecret}\`` with `!cronSecret` also failing closed —
  copy this exact check, do not invent a second cron-auth path.
- **No existing function computes "estimated time saved."** This must be a new, explicitly stated
  constant (e.g., "10 minutes per edit") surfaced in the email copy itself, per the story's own
  agentic note. No API to verify here — the premise is that this figure must be invented as a
  declared assumption, not measured, and the story is explicit that presenting it as measurement
  is the failure mode to avoid.

## Traps & constraints

- **Dependency-chain trap.** `s15` depends on `s14` (agency-client-handoff), which depends on
  `s13` (agency-plan) and `s03` (activation-funnel). `s15` also directly depends on `s03`. **None
  of s01, s03, s13, s14 exist in code today.** This is not a story that can be planned in
  isolation — its data source (`account_milestones`, owned by `s03`), its subject (an "agency
  account", owned by `s13`), and its per-client-site grouping (owned by `s14`) are all still
  fictional. Planning `s15` today means planning against three other stories' undelivered
  interfaces.
- **Idempotency under retry** (flagged in the story, confirmed real). Cron platforms retry on
  timeout/5xx. The digest job must write a "digest sent for (account, period)" row **before**
  calling `send()`, with a unique constraint on `(account_id, period)` so a concurrent/duplicate
  cron invocation fails the insert rather than double-sending. `billing_events`'s
  `stripe_event_id` unique constraint is the direct precedent to reuse the shape of — no table
  for this exists yet and one must be created in this story (or in `s03`, if `s03` is asked to own
  a `digest_sends` ledger — an open question, see below).
- **Plain-text testability seam.** Because `send()` requires the caller to hand-build `text`
  separately from `html` (no auto-derivation), the testable seam is straightforward: build the
  digest's `text` string as a template-literal/array-join in the new module (matching
  `sendStagingVerificationEmail`'s pattern exactly), and assert on it directly with a regex for
  `<[^>]+>` (no tags) and a check that every link in `html` also appears as a bare URL in `text`.
  This is mechanically easy — the trap is only in forgetting to keep `text` and `html` in sync as
  the template evolves, since there is no shared-shell mechanism yet (design-system gap #3,
  confirmed).
- **No shared email shell exists.** `docs/design-system.md` explicitly names this as an open gap
  and explicitly names `s15` as inheriting the plain-text-part rule. If `s15`'s agentic notes or
  a plan assume a shared shell already exists, that is false — it does not. Building it (or
  choosing not to and accepting a third off-palette template) is in scope for this story's design
  phase, not a pre-existing utility to call.
- **No unsubscribe/preference storage exists anywhere in the schema.** The unsubscribe criterion
  ("without affecting transactional email") requires a new table/column distinguishing digest
  opt-out from account-level email settings, since no such distinction is representable today.
  Transactional sends (`sendStagingVerificationEmail`, `sendEditorAccessCode`) have no
  configurability gate at all currently — they always send. A naive global "email off" flag would
  violate the criterion by silently affecting those too.
- **"Estimated time saved" trust trap.** The story explicitly requires the per-edit assumption
  (e.g., "we count 10 minutes per edit") to be stated in the email copy itself. This is a content
  requirement, not just a data requirement — a plan that computes a number without also writing
  the sentence that discloses the assumption fails this criterion even if the arithmetic is right.
- **Zero-edit accounts must receive nothing**, which means the query must be able to cheaply
  determine "zero edits this period" *before* deciding to render/send — not filter after building
  the email. Given `account_milestones` doesn't exist yet, this shape is entirely dependent on
  what `s03` actually delivers (an aggregate table vs. a scan).
- **`ab-test-lifecycle` cron exists but is NOT in `vercel.json`** — i.e., an unscheduled cron route
  is a known, tolerated state in this codebase (the route exists, works if hit, but nothing
  triggers it automatically). This is relevant precedent: it shows this codebase has shipped
  "cron logic without cron scheduling" before, which is a trap for `s15` too if scheduling is
  overlooked or deferred silently.

## Open questions

- **What exactly does `s03`'s `account_milestones` table (and any per-edit activity log it
  produces) look like?** `s15`'s agentic notes say to read from "`s03`'s activity data," but
  `s03`'s own acceptance criteria describe `account_milestones` as four *milestone timestamps per
  account* (confirmed → first site registered, first verified install, etc.), not a per-edit,
  per-client-site log with counts. `s03`'s AC8 does say "this story's `account_milestones` table
  is the single source for account-level edit activity; `s14` and `s15` read from it rather than
  re-aggregating the activity log" — but a four-timestamp milestone table cannot itself supply
  "edits per client site for the period" or a "total edit count." Either `s03` is expected to also
  build a richer per-edit aggregate (beyond the four milestones described in its own ACs), or
  `s15` needs a second data dependency `s03` doesn't currently name. **This is a real gap between
  what `s03` promises and what `s15` needs — flag rather than assume a schema.**
  s: [`stories.md:198-234`] `s03`.
  ⚠ **Was NOT settled here** — depends on `s03` being researched/planned first, or on `s15`'s
  plan phase making an explicit, stated assumption about `s03`'s eventual shape.
- **What defines "an agency account" mechanically once `s13` exists?** Is it
  `plans.id = 'agency'` on the account's current subscription, or does a formerly-agency account
  that downgraded still get the digest for a trailing period? Not specified in `s15` and not
  resolvable without `s13`'s actual schema.
- **Does the "digest sent" idempotency ledger belong to `s15` or to a shared table `s03`/other
  cron jobs also use?** No existing precedent for a generic "scheduled job dedupe" table; only the
  Stripe-specific `billing_events` exists. A new table scoped to this story
  (e.g., `agency_digest_sends(account_id, period, sent_at)` unique on `(account_id, period)`) is
  the minimal correct answer, but this should be confirmed at plan time, not invented here.
- **Unsubscribe storage: new column on an existing account/preferences concept, or a new table?**
  No existing "preferences" table of any kind exists to extend. This is greenfield schema work
  this story's complexity score does not obviously account for.
- **Where does "estimated time saved" per-edit assumption live** — hardcoded constant in the
  digest module, or a configurable value (env var / admin setting)? Not specified; the story only
  requires it be *disclosed*, not configurable.

## Real complexity

**Stories.md scores this 3** ("scheduled job, aggregation and email — reuses existing patterns").
Reading the code, the individual mechanics the story names *are* genuinely simple and match
existing patterns closely: cron auth (copy `ab-test-lifecycle`), per-account try/catch send loop
(same file), plain-text assertion (mechanically trivial given `resend.ts`'s existing
hand-built-text convention), and a `billing_events`-style unique-constraint idempotency ledger (a
direct, well-understood precedent). None of that alone pushes complexity up.

What the story's stated complexity does **not** account for:

1. **Three undelivered upstream dependencies** (`s01`→`s13`→`s14`, and `s03`) that this story's
   every acceptance criterion is worded against (`account_milestones`, "agency account," "edits
   per client site"). This isn't a risk internal to `s15`'s own implementation — it's that `s15`
   cannot be *correctly planned* today without either (a) those stories landing first, or (b) the
   plan phase inventing placeholder assumptions about interfaces three other unbuilt stories will
   define, which then have to be reconciled later.
2. **Two pieces of net-new schema not mentioned in the story's agentic notes**: an idempotency
   ledger table, and unsubscribe/preference storage. Both are small individually but are real
   migrations with RLS policies (mandatory per `AGENTS.md` non-negotiable #6), not "reuse of
   existing patterns."
3. **A shared email shell** is a real design-system-flagged gap this story sits directly on top
   of (`docs/design-system.md` names `s15` explicitly). Building the third template without a
   shell continues the drift the design system flags as a problem; building the shell is scope
   the story's complexity-3 estimate doesn't obviously include.

None of this pushes the story to a **5** on its own technical surface area — the send/cron/test
mechanics really are a 3-shaped problem once the schema exists. The complexity risk here is
almost entirely **sequencing risk**, not implementation risk: this story is not executable in
isolation from `s03`/`s13`/`s14`, and research/planning done now rests on assumptions about their
future shape. Re-scored: **3, unchanged from stories.md, with a strong caveat** — the 3 is
accurate for the email/cron/idempotency mechanics themselves, conditional on `s03`, `s13`, `s14`
landing first (or their relevant interfaces being frozen by explicit, documented assumption before
`s15` is planned). If those three are not sequenced ahead of `s15` in practice, the effective
complexity of *this* story becomes materially higher because its own author would also be
inventing the schemas of three other stories.

No split proposal — the story's own scope is coherent and not a 5. The correct mitigation is
sequencing (build `s03`/`s13`/`s14` first), not splitting `s15` itself.
