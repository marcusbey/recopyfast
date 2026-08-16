# Database invariant tests

These suites assert properties of the **database** — function ACLs, RLS
policies, and what the version/restore RPCs actually write. None of them can be
answered by a mock, so they need a real Postgres.

## Running them

```bash
npx supabase start          # brings up the local stack on the port in supabase/config.toml
npx jest src/__tests__/db
```

Against any other database (a CI service container, a scratch Postgres, a
branch database):

```bash
RCF_TEST_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres' npx jest src/__tests__/db
```

The connection must be able to read `pg_proc` / `pg_policy` and to insert into
`sites` and `content_elements` — i.e. the `postgres` role, not `anon`.

## When there is no database

The suites gate themselves. Before registering any test, `db-harness.ts` spawns
a short-lived child process that connects and checks for ReCopyFast's own
tables. If that fails, the suite registers a single passing test named
`[gated] no ReCopyFast database reachable` and prints how to bring one up.

So `npm test` passes unchanged on a laptop with no database, and
`npx jest src/__tests__/db` is green in both states.

Two details worth knowing:

- **The probe is synchronous** (`spawnSync`), not a `beforeAll`. Several tests
  here use `test.failing()`, which fails when its body _passes_ — a body that
  quietly no-ops without a database would turn the suite red. The decision has
  to be made at collection time.
- **The probe checks the schema, not just the port.** On a machine running more
  than one Supabase project, port 54322 is very often bound by somebody else's
  stack. Connecting and running DDL against that would be both wrong and rude,
  so the probe reports `wrong-schema` and gates out instead.

## What is in here

| File                                  | Finding                                                                      | Marker         |
| ------------------------------------- | ---------------------------------------------------------------------------- | -------------- |
| `function-grants.test.ts`             | A-3, A-5 — SECURITY DEFINER functions executable with the published anon key | `test`         |
| `site-delete-cascade.test.ts`         | A-35, A-13 — a site holding content could not be deleted at all              | `test`         |
| `rls-policies.test.ts`                | P2 permissive-policy class                                                   | `test`         |
| `content-version-i18n.test.ts`        | A-15 — snapshot/restore collapse language and variant                        | `test.failing` |
| `restore-reports-rows.test.ts`        | A-16 — restore reports success while restoring nothing                       | `test.failing` |
| `content-version-concurrency.test.ts` | A-23 — `create_content_version` races its own UNIQUE constraint              | `test.failing` |

`test.failing` passes while the defect exists and **fails the moment it is
fixed**, which is the signal to delete the marker. See "Test conventions for
this backlog" in `docs/archive/2026-08-07-qa-production-audit.md`.

`function-grants.test.ts` has been through that cycle and records it.
`20260809120000_lock_down_definer_functions.sql` closed A-3/A-5; the marker was
first left in place because no Docker daemon was available, then run against a
local Supabase, where it reported

```text
Failing test passed even though it was supposed to fail.
```

which is precisely the signal above. It is a plain `test` now, and the query
returns exactly the three allowlisted RLS predicates.

## Every `test.failing` has a `guard:` sibling

`test.failing` passes on **any** throw — a typo in the SQL, a seed that writes a
column that does not exist, a pool that never connected. All of those look
identical to a confirmed defect. So each `test.failing` is paired with an
unmarked test named `guard: …` that walks the same path and asserts only what is
true whether or not the defect is fixed.

Measured, not assumed. Breaking the seed in `content-version-i18n.test.ts` so it
writes a nonexistent column gives:

```text
● … › guard: the four seeded rows exist and a version is written        FAILED
● … › guard: restore overwrites the clobbered rows with snapshot values FAILED
Tests: 2 failed, 2 passed, 4 total
```

The two `test.failing` cases **passed** — they would have been read as "A-15
confirmed". The guards are what named the real problem. If you add a
`test.failing` here, add a guard with it.

## Cleaning up after a run

Each suite creates sites named `rcf-dbtest-<label>-<suffix>.invalid` and deletes
them, with their content elements and versions, in `afterAll`.

That deletion is a plain `DELETE FROM sites`, and until recently it could not be.
`content_change_trigger` used to be an `AFTER DELETE` trigger that inserted the
deleted row into `content_history`, whose foreign key requires the
`content_elements` row to still exist. So every delete of a content element
raised 23503, and the `ON DELETE CASCADE` from `sites` inherited it (A-35):

```text
ERROR:  insert or update on table "content_history" violates foreign key
        constraint "content_history_content_element_id_fkey"
CONTEXT: PL/pgSQL function log_content_change() line 10
```

`deleteSites` worked around that with `session_replication_role = 'replica'` and
deleted the children explicitly — a workaround for the harness, while the same
trigger made site deletion fail in the product.

`20260809130000_content_history_definer_and_delete_split.sql` splits the trigger
into `AFTER INSERT OR UPDATE` plus a separate `BEFORE DELETE`, so the history row
is written while its parent still exists and the cascade completes. The
workaround is **removed** rather than left in place: while it was there, this
harness was the only caller in the repository that could delete a site, and its
teardown hid the defect from every suite that used it. Teardown now takes the
same path the product does, so a regression surfaces here first —
`site-delete-cascade.test.ts` is the dedicated case.
