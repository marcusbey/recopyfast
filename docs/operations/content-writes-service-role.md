# Runbook — shipping s56 (content tables take no direct writes)

s56 ([ADR 042](../decisions/042-content-writes-are-service-role-only.md)) removes every direct
write by `anon`, `authenticated` and PUBLIC on the nine content, history and A/B tables. Migration:
`supabase/migrations/20260928140000_content_writes_are_service_role_only.sql`. The four routes
that used to write with the user's JWT now write through the service role: bulk update, bulk
import, AI translate, and A/B POST/PUT.

This is the operator's step, not the implementer's.

## 1. Deploy order — the application first, then the migration

This is the reverse of [founding-offer.md](./founding-offer.md).

- **The migration breaks the OLD code.** Its four user-JWT writes are refused with 42501, and
  dashboard bulk import and bulk update are live.
- **The NEW code works on either schema.** Its writes go through `service_role`, which holds DML
  before and after the migration.

So the only broken pair is old code on the new schema, and the order is: merge, confirm the
deploy is live, then migrate. The hole stays open for the minutes in between, as it has been
since the tables were created.

**In this repository, merging to `main` IS the production deploy** (Vercel Git integration).

1. **Merge** the reviewed PR.
2. **Confirm the Vercel production deploy is live** and serves the merge commit. The production
   deployment for that SHA must read `Ready` and be aliased to the production domain. Do not go on
   while it is `Building`, `Queued` or `Error`, or while the domain still points at the previous
   deployment.

## 2. Apply the migration

From the merged `main`, with the Supabase CLI linked to the intended production project:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list **only** `20260928140000`. Stop if the project identity or the list
differs. Then:

```bash
supabase db push --linked
```

## 3. Verify with the catalogue, not the ledger

A migration that aborts can still be recorded as applied (see `20260818010000`'s header). Check
the effect, read-only, through the `read-prod-database` path:

```sql
WITH content_tables(name) AS (
  VALUES ('content_elements'), ('content_versions'), ('content_history'),
         ('staging_history'), ('ab_tests'), ('ab_test_variants'),
         ('ab_test_results'), ('visitor_buckets'), ('conversion_events')
)
SELECT 'grant' AS kind, t.name || ' ' || r.role || ' ' || p.priv AS offender
FROM content_tables t
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
WHERE has_table_privilege(r.role, format('public.%I', t.name), p.priv)
UNION ALL
SELECT 'column grant', t.name || ' ' || r.role || ' ' || p.priv
FROM content_tables t
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) p(priv)
WHERE has_any_column_privilege(r.role, format('public.%I', t.name), p.priv)
UNION ALL
SELECT 'policy', c.relname || ' :: ' || pol.polname || ' [' || pol.polcmd::text || ']'
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN content_tables t ON t.name = c.relname
WHERE c.relnamespace = 'public'::regnamespace
  AND pol.polpermissive
  AND pol.polcmd IN ('a', 'w', 'd', '*')
  AND (pol.polroles = '{0}'
       OR EXISTS (SELECT 1 FROM unnest(pol.polroles) r
                  WHERE r = 0 OR pg_get_userbyid(r) IN ('anon', 'authenticated')));
```

**Expect zero rows.** Then check that reads survived:

```sql
SELECT has_table_privilege('authenticated', 'public.content_elements', 'SELECT') AS member_reads,
       has_table_privilege('service_role', 'public.content_elements', 'UPDATE') AS service_writes;
```

Expect `t`, `t`.

Finally, in the dashboard, run one bulk update on a test site owned by a paying account. It must
report `1 updated` and the live copy must change.

## 4. Rollback

Never edit `20260928140000`. A rollback is a **new forward migration** that does two things:

- re-creates the seven production policies, word for word from their last definitions:
  - `20250817000000:461` for "Users can edit content for authorized sites";
  - `20260801200000:786,800,824` for the three `ab_tests` policies;
  - `20260801200000:866,882,908` for the three `ab_test_variants` policies;
- re-grants INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER to `anon` and
  `authenticated` on the tables that held them.

The new code keeps working after a rollback, because it never needed those grants. A rollback
therefore only reopens the hole. Use it only if the migration itself turns out to be wrong,
never to fix a route: fix the route instead.
