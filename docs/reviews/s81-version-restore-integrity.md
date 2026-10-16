# Review — s81-version-restore-integrity

Independent review of `origin/main` `bc6e503` through `db255d5`. The review compared the story
diff with the human-validated plan, research, design record, ADR 067, related accepted ADRs and
the repository rules. The reviewer wrote none of the implementation code and changed no product
source; the only retained write is this report.

## Findings

No open findings.

## Plan, security and behavior conformance

- `content_changes.updated_at` is appended to the fixed security-invoker view projection and the
  Changes route takes the version from that view row, alongside its text. The later metadata read
  does not supply or replace the token. The client preserves a valid PostgreSQL timestamp string
  byte for byte instead of rebuilding it through `Date`.
- Omission alone selects the legacy unconditional path. Explicit null, malformed calendar/time
  values, excess precision, wrong types and overlong values are refused with 400. A missing or
  malformed version in the final Changes read stops Discard before any PUT.
- Conditional saves call the separately named service-only RPC. Its materialized locked row is
  compared under `FOR UPDATE`; saved, conflict and missing are distinct outcomes. A conflict
  changes neither the content row nor `staging_history`.
- HTTP 409 becomes the existing stale outcome. The element is refreshed, the confirmation closes
  onto the refreshed row, and no automatic retry or force path exists. Ordinary 402/403/429/500
  refusals retain their prior behavior.
- Callers that omit `expectedUpdatedAt` retain the original
  `save_staging_content_atomic(uuid,text,text,text,text,jsonb,uuid,text)` signature and
  last-write-wins semantics. Its redefined body returns the UPDATE's actual post-trigger token,
  rather than the now-stale transaction-local candidate.
- The new monotonic timestamp trigger replaces only `content_elements`' old shared trigger. It
  advances the row token across repeated writes in one transaction; unrelated tables keep the
  shared timestamp function. The accepted s65b retirement remains ordered before s81, so its
  parent-row revision triggers are absent when the CAS path runs.
- The CAS function is `SECURITY DEFINER`, has the pinned `public, pg_temp` search path and is
  executable only by `service_role`. The view remains `security_invoker`, readable by
  `authenticated` and `service_role`, and unreadable by `anon` and PUBLIC. Existing authorization,
  rate-limit, owner-plan and service-role boundaries are unchanged.
- The migration is new, timestamped and forward-only. No applied migration, dependency or embed
  artifact changed. The UI adds no component, token, layout or control, matching the design record.

## Verification

- Through the required Node 24.14.0 wrapper, five focused route, validator, hook and Changes-view
  suites passed: 183 tests. They cover exact microsecond forwarding, null/malformed refusal,
  legacy omission, 409 refresh and no retry.
- A fresh owned PostgreSQL 17 replay applied s65b then s81. The server reported version `170011`,
  zero revision-rotation triggers and `set_content_element_updated_at_monotonic` as the
  `content_elements` update trigger. All nine real CAS tests passed, including two-client row-lock
  serialization, one winner/one conflict, no losing history row, ACLs, publish/metadata
  invalidation, same-transaction monotonicity, null conflict, missing outcome and legacy-token
  handoff.
- The replay-runner convergence edge was reproduced separately: reapplying s62 restored four
  revision triggers; applying s65b's retirement twice reduced that count to zero. The revised s65b
  revision suite then passed 4/4 before the s81 CAS suite passed 9/9 on the same database.
- A real PostgreSQL view probe returned
  `2026-10-08T10:00:00.654321+00:00|Draft` from one view row. Catalogue checks returned
  `{security_invoker=true}`, authenticated SELECT true and anon SELECT false.
- Anti-hallucination mutation 1 forced every staging save onto the legacy RPC: the stale-write
  regression went red (1 failed, 9 passed; expected 409, received 200). Mutation 2 disabled the
  409-to-stale mapping: the hook regression went red (1 failed, 47 passed). Both mutations were
  restored, `git diff --exit-code` proved the source clean, and the two suites passed 58/58.
- `git diff --check origin/main...HEAD` passed. The branch contains one story commit.

## Not verified in this review

- The reported 6,968-test broad run, build, both type checks, lint and format gates were not
  repeated; this review ran the bounded story tests and database proofs that exercise the changed
  contracts. Current-head CI remains the broad-gate authority.
- No production/provider database was touched, no migration was applied outside disposable
  PostgreSQL 17, and no merge or deployment occurred.
