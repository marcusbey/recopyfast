# s81 research handoff — current source bc6e503

Verified 2026-10-12 while s65b is implementing. This supplements the approved plan; recheck after
stacking on s65b. No product source edits made by leader.

- `src/hooks/useChangeActions.ts` `discardDraft` (around435–488): re-reads with `readElementChanges`,
  compares draft text/staged key names, builds live text/attributes from the fresh row, then calls
  `saveDraft` without any row version. Its header explicitly defers the read→PUT race to s81.
- `saveDraft` (around260) is shared with other actions; only the Discard call should supply the new
  optional expected version. Omitting it elsewhere must preserve legacy unconditional saves.
- `send` (around235) returns error/isUncertain but no stale bit for409. `track` refreshes only when
  applied, isStale or isUncertain. Ensure CAS409 maps to isStale so the existing refresh runs.
- `src/hooks/useContentChanges.ts` ContentChange has changedAt but NO updatedAt. changedAt is a
  display timestamp derived from draft/publish, not the authoritative row version.
- `src/app/api/content/changes/route.ts` ROW_COLUMNS and ViewRow lack updated_at. The security
  invoker view also lacks it (migration20261009120000_content_changes_view.sql). Add the safe
  updated_at projection through a NEW migration and pin columns/grants in real DB tests.
- CRITICAL snapshot trap: Changes reads view rows, THEN separate `content_elements(id,metadata)`
  for draft attributes. Never take expectedUpdatedAt only from that later metadata read and pair
  it with the earlier view payload: an intervening edit can pair a new version with stale copy and
  evade CAS. Version must describe the same snapshot as live/draft content. Either project it in
  the view query, or reject inconsistent paired snapshots; approved plan allows view projection.
- Keep the exact PostgREST timestamp string, including microseconds/timezone, through JSON. Do not
  round-trip expectedUpdatedAt through JS Date.toISOString (truncates submillisecond precision).
- `src/app/api/staging/content/[siteId]/route.ts` after unchanged auth/rate/plan checks calls
  `save_staging_content_atomic` around380. Conditional path should be explicit new RPC to avoid
  PostgREST overload ambiguity; fixed typed saved/missing/conflict result maps200/404/409.
- `20260924030000_content_page_path.sql` defines old RPC: exact site/element/language/variant,
  locked CTE FOR UPDATE, attribute patch merge/removal, one update+history transaction. Preserve
  its semantics/privileges, never edit applied SQL. Conditional path must not write history on409.
- `src/__tests__/api/staging/content-concurrent-write.test.ts` has test.failing for stale
  expectedUpdatedAt and old last-write-wins guard/audit tests. Change deliberate expectations
  explicitly: conditional stale request409; OMIT expected field for unconditional legacy cases.
- Existing helper `timeoutSignal` and track locks stay. No auto retry/force Discard. UI uses current
  refusal/error and row-refresh pattern, so design record can document states without new layout.

Reserved migration for s81:20261012122000_staging_content_compare_and_set.sql; reserve ADR067.
Approved dependency: s65b revision-trigger retirement first. Keep the story branch based on main
so its PR contains only s81. Verify combined migrations in a disposable integration schema using
s65b's reviewed forward migration; do not duplicate that migration in the s81 commit.
