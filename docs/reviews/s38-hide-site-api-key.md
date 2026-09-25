# Review — s38-hide-site-api-key

- Reviewer: fresh-context `/ks-review` (reviewer subagent), 2026-09-25.
- Head reviewed: `2dd304f`, then re-checked at `8c50add`, which another session committed during this review. That commit touches test infrastructure only: `db-harness.ts`, `column-privileges.test.ts`, `jest.config.js` and the plan. At `8c50add`: `tsc` exit 0, eslint exit 0 on the two changed files, and `column-privileges` plus `security/*` pass 263/264 (1 skip). PR #35's pushed head is still `aa9e8d4`. Diff: `git diff main...feature/s38-hide-site-api-key`. `main` (`0b8014f`) is an ancestor of HEAD.
- Index state: the other session staged the *previous* review text of this file (`git diff --cached`). This review is an unstaged working-tree change. Nothing was committed by this reviewer.
- This file replaces the earlier uncommitted operator review (Max severity: major / Ship allowed: yes, reviewing `aa9e8d4`). The reviewer saved a byte-identical copy outside the repo before overwriting (sha1 `b5134832…`).
- No tracked file was modified. All neutralizations ran in an isolated `git archive` export of `2dd304f`, because another session was actively running gates and editing `jest.config.js` (uncommitted, not by this reviewer) in this worktree.

## Verdict

The fix is correct. On a disposable PostgreSQL 14 replay of every migration, the table-level `REVOKE ALL` plus the explicit column allowlists remove effective `SELECT sites.api_key` (and `webhooks.secret`, `api_keys.key_hash`, the device and staging fingerprints) from PUBLIC, anon and authenticated. service_role keeps full access. On the local Supabase stack, a view collaborator reads the 10 metadata columns of its own site and no other site. `api_key`, `*` and `UPDATE` are rejected with 42501. A real PostgREST embed `site_permissions?select=permission,sites(...)` works, and `sites(id,api_key)` returns 403.

Every reference the diff relies on exists: `Webhook.secret?` is optional (`src/types/index.ts:524`), `plans` has an anon grant and an active-rows RLS policy (`20260802000000_plans_catalog.sql:193,207`), and the column lists match the live schema. No legitimate read path loses access:

- Every `api_key` reader is service-role: `site-auth.ts:175,303`, `sites/route.ts:46`, `register`, `regenerate-snippet`, `server/index.js:245`. The sites list only mints tokens for admins (`sites/route.ts:170-178`).
- User-client reads name safe columns only: activation, edit-sessions, translate, security events `sites(id, domain)`, and `staging-access.ts:149,568`.
- No SECURITY INVOKER function, view, realtime publication or foreign policy reads a hidden column. The `api_usage` and `webhook_deliveries` policies reference only granted `id`, `user_id` and `site_id`.

There are no critical or major findings.

## Commands run by the reviewer

| Command | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 — 0 errors, 38 inherited warnings |
| `prettier --check` on the changed `src/**/*.ts` files | clean |
| Targeted Jest: 7 source suites | 110/110 pass |
| `column-privileges.test.ts` against local Supabase, run alone | 13 pass / 1 skip. The PostgREST embed test was run separately with a real anon key and passed (4/4 selected) |
| `node scripts/run-db-invariants.mjs` (owned PG14 cluster, removed afterwards) | 13 pass / 1 skip (HTTP) |
| Full Jest on `2dd304f`, CI placeholders, `--maxWorkers=2` | 247 suites / 3,300 tests pass. 7 founding tests fail with `capacity_busy`; see below |

The 7 founding failures are environmental. The shared local stack holds an orphan `founding_agency_reservations` row (`ca3bdac5…`, `status=reserved`, `user_id NULL`, created 16:46:55Z). It was left by overlapping DB runs from two sessions, which this review's runs may have contributed to. The cleanup (`founding-agency-cap.test.ts:90`) cannot match a row whose user is NULL. The same suite passed 23/23 earlier on a clean stack. s38 does not touch founding code. Clean the stack before the next gate.

## Neutralizations (each restored; `git diff --exit-code` clean)

