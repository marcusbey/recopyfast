---
validated: yes
---
# Plan — Story s15-agency-digest

Branch: `feature/s15-agency-digest`
Research: `docs/research/s15-agency-digest.md` — read it first; this plan does not repeat it.

## Target story

`s15-agency-digest` — "show the agency what it saved" (`docs/stories.md:855-873`). Complexity 3.
Seven acceptance criteria: monthly per-client-site edit report, disclosed time-saved estimate,
zero-edit accounts get no email, send-before-record idempotency, a plain-text part with no tags
and every link as a bare URL, digest-only unsubscribe, and retryable-without-duplication failure
handling.

**Corrected dependency, per research and the team-lead's brief.** `docs/stories.md` still declares
`s14-agency-client-handoff` and `s03-activation-funnel` as this story's dependencies, but `s14` was
split at research time. The split's own text is explicit:
`docs/research/s14-agency-client-handoff.md:399-400` — *"[`s14c`] is also `s15-agency-digest`'s
real dependency."* **This plan depends on `s14c-cross-site-edit-activity`, not `s14` as a whole.**
`s14c`'s design (`docs/designs/s14c-cross-site-edit-activity.md:13-19`) already names the row shape
this story needs: *"site, editor, element, changed value, timestamp — one row per edit."* `s14c`
itself depends on `s14b` and `s03` (`docs/research/s14-agency-client-handoff.md:399`), so `s15`'s
declared `s03` dependency is satisfied *transitively*, through `s14c`'s read model — not directly.
`account_milestones` (`s03`'s own deliverable, four write-once timestamps) cannot answer "edits per
client site" on its own; both `docs/research/s15-agency-digest.md:170-181` and
`docs/research/s14-agency-client-handoff.md:270-275` (T6) confirm this independently. This plan
does not read `account_milestones` directly anywhere.

**None of `s03`, `s13-agency-plan`, `s14c` are built** (confirmed: no `account_milestones` table,
no `agency` plan row, no `docs/plans/s14c*.md`, no `docs/plans/s03*.md`, no `docs/plans/s13*.md`
exist as of this writing). This plan does not invent their schemas. Where a task needs one of
their outputs, the task states the exact interface assumed — named, typed, and cited to the design
or research document it is drawn from — and is written so that everything on this story's own
side is genuinely buildable and testable today, against a fake of that interface, exactly as
`src/__tests__/api/billing/stripe-webhook-ordering.test.ts` and
`src/__tests__/lib/credits/concurrency.test.ts` already fake the Supabase client for
constraint/concurrency behavior this repo has no live-database test harness for. See
**Run interdicts** for what happens at the two points this story's own code touches those
unbuilt interfaces.

## Tasks (ordered)

1. **Migration — `agency_digest_sends` + `digest_email_preferences`.**
   New file `supabase/migrations/20260814000000_agency_digest_schema.sql` (next free timestamp
   after `20260813140000_site_permissions_delete_per_row.sql`). Both tables, RLS and the two
   policies per `docs/decisions/011-agency-digest-idempotent-send-ledger.md` — that ADR is this
   task's spec, follow it exactly (claim-then-update `ON CONFLICT ... DO UPDATE ... WHERE status
   != 'sent'`, not a plain reject-on-conflict). `account_id UUID REFERENCES auth.users(id)`,
   matching `billing_events`' own FK target.
   **Test:** `src/__tests__/lib/email/digest-ledger.test.ts` (written now, exercised by task 5)
   asserts against a fake Supabase client, faithful to the `ON CONFLICT ... WHERE` semantics, that
   a duplicate claim for an already-`'sent'` `(account_id, period_key)` returns zero rows and a
   claim for a `'failed'` row succeeds. `npm run type-check` covers the migration's shape via the
   regenerated Supabase types.

2. **Shared email shell + reflow the two existing transactional templates.**
   New `src/lib/email/shell.ts`: `renderEmailShell({ bodyHtml, footerHtml }): string`, the
   header/body-slot/footer-slot skeleton from `docs/designs/s15-agency-digest.md` section 1,
   every literal copied verbatim with its token-name comment (canvas `hsl(200 24% 98%)`, card
   `#ffffff`, text `hsl(200 22% 11%)`, muted `hsl(200 11% 38%)`, line `hsl(200 15% 87%)`, accent
   `hsl(176 54% 28%)` — no value outside `docs/design-system.md:182-205`/`:194-198`). Edit
   `src/lib/email/resend.ts`: both `sendStagingVerificationEmail` and `sendEditorAccessCode`
   render their body/footer slots per `docs/designs/s15-agency-digest.md` section 2 and call
   `renderEmailShell`, replacing the current hand-rolled `system-ui` + slate-hex `<div>` (`:101-107`,
   `:132-138`). `text` output is unchanged — the plain-text part was already correct, only `html`
   changes.
   **Test:** `src/__tests__/lib/email/shell.test.ts` — `renderEmailShell` output contains the
   accent literal `hsl(176 54% 28%)` and the `<>` brand glyph; contains none of the retired
   literals (`system-ui`, `#0f172a`, `#475569`, `#94a3b8`, `#f1f5f9`). A second test calls
   `sendStagingVerificationEmail` (mocking `resend.emails.send`) and asserts the same on its
   rendered `html`, and that its `text` value is byte-identical to what the pre-change function
   produced (copy the current three-line string as the fixture) — the reflow must not change the
   text part.