- No real PostgREST/GoTrue stack or browser was operated. The direct PostgreSQL JSON/view probe and
  route tests prove precision and projection mechanics, while a human smoke test should open the
  same pending row in two Changes tabs, change it in one, then confirm Discard in the other shows
  the refreshed conflict state and sends no second PUT.

Max severity: none
Ship allowed: yes

## PR #98 follow-up re-review — nullable row versions

Fresh independent review of follow-up `38c6d61` against the reviewed report commit `9ae09ba`,
including the original s81 CAS contract. Devin thread `PRRT_kwDOPc_I2s6reyUs` identified a valid
direct-RPC bypass: PostgreSQL considers `NULL IS NOT DISTINCT FROM NULL` true, so a legacy row with
`content_elements.updated_at = NULL` and a service-role caller supplying a NULL expectation entered
the update path even though neither value represented a version.

### Follow-up findings

No open findings. The reported nullable-version defect is resolved.

- The save branch now requires both the stored token and expected token to be non-null before
  ordinary timestamp equality can succeed.
- The conflict branch is the exact three-valued-logic complement: either token is null, or two
  non-null tokens differ. Every existing locked row therefore still returns one typed outcome;
  NULL/NULL cannot save and cannot fall through to a zero-row response.
- The new PostgreSQL matrix covers NULL/NULL, NULL/value and value/NULL. Each case compares the
  complete stored draft, metadata, version and history count before and after the call, so a
  nominal `conflict` without state preservation would fail.
- The HTTP boundary remains stricter: explicit null is still a 400, while omission alone retains
  the legacy last-write-wins path. No route, hook, authorization, grant, view or UI behavior changed
  in this follow-up.

### Follow-up verification

- Required Node 24.14.0 wrapper: the staging HTTP concurrency and ISO timestamp suites passed
  18/18.
- Fresh owned PostgreSQL 17 replay, ordered s65b then s81: server `170011`, zero retired revision
  triggers, and the complete s81 CAS suite passed 11/11. This includes row locking, ACLs,
  monotonic/legacy token behavior and all three nullable combinations.
- Negative database mutation, without touching source: the reviewed pre-fix `9ae09ba` migration
  was reapplied over a disposable current schema. The CAS suite went red exactly where expected:
  NULL/NULL returned `saved` instead of `conflict` (1 failed, 10 passed). Destroying that database
  removed the mutation; the current migration's preceding 11/11 run is the final behavior.
- `git diff --check 9ae09ba..38c6d61` passed. The follow-up changes only the CAS predicate,
  its real-PostgreSQL regressions and the research/plan evidence. No source was edited during this
  re-review.

### Follow-up evidence boundary

- The author's broader PostgreSQL replay result (133 passed, one unrelated skip) was not repeated;
  this re-review ran the bounded real-database suite that directly proves the nullable repair.
- No production/provider database, merge, push or deployment was performed. No browser or
  PostgREST/GoTrue stack is needed to distinguish these direct SQL outcomes.

Max severity: none
Ship allowed: yes

## Current-main integration review — 2026-10-16 (`a58b6fc`)

The in-progress merge of current `main`
`a58b6fc2e63975bef1c0bbe7506360828c49c2b9` into story head
`e848654dc100dd2f7cc8e8b9598ce2e8cc897dff` has no unmerged index entries and passes both
`git diff --check` and `git diff --cached --check`. Compared with `MERGE_HEAD`, the resulting tree
retains the complete 22-file s81 delta. Compared with the reviewed story head, every s81 route,
hook, validation helper, test, ADR and migration file is unchanged. The shared database runner
adds the current-main replay suites while retaining `staging-content-cas`; the additive
`docs/stories.md` resolution preserves s81 and the subsequently merged stories.

The CAS migration SHA-256 remains
`157808f46b033234fd02d30c8aa7d3b23029a549d734ec70685ee5672ca515cf`, exactly matching the
reviewed head. The authoritative row-version projection, same-statement row lock and comparison,
typed saved/missing/conflict outcomes, nullable-version refusal, no-write conflict path,
service-role boundary and monotonic token behavior are therefore unchanged. The client still maps
409 to the existing stale outcome, refreshes the row, and performs no automatic retry or force
discard. The omitted-version path remains the deliberate legacy last-write-wins contract; no
fallback was added around the conditional path.

Fresh Node 24.14.0 verification passed the five focused route, validator, hook and Changes-view
suites: **5 suites / 183 tests**. The prior route, hook and database neutralizations remain bound
to unchanged source hashes and were not repeated during this no-source-mutation integration pass.
No LSP diagnostic was required for the merge delta because it changes no s81 TypeScript source;
the only shared JavaScript change is additive database-suite registration already exercised by the
release lane.

