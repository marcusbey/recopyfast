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