3. **Digest content builder — pure function, no upstream dependency.**
   New `src/lib/email/agency-digest-template.ts`. Exports:
   - `EditActivityRow = { siteDomain: string; timestamp: string }` — the two fields this story's
     aggregation actually consumes from `s14c`'s four-field row shape (`site, editor, element,
     changed value, timestamp`); editor and element identity are `s14c`'s screen's concern, not
     the digest's.
   - `buildAgencyDigestData(rows: EditActivityRow[], opts: { periodLabel: string; dashboardUrl:
     string; unsubscribeUrl: string; minutesPerEdit?: number }): AgencyDigestData | null` — groups
     by `siteDomain`, counts, computes `totalEdits` and `estimatedHoursSaved = totalEdits *
     minutesPerEdit / 60` (default `minutesPerEdit = 10`, the exact figure
     `docs/stories.md:865` and `docs/designs/s15-agency-digest.md:130` both name). Returns `null`
     when `rows.length === 0` — the caller's contract for "send nothing."
   **Test:** `src/__tests__/lib/email/agency-digest-template.test.ts` — empty input → `null`;
   three rows across two sites → correct per-site counts (sorted by count descending, matching the
   mockup), correct total, `estimatedHoursSaved` at the default rate, and a second case at a
   non-default `minutesPerEdit` to prove the assumption is a parameter, not a hardcoded literal
   buried in the arithmetic.

4. **Digest email template + `sendAgencyDigestEmail` — the plain-text criterion.**
   Same module, `buildAgencyDigestHtml(data: AgencyDigestData): string` and
   `buildAgencyDigestText(data: AgencyDigestData): string`, per
   `docs/designs/s15-agency-digest.md` section 3 exactly — including the disclosure sentence *"We
   estimate time saved by counting {minutesPerEdit} minutes per edit — an estimate, not a
   measurement"* rendered from `opts.minutesPerEdit`, never a second hardcoded "10". Add
   `sendAgencyDigestEmail(to: string, data: AgencyDigestData): Promise<SendResult>` to
   `src/lib/email/resend.ts` (the file's existing pattern: build `html`/`text`, call the private
   `send()`), passing `buildAgencyDigestHtml`'s output through `renderEmailShell`.
   **Test:** `src/__tests__/lib/email/agency-digest-template.test.ts` (extended) — this is the
   story's own criterion, asserted directly and mechanically:
   - `buildAgencyDigestText(data)` matches `/<[^>]+>/` zero times (no HTML tags in the text part).
   - Every `href="..."` value extracted from `buildAgencyDigestHtml(data)` (dashboard link,
     unsubscribe link) appears verbatim as a bare URL substring in `buildAgencyDigestText(data)`.
   - The disclosure sentence appears in both `html` and `text`, with the configured
     `minutesPerEdit` value interpolated, not the literal "10", when a non-default rate is used.

5. **Idempotency-safe send wrapper — the claim-then-update mechanism.**
   New `src/lib/email/digest-ledger.ts`. Exports `recordAndSendDigest(supabase, { accountId,
   periodKey, email, data }): Promise<{ sent: boolean; skipped: boolean; error?: string }>`
   implementing exactly the SQL in `docs/decisions/011-agency-digest-idempotent-send-ledger.md`:
   attempt the claim via `.upsert(..., { onConflict: "account_id,period_key",
   ignoreDuplicates: false })`-equivalent with the conditional `WHERE status != 'sent'`
   semantics (Supabase's JS client cannot express a conditional `WHERE` on upsert directly — use
   `.rpc()` calling a small `SECURITY DEFINER` SQL function `claim_agency_digest_send(account_id,
   period_key, edit_count)` created in task 1's migration, returning the claimed row or nothing;
   this follows the repo's existing rule that multi-step/conditional writes go through a Postgres
   function, not client-side branching —
   `docs/architecture.md:259-261` cites the same rule for publish/staging). On a claimed row: call
   `sendAgencyDigestEmail`, then `UPDATE agency_digest_sends SET status = ..., error = ...`. On no
   claim: return `{ sent: false, skipped: true }` without calling `sendAgencyDigestEmail`.
   **Test:** `src/__tests__/lib/email/digest-ledger.test.ts` (from task 1, now exercised) — fake
   Supabase client implementing the RPC's semantics in-memory (same style as
   `stripe-webhook-ordering.test.ts`'s fake client): (a) first call for a fresh `(accountId,
   periodKey)` sends and marks `'sent'`; (b) a second call for the same key is a no-op — `send()`
   is asserted not called; (c) a call where the stored row is `'failed'` retries — `send()` is
   called again and the row moves to `'sent'` on success; (d) a send that throws leaves the row
   `'failed'` with the error message stored, and a subsequent call reclaims and can succeed.

6. **Unsubscribe endpoint.**
   New `src/app/api/account/email-preferences/digest-unsubscribe/route.ts`: `POST` accepts
   `{ token }`, looks up `digest_email_preferences` by `unsubscribe_token` via
   `createServiceRoleClient()` (unauthenticated by design — the token is the credential, matching
   why the design's link carries `?token={{TOKEN}}` and not a session requirement), sets
   `digest_unsubscribed_at = now()` if not already set, returns a generic `{ success: true }` for
   both "found and unsubscribed" and "already unsubscribed" — never a distinct "token not found"
   in a way that lets a caller enumerate valid tokens by response shape, matching the enumeration
   discipline `docs/research/s14-agency-client-handoff.md` T8 documents for `request-code`/
   `submit-code`. A minimal confirmation is composed from existing primitives only (`Card`,
   `Alert`) at `src/app/account/email-preferences/digest-unsubscribe/page.tsx` — the design
   explicitly defers this page's visual design to a future `/ks-design` pass
   (`docs/designs/s15-agency-digest.md`, States → "unsubscribed"; Design system gaps #3), so this
   page is intentionally unstyled beyond that composition, not a finished screen.
   **Test:** `src/__tests__/api/account/email-preferences/digest-unsubscribe.test.ts` — valid
   token sets `digest_unsubscribed_at`; a second call with the same token is idempotent (still
   `{ success: true }`, no error, no double-write side effect); an unknown token returns the same
   `{ success: true }` shape, not a 404, and the response body/timing carries no distinguishing
   signal (assert the two response bodies are structurally identical); calling
   `sendStagingVerificationEmail` or `sendEditorAccessCode` for the now-unsubscribed account after
   this still returns `{ sent: true }` in a mocked-Resend test — the unsubscribe write touches only
   `digest_email_preferences`, nothing transactional reads it.

7. **Cron route — orchestration, and where the two unbuilt interfaces are named, not guessed.**
   New `src/app/api/cron/agency-digest/route.ts`, auth copied verbatim from
   `src/app/api/cron/ab-test-lifecycle/route.ts:11-16` (`Bearer ${process.env.CRON_SECRET}`,
   fail-closed on unset/mismatched). Computes `periodKey` server-side as the *previous* calendar
   month in UTC (`YYYY-MM`) — never client-supplied, same clock-source discipline
   `docs/stories.md:251-252` requires for trial expiry. Two adapter modules, each the single named
   seam onto an interface this story does not own:
   - `src/lib/billing/agency-accounts.ts` — `listAgencyAccounts(supabase): Promise<{ accountId:
     string; email: string }[]>`. Queries `plans` for `id = 'agency'` first; **if no such plan row
     exists, returns `[]` immediately** — a documented, deliberate no-op, not an error, with a
     comment naming why (mirrors this story's own "zero eligible accounts → send nothing"
     criterion, and is what keeps this route safe to register in `vercel.json` today even though
     `s13` hasn't shipped). Once `s13` lands the `agency` plan row, this function starts returning
     real accounts with zero further code change — confirmed against
     `docs/research/s13-agency-plan.md:100` ("the catalogue is database-driven... a new row flows
     through unchanged").
   - `src/lib/analytics/agency-edit-activity.ts` — `getEditActivityForAccount(supabase, accountId,
     periodStart, periodEnd): Promise<EditActivityRow[]>` (the type from task 3), documented as
     depending on `s14c`'s read model (`docs/designs/s14c-cross-site-edit-activity.md`). Its body
     is written against `s14c`'s *assumed* interface today and is expected to need a follow-up
     edit once `s14c`'s actual table/function ships — this is the one piece of this story genuinely
     blocked on another story's undelivered implementation; see **Run interdicts**.
   Per-account loop: skip accounts with zero rows (via `buildAgencyDigestData` returning `null`)
   *before* touching the ledger — a read failure or a zero-edit result never creates a
   `agency_digest_sends` row, so it costs nothing to retry next run. Wrap each account's
   `getEditActivityForAccount` + `recordAndSendDigest` in try/catch, matching
   `ab-test-lifecycle/route.ts:42-60`'s per-row isolation, so one account's failure doesn't abort
   the batch. Response shape mirrors `ab-test-lifecycle`: `{ checked, sent, skipped, errors }`.
   **Test:** `src/__tests__/api/cron/agency-digest.test.ts` — missing/wrong `CRON_SECRET` → 401,
   no query issued; `listAgencyAccounts` mocked to return `[]` → `{ checked: 0, sent: 0 }`, no
   send attempted; one account with zero activity rows → no ledger row created, no send; one
   account whose `getEditActivityForAccount` throws → logged in `errors`, loop continues to the
   next account; two accounts, one already `'sent'` for the period → only the other is sent.

8. **`vercel.json` — register the cron.**
   Add `{ "path": "/api/cron/agency-digest", "schedule": "0 9 1 * *" }` (09:00 UTC on the 1st —
   monthly, after the reported month has fully closed) alongside the existing
   `generate-blog-post` entry. This closes, rather than repeats, the "cron logic without cron
   scheduling" gap `docs/research/s15-agency-digest.md:162-165` names in `ab-test-lifecycle` —
   registering it is safe today because of task 7's graceful-empty-list behavior, not despite it.
   **Test:** a small config test (`src/__tests__/config/vercel-cron.test.ts`, new file — no
   existing test reads `vercel.json`) that reads and `JSON.parse`s `vercel.json` and asserts an
   entry exists with `path: "/api/cron/agency-digest"` and a valid five-field cron `schedule`
   string. Trivial, but real: it fails if a future edit removes or mistypes the entry, which
   `docs/research/s15-agency-digest.md`'s own finding shows has effectively already happened once
   (`ab-test-lifecycle` shipped and was never wired in).

## Run interdicts

Conditions under which a task in this plan must stop and report rather than proceed by guessing —
none of these are worked around by inventing schema:

- **`listAgencyAccounts` (task 7) returning `[]` because no `agency` plan row exists is not a bug
  to fix inside this story.** It is the correct, intended behavior until `s13-agency-plan` ships.
  Do not add a fallback that queries `site_permissions` counts or any other proxy for "is this an
  agency" — `docs/research/s15-agency-digest.md`'s open question 2 is explicit that "agency
  account" has no mechanical definition today outside `s13`'s eventual `plans.id = 'agency'` row,
  and a proxy definition invented here would need to be un-invented when `s13` lands.
- **`getEditActivityForAccount` (task 7) is written against `s14c`'s row shape as designed
  (`docs/designs/s14c-cross-site-edit-activity.md:13-19`), not against a real table, because none
  exists.** `docs/research/s14-agency-client-handoff.md`'s open question 3 records that `s14c`
  itself has not decided whether its read model is an extended `staging_history` or a new table.
  This task's implementation must call through a single function so that decision is a one-file
  change when `s14c` ships, and must **fail loudly, not silently**, if invoked before that function
  has a real backing query — i.e., its initial body is `throw new Error("s14c read model not yet
  available")`, caught by task 7's per-account try/catch and surfaced in the cron's `errors` array,
  never a swallowed empty result. An empty result here would be indistinguishable from a genuine
  zero-edit account and would silently violate this story's own "send failures are logged" — a
  read failure is not a zero-edit account and must not be reported as one.
- **If `s14c` ships before this story executes**, task 7's `getEditActivityForAccount` is a
  one-function rewrite against `s14c`'s real interface, confirmed against whatever
  `docs/plans/s14c-cross-site-edit-activity.md` and its implementation actually settled on — the
  design document's row shape is the contract this plan holds `s14c` to, not the other way round.
- **Do not build a dashboard-visible "digest history" or "agency" account concept anywhere outside
  the two adapter modules above.** Both are out of this story's acceptance criteria; the ADR
  records they are plausible future reuse, not present scope.

## The point everything turns on

**The ordering in task 7's per-account loop — read, then build, then claim, then send — is what
makes this story's own code correct today despite depending on two stories that don't exist yet.**
Reading activity happens before anything touches `agency_digest_sends`, so a read failure (today:
always, since `s14c` isn't built; later: occasionally, on a real outage) costs nothing to retry —
no ledger row exists to reclaim wrongly or to leave stuck. Building the digest data is pure and
side-effect-free, so "zero edits" is decided before any write. Only once there is content to send
does the claim (task 5's `claim_agency_digest_send`) happen, immediately before `sendAgencyDigestEmail`
— satisfying the research's "record before sending" rule exactly, and, because the claim is
conditional on `status != 'sent'` rather than a bare unique-insert, a failure after the claim is
retried on the next cron invocation without risking a duplicate send to an account the previous run
already reached. Every other task in this plan (the shell, the template, the plain-text assertion,
the unsubscribe endpoint) is independently correct and testable without either unbuilt dependency;
this ordering is the one place where "blocked on `s13`/`s14c`" and "safe to ship today" have to be
simultaneously true, and it is what makes them so.

## Files touched

**New**
- `supabase/migrations/20260814000000_agency_digest_schema.sql`
- `src/lib/email/shell.ts`
- `src/lib/email/agency-digest-template.ts`
- `src/lib/email/digest-ledger.ts`
- `src/lib/billing/agency-accounts.ts`
- `src/lib/analytics/agency-edit-activity.ts`
- `src/app/api/cron/agency-digest/route.ts`
- `src/app/api/account/email-preferences/digest-unsubscribe/route.ts`
- `src/app/account/email-preferences/digest-unsubscribe/page.tsx`
- `docs/decisions/011-agency-digest-idempotent-send-ledger.md` (already written, travels with this
  plan)
- Tests: `src/__tests__/lib/email/shell.test.ts`,
  `src/__tests__/lib/email/agency-digest-template.test.ts`,
  `src/__tests__/lib/email/digest-ledger.test.ts`,
  `src/__tests__/api/cron/agency-digest.test.ts`,
  `src/__tests__/api/account/email-preferences/digest-unsubscribe.test.ts`,
  `src/__tests__/config/vercel-cron.test.ts`

**Modified**
- `src/lib/email/resend.ts` (shell reflow of both existing senders + new `sendAgencyDigestEmail`)
- `vercel.json`

## Test strategy

All Jest, colocated in `src/__tests__/`, following existing conventions — no live database in this
repo's test setup (`jest.config.js`: `testEnvironment: "jsdom"`), so every Supabase interaction is
tested against a fake client shaped like `stripe-webhook-ordering.test.ts`'s and
`concurrency.test.ts`'s, not against a real Postgres instance. `Resend` is mocked at the module
boundary, matching `resend.ts`'s existing lazy-client pattern.

- **Pure logic (tasks 3, 4):** direct unit tests, no mocking beyond input fixtures. This is where
  the acceptance criteria for time-saved disclosure and the plain-text/link-parity requirement are
  actually proven.
- **Idempotency (tasks 1, 5):** fake Supabase client reproducing the claim SQL's `WHERE status !=
  'sent'` semantics in-memory; four scenarios (fresh, already-sent, previously-failed, concurrent
  double-claim).
- **Route-level (tasks 6, 7):** `NextRequest`/`NextResponse` tested the way every other route test
  in `src/__tests__/api/` is — auth rejection first, then behavior, with `listAgencyAccounts` and
  `getEditActivityForAccount` mocked at the module boundary so these tests do not depend on `s13`
  or `s14c` existing.
- **Config (task 8):** a direct JSON assertion against `vercel.json`.
- No Playwright/e2e coverage — this story has no UI surface beyond the unstyled unsubscribe
  confirmation page, which is explicitly deferred design, not a flow to smoke-test yet.

## Definition of Done

- All eight tasks' tests pass; `npm run lint`, `npm run type-check`, `npm run build`, `npm test`
  green (per `AGENTS.md`'s standard Definition of Done).
- Every acceptance criterion in `docs/stories.md:864-870` is covered by a named test above:
  per-client-site report (task 3/7), disclosed time-saved assumption (task 3/4), zero-edit → no
  email (task 3/7), idempotent send (tasks 1/5), plain-text with no tags and every link as a bare
  URL (task 4), digest-only unsubscribe (task 6), send failures logged and retryable without
  duplication (task 5/7).
- `npm run build:embed` unaffected — this story touches no embed code, verified by the diff
  containing nothing under `public/embed/`.
- The two existing transactional email tests (staging code, editor code) still pass with unchanged
  `text` output after the shell reflow (task 2).
- `docs/decisions/011-agency-digest-idempotent-send-ledger.md` merges with the story's single
  commit, per `AGENTS.md`'s data-lifecycle rule for story decisions.
- Both **Run interdicts** conditions are visible in the shipped code as explicit, commented
  fail-loud/graceful-empty behavior — not silently absent, not silently guessed.
