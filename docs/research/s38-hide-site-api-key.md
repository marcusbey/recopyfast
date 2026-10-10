# Research — s38-hide-site-api-key

Date: 2026-09-25. Scope: local repository and disposable database only. Production privilege observations below were supplied by the operator, not re-queried by this lane.

## Verified premise and exposure window

The operator verified table SELECT and api_key column SELECT for authenticated and anon in production. `20260813120000_hide_sites_api_key.sql` revokes only column SELECT while Supabase table SELECT remains. Privileges are additive: this did not remove access. The key was readable to RLS-authorized site collaborators from table creation in `20250817000000` (2025-08-17) through operator application of the s38 fix. The 2026-08-13 column revoke did not reduce that exposure. Migration timestamps identify the repository history; exact production deployment times were not queried. This is an exposure finding, not evidence of exploitation.

Any authenticated collaborator whose site_permissions row passes sites RLS, including view-only collaborators, could read that site's HMAC secret through PostgREST and mint site tokens. It does not imply access to every tenant. Anon holds the wrong privilege but auth.uid() is null and the current policy returns no site rows.

## Sites schema and caller audit

Current columns: id, domain, name, api_key, created_at, updated_at, status, live_at, last_reported_at, last_mismatch_domain, last_mismatch_at. Only SELECT policies exist for application users; no legitimate anonymous site read or user-scoped direct site mutation was found. Service-role is required for signing and writes.

Exhaustive graph search plus rg across src/ and server/ found no user-scoped sites wildcard or sites(*) join, and no Supabase realtime subscription. AI translate, edit-session creation, staging access, site sharing, content verification and security events use explicit metadata projections. Health GET/HEAD and health/ready were incorrectly classified as session reads: uptime requests use the anon role and queried sites.id (health GET/HEAD) or sites.count (readiness). After the s38 grants that query is denied; even before s38, the replayed policy chain could fail on anon EXECUTE for user_is_team_member. The current fix replaces those probes; final implementation and verification are recorded below. CollaborationPermissions selects the explicit teams relation. Security events embed sites(id, domain); editor-directory embeds sites!inner(id, name, domain).

Service-role reads in site-auth.ts, api/sites, registration, regenerate-snippet and server/index.js intentionally select api_key. editor-request, editor/editors and editor/handoff use safe explicit metadata. Socket.io uses the service client; there is no user-scoped realtime sites payload.

## Sibling-table audit

The only column-level table revoke found in migration history is the ineffective sites api_key revoke. webhooks.secret also has member-readable rows and inherited table SELECT; its secret_prefix is deliberately safe display metadata. api_keys.key_hash is owner-readable and the session API list unnecessarily selects it before stripping it from JSON. Full credential inventory and resulting grant decisions are recorded below after the schema audit.

## Rotation recommendation (operator only)

After applying the migration and verifying effective grants, treat existing site HMAC keys as potentially disclosed to every collaborator who could access the site during the window. Prioritize sites with view or edit collaborators: their keys crossed the owner-only boundary. Sites whose only site_permissions row is their admin owner had no new collaborator disclosure. Coordinate per-site regeneration with owners and replace all installed snippets. Do not restore an old key as rollback: it revives revoked tokens. ADR 027 means site tokens have no age expiry; changing ACLs does not invalidate copied keys or minted tokens. HTTP checks current keys on each request; existing WebSockets authenticate at handshake, so rotation alone does not disconnect live sockets. Plan an operator-controlled reconnect/revocation operation and verify old-token HTTP and new handshake rejection. No keys were rotated here. Also coordinate replacement of webhook signing secrets that were
readable to collaborators, including through the old PUT response, and update their receivers
together. Hash-only fields are not equivalent to disclosed plaintext credentials; the audit
found no evidence that their hash values can be presented directly as authentication tokens.

## Constraints and verification approach

ADR 001 preserves the inherited stack; ADR 002 requires user reads to retain RLS; ADR 027 controls rotation semantics. No UI changes, dependencies, applied-migration edits or production operations are needed. Use PostgreSQL 14 installed at /usr/local/bin and a disposable loopback cluster with Supabase auth/storage fixture prerequisites plus real migrations. Compare pre-fix failure with post-fix success; retain executable DB regression checks in CI. Repository unit mocks alone cannot prove database privileges.

## Complete secret-like column decisions