| # | Neutralized | Red |
|---|---|---|
| 1 | Add `key_hash` to `API_KEY_LIST_COLUMNS` | 1 |
| 2 | api-keys POST/PUT `.select(API_KEY_RESPONSE_COLUMNS)` → `.select()` | 2 |
| 3 | Drop `delete publicValue.key_hash` | 3 |
| 4 | Webhook PUT: drop `delete publicWebhook.secret` | 1 |
| 5 | `updateWebhook` → `.select()` | 1 |
| 6 | `withoutWebhookSecret` no longer deletes | 2 |
| 7 | `createWebhook` → `.select()` | 1 |
| 8 / 9 | Health / readiness probe back to `sites` | 2 / 1 |
| 10 | Health swallows DB errors | 1 |
| 11 | Staging list → `select("*")` | 1 |
| 12 | Activation selects `api_key` | 1 |
| 13 | Security-events embed `sites(id, domain, api_key)` | 1 |
| 14 | **Migration: drop `REVOKE ALL … public.sites`** (the incident shape) | **4** (PG14 runner) |
| 15 | Migration: drop `REVOKE ALL … public.webhooks` | 3 |
| 16 | Migration: drop `REVOKE SELECT … public.staging_access` | 2 |

## Findings

**m1 (minor) — one anon assertion is vacuous.** `src/__tests__/db/column-privileges.test.ts:559-568`. The assertion `SELECT id FROM public.sites` → 42501 stayed green under neutralization 14. anon hits `permission denied for function user_is_team_member` through the `site_permissions` policy before the `sites` grant is ever consulted (confirmed on the local stack). The anon regression is still caught by the allowlist test at `:283`. Assert the privilege instead: `has_table_privilege` or the error message.

**m2 (minor) — negative controls mutate the shared catalogue outside a transaction.** `column-privileges.test.ts:599-666, 737-746`. They `GRANT SELECT ON sites TO authenticated`, `GRANT TRUNCATE`, and `ADD COLUMN` on the live DB, then clean up in a later statement. When two runs overlapped, the reviewer saw a spurious red on "web principals retain only the reviewed mutation columns". An interrupted run leaves the hole re-opened on that DB. Wrap each probe in `withClient` with `BEGIN`/`ROLLBACK`.

**m3 (minor) — the migration comment misstates DELETE, and the change is untested.** `20260925120000_sites_api_key_column_grants.sql:83-86` says the user-client mutation routes "were already rejected by RLS". Under RLS without a DELETE policy, DELETE silently matches 0 rows. So `DELETE /api/api-keys` (`src/app/api/api-keys/route.ts:384-400`) used to answer 200 "deleted" having deleted nothing, and now answers 500. The new answer is more truthful, but it should be stated and tested.

**m4 (minor) — scope drift, documented in the plan but outside the story acceptance criteria.** The branch carries three changes that belong elsewhere:
- the `update_translation_coverage` ACL repair inside the sites-named migration (`:160-169`);
- the unrelated founding clock-oracle test (`founding-agency-cap.test.ts:460-493`);
- the `test.failing` → `test` flip (`share-owner-lockout.test.ts:565`).

AGENTS.md requires test changes to be declared in the PR. The PR #35 body predates all three.

**m5 (minor) — staging fingerprints stay writable.** `staging_access` keeps table UPDATE for authenticated (`:145-158`), so a site admin can overwrite `verified_*_hash`. ADR 034 scopes staging to read-only, so this is not a contradiction. It is the same weakness ADR 034 fixed for device grants. Follow-up.

## Could not verify

- **GitHub CI never ran the new workflow steps.** PR #35 is still at `aa9e8d4`, `CONFLICTING`; only CodeRabbit and Vercel ran. Push, and require both new DB steps green.
- **Production.** Its catalogue and ACLs, the deploy order (code first, then SQL), and the absence of production-only invoker functions or views. Run the operator preflight from the research's rollout step 2.
- **The dashboard and ApiKeysPanel UI were never rendered** against the migrated DB. Manually smoke-test the sites list, activation, webhooks create/edit, staging invites and anonymous `/api/health` HEAD after the migration.
- **Hosted Supabase roles.** Only local `supabase start` and plain PG14 were exercised.
- **Key and webhook-secret rotation** is operator-only and was not performed.

Max severity: minor
Ship allowed: yes
