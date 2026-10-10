# ADR 034 — Supabase column boundary and least privilege

- Status: accepted
- Date: 2026-09-25
- Scope: operator-authorized s38 review fixes M2, m4 and m5
- Supersedes: ADR 033 only for infrastructure-role assertions and sibling mutation/fingerprint scope; its table-revoke and explicit-column decisions stand.

## Context

The s38 review proved that the column grants worked, but the invariant suite rejected legitimate
Supabase infrastructure roles and attempted superuser DDL as Supabase's non-superuser postgres.
It also found unnecessary sibling-table mutations, writable device-grant hashes, and staging
fingerprints that were still visible despite equivalent device fingerprints being hidden.

## Decision

The denied principals are PUBLIC, anon and authenticated. Tests inspect both explicit PUBLIC
ACLs and effective application-role privileges, so grants inherited through another role still
fail. They do not claim that database administrators or managed replication/global-reader roles
cannot read data. Explicit platform exceptions include postgres, service_role, supabase_admin,
supabase_etl_admin and supabase_read_only_user. The test documents any additional managed roles
it permits. Protected tables must still have a reviewed platform owner; web roles must not reach
privilege-bypass infrastructure through membership.

Supabase documents the [managed role purposes](https://supabase.com/docs/guides/database/postgres/roles)
and [grants before RLS](https://supabase.com/docs/guides/api/securing-your-api). Its official
[Postgres initialization](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql)
creates supabase_read_only_user with BYPASSRLS and pg_read_all_data. Its global read access is
intentional platform behavior, not evidence of a broken application-column ACL.

Negative controls that create superusers or transfer ownership to an unrelated role run only
when the connected principal is a superuser. A non-superuser run reports those controls skipped
with a reason. Ordinary grants, effective-privilege, RLS, schema-drift and user-query assertions
continue to run. Both a plain PostgreSQL migration replay and a real local Supabase stack are
required verification surfaces. A real PostgREST embedded dashboard query is part of the latter.

Revoke TRUNCATE, TRIGGER and REFERENCES from web roles on webhooks, api_keys and
editor_device_grants. Retain INSERT/UPDATE/DELETE only where an existing RLS policy requires
that operation. In particular authenticated users cannot overwrite device-grant hash columns;
any retained device mutation grant is an explicit reviewed non-secret column list.
Apply the same read-column allowlist strategy to staging_access.verified_origin_hash and
verified_user_agent_hash. Keep intentional staging invitation/token fields under existing RLS.

The operator confirmed the s38 migration is unapplied anywhere, so these changes belong in
20260925120000_sites_api_key_column_grants.sql. This does not permit editing applied migrations.

## Alternatives

- Exempt every future superuser/owner: rejected; it silently widens the platform boundary.
- Run only plain PostgreSQL: rejected; it misses real Supabase roles and PostgREST behavior.
- Require superuser for all tests: rejected; hosted/local Supabase postgres need not have it.
- Preserve every sibling write grant: rejected; RLS does not protect TRUNCATE and broad column
  UPDATE lets a site admin replace device hashes without reading them.

## Rollout

Deploy compatible application code first, including the anonymous health probe fix and API-key
projection. Then the operator applies the migration in one transaction and verifies grants and
user dashboard queries. Rotate potentially disclosed keys only after closing database and HTTP
paths, prioritizing sites with view/edit collaborators. ADR 027's socket and snippet limits stand.
No deployment, remote database operation or rotation is performed by this implementation lane.
