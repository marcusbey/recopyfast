# Database schema

## `migrations/` is the single source of truth

Everything the database needs must live in `supabase/migrations/`. That directory
is what `supabase db push` applies, what CI can rebuild from zero, and what
production is expected to match.

```bash
supabase db push        # apply pending migrations
supabase db reset       # rebuild a local database from migrations/ alone
```

### Adding a migration

- File name: `YYYYMMDDHHMMSS_short_description.sql`, timestamp strictly greater
  than every existing file.
- Never edit a migration that has been applied anywhere. Add a new one instead.
- Make it **idempotent and re-runnable**:
  - `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
    `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`
  - `DROP POLICY IF EXISTS` before every `CREATE POLICY`
  - `DROP TRIGGER IF EXISTS` before every `CREATE TRIGGER`
  - PostgreSQL has **no** `ADD CONSTRAINT IF NOT EXISTS` — that is a syntax
    error. Guard it instead:
    ```sql
    DO $$
    BEGIN
      ALTER TABLE t ADD CONSTRAINT t_x_key UNIQUE (x);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table  THEN NULL;  -- backing index already exists
    END
    $$;
    ```
- Use `gen_random_uuid()` (pgcrypto), not `uuid_generate_v4()`.
- Enable RLS on every new table and write policies. Site scope flows through
  `site_permissions` → `sites`; user scope through `user_id = auth.uid()`;
  backend write paths get an explicit `TO service_role` policy. See
  `20260611010000_rls_hardening.sql` for the house pattern.

### RLS gotchas, learned the hard way

- **`ENABLE ROW LEVEL SECURITY` without any policy denies everything.** It is not
  a partial measure — anon/authenticated see zero rows. Always ship the policies
  in the same migration as the `ENABLE`.
- **Policy subqueries are themselves subject to RLS.** A policy that reads
  `EXISTS (SELECT 1 FROM site_permissions …)` only works if the calling user can
  actually *see* their own `site_permissions` row. Until
  `20260731008000_rls_policies_for_locked_tables.sql`, they could not, so every
  site-scoped policy in the schema silently evaluated to false.
- **Self-referential policies raise "infinite recursion detected in policy".**
  Use the `SECURITY DEFINER` helpers instead of re-querying the table a policy is
  attached to:
  - `public.user_has_site_permission(site_id, ARRAY['edit','admin'])`
  - `public.user_is_team_member(team_id)`
  - `public.user_has_team_role(team_id, ARRAY['manager','owner'])`
- **`service_role` bypasses RLS entirely** (it holds `BYPASSRLS`). The explicit
  `TO service_role` policies are documentation of intent, not enforcement.
- Verify changes by actually switching role, not by reading the policy:
  ```sql
  BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claim.sub" = '<user-uuid>';
    SELECT count(*) FROM site_permissions;
  ROLLBACK;
  ```

## The loose top-level `*.sql` files are superseded — do not use them

These files are **not** run by `supabase db push`. They are the historical
"paste into the SQL editor" scripts, and their contents have drifted from both
`migrations/` and the application code:

| File | Status |
| --- | --- |
| `schema.sql` | superseded by `20250817000000_complete_database_setup.sql` + `20260731004000_missing_tables_integrations.sql` |
| `security-schema.sql` | superseded by `20250817000000_complete_database_setup.sql` |
| `billing-schema.sql` | superseded by `20250817000000…`, `20260617001000_ticket_wallet_compat.sql`, `20260731003000_missing_tables_billing_credits.sql` |
| `collaboration-schema.sql` | superseded by `20250817000000…`, `20260731000000_collaboration_schema_alignment.sql`, `20260731001000_missing_tables_collaboration.sql` |
| `analytics-schema.sql` | superseded by `20260731002000…`, `20260731004000…`, `20260731005000_analytics_schema_alignment.sql` |
| `credit-system-schema.sql` | superseded by `20260731003000_missing_tables_billing_credits.sql` |
| `edit-sessions-schema.sql` | superseded by `20250817000000_complete_database_setup.sql` |
| `ai-schema-update.sql` | **not superseded** — defines `ai_usage` / `ai_suggestions`, which no application code currently queries. Port it to a migration if those tables are still wanted; otherwise delete it. |

Running any of them against a live database will fail or, worse, partially
succeed and re-fork the schema. They are retained only so the deltas above can
be audited; **they should be deleted once that audit is signed off.**

## Known outstanding issues

1. **Two existing migrations fail on a from-scratch build** (they were written
   against a database that had been seeded by the loose files):
   - `20260531000000_stripe_event_idempotency.sql` — `ALTER TABLE billing_events`
     runs before any migration creates `billing_events`.
   - `20260611040000_billing_constraints.sql` — touches `ticket_transactions`,
     which is not created until `20260617001000_ticket_wallet_compat.sql`.

   Both need the referenced statements wrapped in a `to_regclass(...) IS NOT NULL`
   guard, or the whole chain squashed into a new baseline. Until then
   `supabase db reset` cannot complete.

2. **`team_activity` is orphaned.** `20250817000000_complete_database_setup.sql`
   creates `team_activity` (`activity_type`/`entity_type`/`entity_id`/`metadata`)
   and `20260611010000_rls_hardening.sql` attaches policies to it, but no
   application code reads or writes it. The table the code actually uses is
   `team_activity_log` (`action`/`resource_type`/`resource_id`/`details`), created
   in `20260731001000_missing_tables_collaboration.sql`. Drop `team_activity`
   once you have confirmed it holds no rows worth migrating.

3. **`auth` schema is not exposed to PostgREST**, so the
   `auth.users!team_activity_log_user_id_fkey` embed in
   `src/app/api/teams/[teamId]/activity/route.ts:44` cannot resolve. Expose a
   public view over `auth.users` and embed that instead.

4. **Duplicate column pairs still in flight.** `site_permissions` carries both
   `permission` and `role`; `ab_test_variants` carries both `(name,
   variant_content)` and `(variant_name, content)`. Migrations
   `20260731000000` and `20260731006000` keep them consistent (the latter with a
   trigger) so both code paths work, but the routes should converge on one
   spelling and the shims should then be removed.

5. **`log_content_change()` can reject valid inserts.** The trigger created in
   `20250817000000_complete_database_setup.sql` writes `NEW.current_content` into
   `content_history.content`, which is `NOT NULL` — so inserting a
   `content_elements` row without `current_content` fails with a not-null
   violation.
