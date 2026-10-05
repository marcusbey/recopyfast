---
story: s62-versioned-public-content-cache
validated: yes
---

# Versioned cache for published copy

## Outcome and approval

Reduce repeated published-content database reads while verifying the current site credential
on every request. Preserve public projection, scope, draft privacy and database fallback.
The user approved the four-stage plan with “ok start” on 2026-10-05. This written plan narrows
the cache/versioning stages into one backend story; it adds no public product behavior,
dependency, hold extension or merge/deploy permission. Independent design challenge is a
prerequisite to execution; accepted safety repairs are recorded before the implementer starts.

## Tasks

- [x] 1. Add failing real PG14 tests for a new UUID revision, all content DML, multi-site
     moves, empty writes, rollback, upsert, deletion cascade, truncate and overlapping commits, including opposite-order two-site transactions and a concurrent liveness-style sites
     UPDATE. Existing sites
     updated_at advances on revision rotation because its current timestamp trigger runs; this
     visible metadata effect is accepted as content activity, including draft/no-op mutations.
     Do not claim global deadlock freedom across arbitrary multi-statement service transactions;
     test rollback coherence for an aborted transaction and preserve existing retry behavior.
     Add one forward migration with service-only sites.public_content_revision and separate
     AFTER STATEMENT transition-table triggers. Lock affected existing sites with an explicit
     SELECT ordered by id FOR UPDATE before rotating each UUID once per event. Prefer an
     invoker trigger function; use definer only if a real test proves it necessary. Preserve
     RLS/grants/history triggers. Deny function execute to PUBLIC/anon/authenticated, fix
     search_path, and name the revision server-only in the
     effective privilege suite. Prove retry convergence, existing column and function invariants.
- [x] 2. Add an optional includePublicContentRevision argument to authorizeSiteRequest and
     optional revision in SiteRecord; only the public widget GET asks for it when the internal
     PUBLIC_CONTENT_CACHE_ENABLED env flag is exactly true. Default off means the original
     auth projection and DB path; this is deployment activation, not a customer protection
     option. Existing callers
     keep their old exact projection/signature behavior. Validate UUID before use; invalid/missing
     revision bypasses cache, not authorization. Verify migration/ACL/trigger presence before enabling that env flag and redeploying.
     No manifest or customer toggle; test disabled mode against a schema without the column.
- [x] 3. Build a private published-content cache using the installed redis package. Key a
     SHA256 of a JSON tuple [format, siteId, revision, language, variant, pagePath]; null path
     remains distinct from root. Envelope identity and whitelisted public rows must validate,
     with matching site/language/variant/scope, no staging attributes/private fields. Legacy
     pagePath=null permits every row page_path; a scoped P permits P and shared null only.
     TTL 300 s,
     payload max 1 MiB; oversize skips cache and still returns every DB row. Bound bytes before
     decode with GETRANGE up to MAX+1 (prefer Buffer), reject excess, then parse/validate.
     Visitor read/connect together have a 30 ms programmed budget; deferred connect+SET has
     a separate total 250 ms budget so a slower cold handshake can warm the private singleton.
     Error listener, offline queue disabled, no reconnect loop, identity-safe cleanup: a late
     timeout never destroys another operation or replacement client. All errors are redacted;
     missing env/errors/corruption produce miss. No 250 ms wait in the visitor response.
- [x] 4. Integrate only after successful widget auth and page normalization, keep cookie
     dashboard reads uncached. Hit uses identical published response and per-request CORS. Miss
     uses current pagination/projection. Re-read revision after DB fill, and schedule cache
     write via Next after only if revisions agree and payload fits. The follow-up read/write
     must not delay the visitor response; callback does not recache data on revision mismatch.
     Keep existing liveness behavior on this independent branch; s60 remains separate.
- [x] 5. Test warm hit, empty hit, miss, DB errors, invalid/revoked token with warm cache,
     denied origin, legacy/path/language/variant separation, no-token dashboard, metadata privacy,
     malformed/oversized cache, missing Redis, rejection/timeouts, simultaneous clients and a
     delayed old fill after Publish. No error/auth/private response enters storage. Include
     mutation proofs for skipping auth-before-hit and removing revision invalidation.
- [x] 6. Run matched fixture backend measurements (20 alternating pairs; same rows/payload)
     with production-mode route semantics and isolated data/cache. Report connection/read/fill
     timing, p50/p95 and timeout/error overhead honestly. Do not substitute artificial DB latency
     for real production improvement. Integration with s59/s60/s61 occurs only in a disposable
     diagnostic preview with exact SHAs; reconcile overlapping API changes explicitly.
- [ ] 7. Run targeted then full required tests, typechecks, lint, format, embed freshness/byte
     gates and build, normal hooks. Add mandatory real revision/privilege suite to existing CI
     disposable PostgreSQL proof, without weakening audit or browser-count gates. Obtain an
     independent fresh review; then prepare a draft PR with security/release evidence gaps visible.

## Release conditions

No live migration, merge, promotion or real customer copy mutation in this story execution.
Both package audit gates, s59 guide integration, s60/s61 combined review, the customer-site
head adapter and at least 19/20 real representative cold homepage visits within the unchanged
200 ms hold are required before final production approval. The cache improves DB delivery;
it does not remove every network/hydration delay or guarantee a zero-flash first visit.

## Files and design

`docs/research/` and `docs/decisions/045-versioned-public-content-cache.md`, one new migration,
`src/lib/content/` cache/projection module and tests, `src/lib/security/site-auth.ts` and tests,
`src/app/api/content/[siteId]/route.ts` and route tests, real DB suite/harness runner and CI.
No UI design is required. No unrelated API write-path changes or widget source changes.

## Independent design challenge, 2026-10-05

The independent reviewer approved implementation after the repairs above: bounded pre-decode
GETRANGE, distinct visitor/deferred cache budgets, explicit row locking, invoker-first trigger
privileges, default-off migration activation, precise legacy/shared scope and accepted
sites.updated_at behavior. Database proof comes before cache source. Production speed remains
an empirical gate; payload availability and runtime/hydration readiness are separate timings.
