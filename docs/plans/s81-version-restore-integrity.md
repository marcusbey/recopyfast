---
validated: yes
---

# Plan — s81-version-restore-integrity

Human approval 2026-10-12: **"Validate all four recommended plans"**.
Mechanically materialized from that explicit approval. No production migrations or merges.
Fresh research confirms premises before code; only a material semantic change needs a new checkpoint.

Branch: `feature/s81-version-restore-integrity` from `origin/main` `bc6e503`.
Dependency: verify s65b's final migration shape first, then prove the combined migrations in a
disposable integration database. Keep s65b out of this story's commit/diff; merge order is s65b first.

## Shared constraints

- One story, branch and PR per scope. None of the four fixes is bundled with another.
- Every story starts with fresh `/ks-research`; the paths below are the current surface, not a
  substitute for re-verifying it when the story begins.
- New migrations are forward-only and timestamp-prefixed. Applied migrations are never edited.
- No new dependency.
- The embed ceilings only go down. `s67b` may not raise a ceiling, remove discovery coalescing,
  remove the per-page discovery cap, or stop observing shadow roots to buy bytes.
- Existing authorization, rate limits, RLS and service-role boundaries remain unchanged unless the
  story explicitly tests an equivalent or stricter boundary.
- Each implementation is test-first, passes the repository Definition of Done, receives an
  independent review, and ends with the exact review footer required by `AGENTS.md`.

### User-visible outcome

Discard applies only to the exact content version the owner just reviewed. If another tab, the
live-page editor or a returned Changes page wrote the row after that read, Discard refuses with a
conflict, refreshes the row and explains that it changed elsewhere.

### Current premise

The Changes page re-reads immediately before Discard, but the PUT and
`save_staging_content_atomic` do not carry or enforce that read's `updated_at`. A write can land in
the read-to-PUT window. The existing atomic RPC serializes history correctly but intentionally
remains last-write-wins.

### Recommended safe approach

Add an optional `expectedUpdatedAt` request field used by Discard. Enforce it **inside the same
database statement that locks and updates the row**, against `content_elements.updated_at`.
Return a typed conflict result and translate it to HTTP 409. Existing live-editor saves that omit
the field keep their last-write-wins contract; no permanent snippet or external caller breaks.

Use a new explicitly named CAS RPC, or a new unambiguous signature after research proves PostgREST
resolution. Do not add a route preflight query and call it fixed.

### Tasks

1. **Research the version source and RPC shape.** ✅
   - Verify the Changes response already exposes the row's authoritative `updated_at`; add it to
     the fixed projection if absent.
   - Choose a function name/signature that cannot make PostgREST select between ambiguous
     overloads. Record why `staging_updated_at` alone is insufficient if publish/attribute writes
     can change the row without moving it.
2. **Make the lost-update test a normal failing test.** ✅
   - Convert the current `test.failing` contract in
     `src/__tests__/api/staging/content-concurrent-write.test.ts` into a red assertion for 409 and
     no overwritten draft/history row.
   - Add a Changes-hook test where a second writer lands after the final read and before the PUT.
3. **Add the forward migration.** ✅
   - Introduce the CAS write function with the same site/element/language/variant filters,
     `FOR UPDATE`, content sanitization boundary, attribute merge and history transaction as the
     existing atomic save.
   - Its update predicate includes the expected timestamp. It returns one of: saved, missing, or
     version conflict; no zero-row ambiguity.
   - Pin privileges and `search_path`; service role only.
4. **Wire only the conditional path.** ✅
   - Validate `expectedUpdatedAt` as a bounded ISO timestamp in the staging PUT.
   - When present, call the CAS function; when absent, retain the existing RPC and behavior.
   - On conflict return a fixed 409 message without echoing content or identifiers.
5. **Carry the version from the final read.** ✅
   - `useChangeActions.ts` sends the exact `updatedAt` from `readElementChanges` for Discard.
   - A 409 triggers the existing row/count refresh and shows “updated elsewhere”; it never retries
     the destructive write automatically.
6. **Verify.** ✅
   - Run staging PUT, concurrent write, Changes hook/page, attributes, history, permissions,
     PostgreSQL replay and normal gates. Add a two-client real-Postgres CAS test.

### Post-review fix — nullable direct-RPC versions ✅

Devin PR #98 thread `PRRT_kwDOPc_I2s6reyUs` (discussion `4248623371`) found that the RPC's
`IS NOT DISTINCT FROM` comparison treated a legacy row with `updated_at = NULL` and a direct
service caller's `p_expected_updated_at = NULL` as a matching version. The HTTP route's explicit
null refusal did not protect that separate service-role contract.

- Red first on Node 24 / PostgreSQL 17: the real-DB nullable-version matrix failed only NULL/NULL
  (1 failed, 132 passed, 1 unrelated skip); the RPC returned `saved` and mutated draft/history.
- The save predicate now requires both timestamps non-null and equal. The conflict predicate is
  its explicit complement (either null or unequal), so every locked row still returns exactly one
  of saved/conflict rather than falling into a zero-row result.
- Green: NULL/NULL, NULL/value and value/NULL all return conflict with the complete row snapshot
  unchanged and zero `staging_history` rows. The replay passed 17 suites / 133 tests, with one
  unrelated skip. The route's explicit-null 400 regression remains unchanged.

### Expected files

- New `supabase/migrations/<timestamp>_staging_content_compare_and_set.sql`
- `src/app/api/staging/content/[siteId]/route.ts`
- `src/app/api/content/changes/route.ts` or its fixed projection, if `updated_at` is absent
- `src/hooks/useChangeActions.ts`
- `src/__tests__/api/staging/content-concurrent-write.test.ts`
- `src/hooks/__tests__/useChangeActions.test.ts`
- Relevant content-changes route and DB privilege tests
- Canonical s81 story/research/plan/review docs after the checkpoint

### Human checkpoint

Approve the conflict behavior: **refresh and require the owner to press Discard again**. The
client must not retry automatically and must not offer “force discard” in this story.
