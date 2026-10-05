# ADR 045 — Cache published payloads behind fresh authorization and transactional revisions

- Status: accepted
- Date: 2026-10-05
- Scope: s62-versioned-public-content-cache

## Context

The public content request remains too slow for s61's 200 ms maximum hold. s60 removes
avoidable liveness/terminal reads but still queries published rows on each visit. Token-bearing
GETs do not qualify for ordinary CDN response caching, and caching origin decisions or tokens
would let revoked/wrong-domain requests bypass the current authorizer. Several routes, not
just Publish, modify the public projection.

## Decision

Keep the IP limiter and current site-token/domain authorization on every request. Ask that
existing service lookup for a UUID public_content_revision only on widget content GET. Keep
the revision service-only with explicit effective-ACL tests; do not change RLS or expose a
credential column. Store only the existing sanitized public array in private Redis under a
versioned tuple including site, revision, language, variant and normalized page scope.

Database AFTER STATEMENT triggers on content_elements rotate the UUID in the same transaction
for inserts, updates, deletes, moves and truncate. Conservative invalidation includes draft and
no-op writes; this avoids missing a future live column/write path. Distinct affected sites
are explicitly locked by SELECT ordered by id FOR UPDATE and then touched once per event. A rollback rolls back the revision. UUID defaults
keep a deleted/recreated site's incarnation from reusing old content.

A miss fetches existing paginated data. A post-response revision recheck only permits storing
under the auth revision when unchanged; raced fills are skipped. Old keys expire in 300 s
and cannot be addressed after a new authorization revision. Read/connect budget is 30 ms,
1 MiB maximum cache payload, GETRANGE MAX+1 before decode/validation, no offline queue or
reconnect, redacted errors, identity-safe client lifecycle and asynchronous writes. A deferred
connect+SET gets a separate total 250 ms budget so cold TLS can warm the singleton without
lengthening the visitor response. A read timeout must not destroy a concurrent fill/replacement.
Cache failure remains a database miss. Never cache error, auth, CORS, grant, draft or A/B data.

## Alternatives

- Post-write DEL: rejected; process crash and in-flight fill can restore stale keys.
- Cache authorization/credentials: rejected; key rotation and domain changes must take effect
  on the next request.
- Public s-maxage/URL token: rejected; changes the current security/privacy boundary.
- Per-route invalidation: rejected; publish/import/v1/discovery and future writers would drift.
- Whole-page or longer concealment: rejected by the user; improve delivery within 200 ms.
- Shared limiter/cache client: rejected; limiter budgets and fail-closed write guarantees
  must remain independent from this optional optimization.

## Consequences

Migration before activation, enforced by default-off PUBLIC_CONTENT_CACHE_ENABLED. Only
literal true requests the revision column or cache; operator verifies migration/ACL/trigger
presence before enabling and redeploying. Customer startup protection has no new option.
Prefer invoker trigger functions because existing service-role and definer RPC writes already
have the required privileges; a real test must justify any definer fallback. Deny direct
function execute to web roles and use a fixed safe search_path. Server-only column/function
decisions remain explicit. The existing sites.updated_at trigger runs on revision changes;
its draft/no-op content activity timestamp effect is accepted. Draft
editing may lower cache hit rate. A request authorized before a concurrent publish may return
its older version; requests begun after commit address the new version. An administrator
disabling triggers must bypass cache and rotate revisions before serving traffic again.
Backend cache success is not proof of browser timing. Real cold-page testing and release
audits remain blocking. Independent design challenge completed with these safety repairs before execution.
Legacy null scope remains all-site; scoped P contains P and shared NULL rows. Stable lock
order is per statement, not a claim of deadlock freedom for arbitrary multi-statement
transactions; PostgreSQL abort/rollback must preserve both data and revision coherence.

## Operator rollout and rollback

`PUBLIC_CONTENT_CACHE_ENABLED` is internal and default-off. Only exact lowercase `true`
changes the public widget GET; there is no customer-facing switch. Roll out in this order:

1. Deploy the database migration while the flag is absent or `false`.
2. Require the disposable PG14 proof (`node scripts/run-db-invariants.mjs`) and CI's real
   PostgreSQL/PostgREST revision plus privilege step to pass for the exact application SHA.
3. Before enabling an environment, verify its migration ledger contains
   `20261005000000_versioned_public_content_cache.sql`; every site has a non-null UUID
   `public_content_revision`; all four `rotate_public_content_revision_*` triggers are enabled
   on `content_elements`; the five revision functions are invoker-security with fixed
   `public, pg_temp` search paths and no PUBLIC/anon/authenticated execute; authenticated has
   no effective SELECT on the revision while service_role does.
4. Set `PUBLIC_CONTENT_CACHE_ENABLED=true` in that one target and redeploy. Environment edits
   without a redeploy do not activate a Vercel function revision. Verify fresh auth still
   precedes Redis, DB fallback works, and no draft/private/error response is stored.

Safe application rollback is `PUBLIC_CONTENT_CACHE_ENABLED=false` followed by redeploy. The
column and triggers may remain: they preserve correctness and only rotate server metadata.
If their measured write contention itself requires removal, disable and redeploy the cache
first, then ship a separate forward migration; never disable the triggers while cached reads
remain enabled. No live environment change is authorized by this ADR.
