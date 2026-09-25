# ADR 031 — Column privileges require table-level revoke

- Status: accepted
- Date: 2026-09-25
- Scope: s38-hide-site-api-key; operator-specified security correction

## Context

The operator verified that anon and authenticated retained table SELECT on sites and effective
SELECT on sites.api_key despite 20260813120000_hide_sites_api_key.sql. PostgreSQL adds grants:
revoking the column privilege does not subtract access supplied by a table grant. RLS limits
rows, not the columns within a permitted row. Even a view-only site collaborator could read
the site's HMAC secret and mint tokens. webhooks.secret was likewise member-readable;
api_keys.key_hash and editor_device_grants credential/fingerprint hashes were unnecessarily
readable by their owner or site admin.

## Decision

For a table mixing metadata with server-only credentials, revoke table SELECT from PUBLIC,
anon and authenticated, clear existing column SELECT grants, then grant authenticated an
explicit reviewed list of non-secret columns. No anonymous grant is added without a proven
product need. sites also loses unnecessary mutation privileges; service_role retains full
access. Existing RLS policies remain the tenant boundary. The s38 migration additionally
protects webhook secrets, API-key hashes and the three device-grant hashes.

Application user reads, including embedded PostgREST relations, must name safe fields.
Service-role reads needed for signing/validation remain explicit and retain their credential
fields. A migration must not dynamically grant all future columns: a newly added column must
force a deliberate visibility decision.

Executable database assertions compare effective authenticated column grants with the current
schema minus the hidden fields, check non-infrastructure roles and inherited privileges, and
exercise authenticated queries with a view-only JWT subject. Tests must start from realistic
table grants, demonstrate the old failure, and reject table/PUBLIC/inherited/column grant
regressions and accidental schema expansion. Run them against the disposable CI database.

PostgreSQL predefined global readers and superusers have capabilities beyond ordinary ACLs.
The test permits only postgres, service_role and predefined PostgreSQL infrastructure roles;
it separately requires protected relation ownership to be postgres or service_role. An
unexpected owner or newly created superuser must fail, never become an automatic exception.
Application membership cannot reach privilege-bypass roles. Negative controls exercise both
cross-table owner access and a newly introduced superuser.

## Considered options

- Column-only revoke: rejected; this is the proven incident mechanism.
- RLS alone: rejected; it cannot express hiding a column from otherwise permitted rows.
- Move all credentials into private tables: possible future defense, but expands this urgent
  fix into a signing/storage migration and changes existing service access contracts.
- Dynamic metadata grant over every non-secret column: rejected; future fields become
  exposed without review. Explicit grants plus schema-comparison tests fail closed.

## Consequences and operations

The database now enforces the same secret visibility intended by application response
serialization. A user SELECT * fails deliberately; metadata and dashboard queries remain
explicit. Intentional invitation/session tokens and public domain challenges keep their
existing RLS-scoped contracts, documented in the research inventory.

Only a forward migration is supplied. Operator rollout order: deploy the compatible explicit
API projections and webhook response filtering first, then promptly apply the migration and
verify effective grants on the actual deployment roles. Applying the migration before the
API-key projection change would make the old list query request a denied hash. Both pieces
are needed to close the database and HTTP paths; this lane does not access production. Existing disclosed keys remain usable until coordinated rotation,
per ADR 027. Recommend owner-approved regeneration and snippet replacement for every possibly
affected site. Existing WebSockets need separate reconnect/revocation handling. Never restore
old keys or broad table grants to roll back a dashboard regression; repair the explicit query.