No new finding was introduced by integrating current main. This is a passing technical source
review, not proof of the remaining release lanes. The merge commit and normal hooks, current-head
hosted checks, the production migration preflight/application, deployment and live two-tab Discard
gesture remain separate evidence. The prior Devin nullable-version finding is fixed in the exact
migration reviewed here; absence of a fresh private Devin run is not treated as approval.

Max severity: none
Ship allowed: yes

## Current-main integration review — 2026-10-16 (`8733f9d`)

Current main advanced through s108 to `8733f9d859284fe500fc5e02c5442c2674d0614f`. Its clean,
no-commit merge into s81 head `dcbf38bf6340dc7f53a4080332cc7a7ee775533e` has no unmerged
entries and passes both diff checks. The resulting delta against `MERGE_HEAD` remains exactly the
reviewed 22-file s81 story. Every conditional-save route, hook, validator, Changes projection,
real-database test, replay registration and CAS migration file is unchanged.

The CAS migration SHA-256 remains
`157808f46b033234fd02d30c8aa7d3b23029a549d734ec70685ee5672ca515cf`. Omission alone still selects
the legacy unconditional `save_staging_content_atomic` path. A valid expected version selects the
separate compare-and-set RPC; its same-statement lock/update returns saved, missing or conflict,
and 409 refreshes without retry. The prior Devin repair is intact: either nullable token conflicts,
while only two non-null equal timestamps may save. No losing write or history row is introduced.

The incoming s108 release is also preserved: both bulk routes use native `randomUUID()`, direct
`uuid` and `@types/uuid` roots remain removed, only LHCI's nested UUID node remains, and no UUID
migration exists. The story ledger retains s81, s108 and s113, and the shared database runner keeps
both the analytics suites and `staging-content-cas`.

Fresh independent Node 24.14.0 verification passed the five s81 route/validator/hook/Changes suites
and both s108 route suites: **7 suites / 203 tests**. Prior route, hook and PostgreSQL
neutralizations remain bound to unchanged source/migration hashes. No LSP diagnostic was required
because this integration delta changes neither s81 nor s108 source.

No new finding was introduced. The ordinary merge commit and normal current-head hooks may
proceed. Hosted checks, migration application, deployment, the live two-tab Discard gesture and
fresh private Devin availability remain separate evidence.

Max severity: none
Ship allowed: yes

## Dependency-order integration review — 2026-10-16 (`cc6ac07`)

Current main now includes the released s69a dependency at
`cc6ac07e05af0380c8aea202b768643ec0f424b6`. Its no-commit merge into s81 head
`0d0762fee0631a9851af76893668b72ebb2553bf` has no unmerged entries and passes both diff checks.
The sole manual resolution is additive `docs/stories.md`, with s69a preceding s81. The resulting
delta against `MERGE_HEAD` remains exactly the reviewed 22-file s81 story; every s81 source, test,
ADR and migration file is byte-identical to `0d0762f`.

The CAS migration SHA-256 remains
`157808f46b033234fd02d30c8aa7d3b23029a549d734ec70685ee5672ca515cf`. Its conditional and
unconditional save contracts, same-statement locking, typed outcomes, 409 refresh/no-retry behavior
and prior Devin nullable-token repair are unchanged. The released s69a route/tests/migration are
also preserved from main, including migration SHA-256
`ec048ba9faa41f5aa4e54e61a0d7cbaa56bb06446fe508b32d71ed30a3695812`. The shared replay runner
retains all analytics, `ab-conversion-dedupe` and `staging-content-cas` suites.

The native UUID cleanup remains intact: both bulk routes use `randomUUID()`, direct `uuid` and
`@types/uuid` roots are absent, only LHCI's nested UUID node remains, and no UUID migration exists.
The story ledger retains s69a, s81, s108 and s113 in dependency order.

Fresh independent Node 24.14.0 verification passed the focused s81, s69a and s108 route/hook/
validation suites: **9 suites / 259 tests**. Prior PostgreSQL and behavior neutralizations remain
bound to unchanged hashes. No LSP diagnostic was required because this dependency refresh changes
none of those TypeScript sources.

No new finding was introduced. The ordinary merge commit and normal hooks may proceed. The s81
production migration remains unapplied; its preflight, application, deployment, live two-tab
Discard gesture, hosted checks and private Devin availability remain separate release evidence.

Max severity: none
Ship allowed: yes