| Table / columns | Existing read boundary | Decision |
|---|---|---|
| sites.api_key | Every site collaborator, including view | Hide; only signing service needs it |
| webhooks.secret | Every site collaborator | Hide; show-once API already uses service role |
| api_keys.key_hash | Owning user | Hide; listing needs only prefix/metadata |
| editor_device_grants.grant_hash, user_agent_hash, origin_hash | Site admin | Hide unnecessary credential/fingerprint hashes; dashboard needs only site_editor_id |
| editor_verification_codes.code_hash; editor_handoffs.code_hash | Service-only RLS | No user-visible rows; retain service-only boundary |
| staging_access.verified_origin_hash, verified_user_agent_hash | Site admin | Hide unnecessary device fingerprints with explicit column grants, consistently with editor_device_grants |
| staging_access.token, verification_code | Site admin | Intentional staging URL/invitation contract; not HMAC minting keys |
| team_invitations.token | Matching invite email or team manager/owner | Intentional invite/accept contract; acceptance also requires matching signed-in email |
| edit_sessions.token | Owning user | Intentional widget session credential |
| content_editing_sessions.session_token | Site collaborators | Opaque lock selector; updates still require owning auth.uid(), not possession of token |
| domain_verifications.verification_token, verification_value | Authorized site administration | Public DNS/file/meta challenge material |
| key_prefix, secret_prefix and foreign key *_id fields | Appropriate row-scoped metadata | Display/identity, not credentials |

All migration-defined public tables were scanned for api_key/token/secret/hash columns and column revokes. JSON payloads and third-party managed schemas are not asserted secret-free by a column-name scan. No production catalogue was queried. API keys currently have a pre-existing mismatch between user-scoped mutation routes and SELECT-only RLS; this lane preserves those policies rather than expanding writes.

PostgreSQL superusers, object owners, global readers and Supabase-managed service roles are trusted platform boundaries, not anonymous or authenticated application users. ADR 034 supersedes ADR 033's overly narrow infrastructure-role test policy and sibling-write scope. Hidden-column denial is asserted for anon, authenticated and PUBLIC, including effective inherited grants; infrastructure names are explicitly documented. Superuser-only negative controls are skipped with a reason under Supabase's non-superuser postgres. The ordinary deny/grant/RLS tests must still run on that stack.

## Source regression evidence

The three API-key projection tests failed against the original GET/POST/PUT selections and
passed after the explicit projections. Focused run: 3 suites / 16 tests passed; targeted lint
and complete TypeScript check passed. The source guard scans src/ and server/ for sites
default/wildcard selects and embedded wildcards, with reviewed service-role signing exceptions.
webhooks user reads already project safe metadata; WebhookManager signing/show-once reads are
service-role. API-key rate-limiter hash reads are service-role; security statistics use safe
metadata. Device-grant authentication reads are service-role and dashboard counts select only
site_editor_id. A later independent review found a sibling response bypass missed by this initial projection
audit: WebhookManager.updateWebhook used service-role UPDATE returning *, and authenticated
PUT serialized secret back to edit/admin collaborators. The final implementation must narrow
that returning projection and response while preserving secret-on-create and signing reads.

## Real PostgreSQL baseline

The disposable PostgreSQL 14 runner replayed the complete pre-s38 migration chain with
Supabase-style default table grants. The pre-fix proof reproduced effective anon/authenticated
SELECT on all six fields being hidden (site key, webhook secret, API hash and three device
hashes). A real view-only authenticated subject could SELECT sites.api_key. This confirms
the premise locally without querying production.

## Historical database repair evidence (before this review fix cycle)

Node 20 `node scripts/run-db-invariants.mjs` applied every repository migration to an owned
PostgreSQL 14 cluster, reapplied s38 for idempotence, and passed all 8 initial DB tests. These historical tests did not contain a dashboard embed despite the original plan checkbox; m6 adds real PostgREST proof. The initial tests covered
view-only JWT metadata, hidden/wildcard SELECT rejection, service-role
access, denied unneeded mutations, role/column catalogues and deliberate privilege/schema
regressions. The runner stopped the cluster and removed its temporary directory.

CI uses a separate disposable PostgreSQL 14 service to replay this exact full chain with
minimal auth fixture prerequisites (storage-specific guarded branches remain for Supabase E2E). The initial implementation relied on the existing Supabase E2E lane receiving the migration normally, but had not run its privilege suite there; M2 closes that verification gap. The required-db flag turns connection/schema failures into test failures;
it cannot report this dedicated gate green merely because the database is absent.

The independent-review ownership correction was verified test-first: 2/11 tests failed with
the old owner exemption; 11/11 passed after initializing as postgres, removing that exemption,
and adding unexpected-owner/superuser negative controls. Clean stock Node 20 ran the full
migration chain and repeated migration; all owned database artifacts were removed.

The webhook bypass is repaired with explicit nonsecret projections (the existing GET list
and a mutation list retaining pending_event_type/pending_payload), attaching the freshly
generated secret only on creation, and independently
removing unexpected secret fields from update results and PUT JSON. Signing/dispatch reads
remain service-only. Regression tests failed before the repair; webhook suites now pass
62 tests and combined source-security suites pass 78.

## Operator rollout boundary

1. After the draft PR is reviewed and CI is green, the operator merges it and deploys the
   Next.js code first. This includes safe API-key projections, webhook response filtering,
   staging-access projections, and anonymous health probes. The WebSocket server has no s38
   code change and requires no separate s38 deployment.
2. Before SQL, verify deployed code is serving and perform a read-only catalogue preflight:
   the five protected tables' columns match the reviewed migration lists, the applying role
   owns/can grant on them, and no production-only invoker policy/function/view needs hidden
   fields or wildcard reads. Record anonymous health GET/HEAD/readiness behavior.
3. Promptly apply `20260925120000_sites_api_key_column_grants.sql` in one transaction.
   Old API-key and staging list/create projections would request denied fields if the SQL
   preceded its compatible code. Database denial and HTTP filtering are both required.
4. Verify effective hidden-column denial for anon/authenticated and PUBLIC on all five tables,
   explicit authenticated metadata reads, absent unnecessary writes, and device hash update
   denial. Smoke-test sites list/dashboard embeds, activation, API keys, webhooks, staging
   invitations and anonymous health using the intended roles.
5. Coordinate key/snippet and webhook-secret/receiver rotation only after closing both paths,
   prioritizing sites with view/edit collaborators. Enforce ADR 027's separate live-socket
   reconnect/revocation limitation. Never restore old keys or broad table grants as rollback;
   repair an incompatible query forward.

No operator step, deployment, production query or rotation was performed by this lane.


## Review-fix caller audit and health contract

The review-fix tree initially integrated origin/main at fe98f69 (PRs #31, #33 and #34), then integrated 0b8014f (PR #32) when main advanced during verification. The final merged tree contains all four PRs.
The new activation endpoint uses the user client and selects `status, live_at`; these remain
in the sites metadata grant. The source guard also checks embedded sites projections for
api_key, including service-scoped embeds: service privilege alone does not justify selecting
or serializing a secret.

Before this correction, anonymous GET/HEAD /api/health and GET /api/health/ready depended on
sites reads. Database denial made HEAD return 503 and GET report database error; readiness
also reported an unavailable database. The updated code uses `plans.select("id").limit(1)`:
the existing public catalogue grants anon SELECT and RLS exposes active plans. An empty
catalogue is still a successful database connection, and database errors remain failures.
This measures PostgREST/Postgres connectivity without requiring a tenant row or service key.
Other health/readiness checks still determine each endpoint's overall status. Production
health behavior was not queried or changed in this lane.


The staging fingerprint audit found two additional user-query compatibility fixes:
StagingAccessManager.createAccess used default mutation returning and getSiteAccesses used
SELECT *. Both now request only the mapper's explicit metadata/token fields. Service-role
validateAccessToken/verifyEmail reads retain fingerprints for their existing validation checks.
These caller changes are part of the code-first deployment prerequisite, alongside API keys.


## Current database proof — review fix cycle

The full real migration chain on plain PostgreSQL 14 passes 13 database tests; its one HTTP
integration test is skipped because that owned cluster has no PostgREST. The actual local
Supabase stack passes all 14 database tests, including a real view collaborator's authenticated
PostgREST embedded select and hidden-field rejection. Two superuser-only assertion groups
report their explicit skip reason on Supabase; ordinary ACL/RLS/schema and mutation checks
still run. Plain PostgreSQL executes the superuser controls. Both database surfaces are wired
into CI. The pre-fix replay fails four assertions, demonstrating the original disclosure.
The final full-app gate and independent review are recorded in the plan.


The full-stack gate additionally exposed an inherited function-ACL restoration error:
20260818001000 grants authenticated EXECUTE on the unchecked SECURITY DEFINER
update_translation_coverage(uuid), later in ordering than the 20260809120000 lockdown.
No application caller needs that grant. The unapplied s38 migration restores the earlier
service-only intent, while the original strict function invariant remains unchanged.
This is a gate-driven security repair, not a new authenticated RPC contract.


After the latest-main integration, a fresh Supabase reset applied checkout migrations
20260925100000 and 20260925110000 before the s38 migration. The combined column-privilege,
function-grant and founding-cap suites pass 40/40 on that stack. The full-chain plain
PostgreSQL runner still passes 13 tests with only the HTTP test skipped.
