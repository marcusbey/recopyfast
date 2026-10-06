# Research — s62-versioned-public-content-cache

## Premise and current behavior

The existing backend performs a fresh sites authorization lookup, paginated public content
reads and an awaited liveness write. Open s60 defers that write and removes terminal empty
queries when exact counts are available. Open s61 starts public delivery in the document head
and caps concealment at 200 ms. The previously recorded production operator HTTP sample
(median 589 ms, 20/20 over 200 ms) is historical API evidence, not a candidate deployment or
fully cold browser measurement. Existing fixes must first be combined and measured.

Verified on main 9aa492d and the separate story branches, 2026-10-05. The graph tool returned
Transport closed; bounded source reads were used instead. No production database write ran.

## Verified source surfaces

- `src/app/api/content/[siteId]/route.ts`: GET uses `fetchPageScopedRows`, normalizes page
  scope, reads an explicit published column list, removes metadata.staging_attributes, and
  maps published_content ?? original_content to current_content. The existing response is an
  array. POST discovery inserts published authored rows and avoids overwriting existing edits.
- `src/lib/security/site-auth.ts`: `authorizeSiteRequest` reads id/domain/api_key through
  the service client and checks signature, future issue time and allowed site domain. Existing
  no-token dashboard auth is a different branch. A current revision can join that lookup
  without another database round trip. The option must remain off for unrelated callers.
- `src/lib/content/paged-elements.ts`: paginated per-page and shared NULL scopes, with legacy
  omitted-path all-site behavior. Preserve the entire result and existing server caps.
- `src/lib/security/rate-limiter.ts`: node-redis lazy singleton, bounded connection/commands
  and mandatory error listener. This client is private to the limiter and its 1500/2000 ms
  budgets exceed startup. Do not change rate-limit guarantees to build the content cache.
- Latest publish SQL: `supabase/migrations/20260924060000_restore_site_wide_publish.sql`,
  `publish_staging_content_with_attributes_atomic`, writes published text/attributes in its
  transaction. Direct live writers also include bulk/import, bulk/update and api/v1/content.
  Cache invalidation confined to the publish route would miss those paths.
- `src/__tests__/db/db-harness.ts`: real PostgreSQL suite with required-target failure mode;
  `scripts/run-db-invariants.mjs` creates disposable PG14, replays the full migration ledger,
  verifies column privileges, and cleans up its own cluster. initdb/pg_ctl are available.
- `src/__tests__/db/column-privileges.test.ts` derives reviewed columns from current schema
  excluding an explicit server-only list. Adding a revision requires an explicit visibility
  decision there, not a grant of every future column. `function-grants.test.ts` denies public
  execute on definer functions except named RLS predicates.

## Traps

1. Post-write Redis DEL has a crash window and a stale refill race. A revision committed in
   the content transaction makes old keys unaddressable without relying on deletion.
2. Revision before and after a paginated miss must agree before caching. A concurrent publish
   can otherwise put mixed pages under a fresh key. Return existing read behavior if they
   differ, but skip cache storage; do not label it an atomic content snapshot.
3. A request whose authorization precedes a concurrent publish may return that prior revision;
   a request starting after committed Publish must use the fresh revision. Auth/key rotation
   is never cached. Redis is private optimization, not a new principal or authority.
4. Content row moves require OLD and NEW site ids. Empty statements must not bump unrelated
   sites. Site deletion cascade must not recreate a revision row or break cleanup.
5. Conservative draft/no-op update invalidation is safe and bounded per statement, but can
   lower cache hit rate while editors type. No draft enters the cache.
6. Transition relations require separate AFTER STATEMENT triggers per event. TRUNCATE has no
   transition rows and must invalidate existing sites conservatively. Existing history and
   timestamp triggers remain unchanged. Disable-trigger operator operations are outside web
   principal capability and require an explicit cache bypass/revision bump operational rule.
7. Warm Redis is not a cold browser: preflight, TLS, limiter, fresh authorization, runtime
   download and host hydration still cost time. No claim of <=200 ms until measured.

## Primary documentation verified

- PostgreSQL 14 CREATE TRIGGER: https://www.postgresql.org/docs/14/sql-createtrigger.html
  (transition relations, statement behavior, TRUNCATE and upsert behavior).
- node-redis configuration: https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
  and the installed package declarations (disableOfflineQueue, reconnectStrategy, destroy).
- Vercel CDN: https://vercel.com/docs/caching/cdn-cache
  (Authorization-bearing requests do not qualify for ordinary CDN response caching).

## Complexity and open evidence

Complexity 4: one public read route, one optional auth projection, one forward migration and a
private bounded cache module. No new screen, dependency or widget byte allocation. Independent
design challenge must settle transaction/ACL/concurrency details before implementation. Full
production/browser improvement is unverified; security audits and customer adapter remain
release dependencies. The historical backlog review is not reclassified; this expressly
approved performance story receives its own research, plan and fresh review.

## Independent challenge and accepted refinements

The fresh reviewer confirmed node-redis5.8.1 supports bounded GETRANGE and Buffer mapping.
Plan/ADR record a30ms visitor budget and a separate250ms deferred connect+write budget;
explicit ordered row locks; invoker-first trigger privileges; default-off migration activation;
exact legacy/shared scope; and sites.updated_at side effects. Current liveness already updates
that timestamp and contends on the same sites row. Include a concurrent liveness UPDATE in
DB proof; do not label sorted ids or cache hits as throughput proof.

## Effective write inventory and implementation anchors

The trigger boundary covers more than the route names in the first pass:

- site-wide text and attribute publish through
  `publish_staging_content_with_attributes_atomic` (latest definition
  `20260924060000_restore_site_wide_publish.sql`);
- widget discovery insert/upsert in `api/content/[siteId]`;
- direct live bulk import and bulk update loops;
- v1 POST/PUT/DELETE service-role writes; and
- AI translation inserts, whose public response can still change through the
  `published_content ?? original_content` fallback when published_content is null.

Staging save, style apply and A/B winner promotion currently mutate draft fields only. The
accepted conservative UPDATE trigger rotates for those writes and no-ops anyway, preventing a
future live-column/write-path omission. Metadata is load-bearing: publish promotes attributes
inside metadata while the public projection removes `staging_attributes`, so invalidation
limited to published_content would be incorrect. Site cascades need no Redis deletion because
fresh auth fails after deletion and old UUID keys expire; row moves rotate OLD and NEW sites.

The installed Redis limiter client stays private and unchanged. The cache owns a separate
optional client because its 30 ms fail-open visitor budget and 250 ms deferred warm/write
budget are incompatible with the limiter's longer fail-closed guarantees. Local Redis 7 and
PG14 proofs establish behavior, not production TLS latency. An observed existing-production
homepage visit on 2026-10-05 showed authored h1 text at 299 ms and published text at 4387 ms;
that single DOM sample predates this candidate and is neither pixel timing nor proof that the
cache alone can satisfy s61's 200 ms cap.

## Local matched backend measurement

`node scripts/measure-public-content-cache.mjs` ran 20 alternating matched pairs against
owned loopback PostgreSQL 14 and Redis 7 processes, 100 identical page/shared rows and a
37,141-byte public payload. Both paths included a fresh sites auth projection and the current
awaited liveness UPDATE. Direct DB page/shared reads measured p50 1.399 ms / p95 1.968 ms;
warm versioned Redis measured p50 0.932 ms / p95 1.804 ms. Initial cold fill was 16.408 ms;
an unreachable loopback Redis degraded to a miss in 12.467 ms. These small local differences
show functional overhead, not production improvement: they exclude browser preflight, TLS,
runtime download and hydration, and loopback cannot model hosted Redis or Supabase latency.

## Local verification record

`npm run precommit` and `npm run prepush` passed with 312 Jest suites passing,
2 skipped, 4,046 tests passing and 38 skipped; the production build and coverage
thresholds also passed. The disposable PostgreSQL 14 runner passed 27 revision and
privilege assertions with one inherited gated skip, and the owned Redis 7 proof passed
its real SET/GETRANGE/TTL/expiry case. `npm run format:check` passed.

The browser gate is not marked green from this workstation. With an owned development
server and inert local credentials, Playwright reported 15 passing, 4 pricing failures
and 25 skipped because the local Supabase fixture exposed no plan catalogue. Those
pricing failures do not exercise the s62 cache path, but they remain a verification gap
until hosted CI runs against its seeded stack. `npm run audit:prod` also remains blocked
by the inherited dependency advisories being repaired on the separate security branch;
this story does not change dependency manifests or lockfiles.

## Review repair: ready-socket command queue

The pinned independent review found that the 30 ms and 250 ms `Promise.race` budgets
bound callers but cannot cancel a command already written to Redis. `disableOfflineQueue`
only rejects work while the client is disconnected or reconnecting. A ready TCP peer that
accepts GETRANGE/SET and stops replying leaves those commands in node-redis's ordered
waiting-for-reply queue after each cache caller has fallen back.

The installed node-redis queue counts both commands waiting to write and commands waiting
for a reply. The private content client therefore sets `commandsQueueMaxLength: 16`; excess
cache work rejects through the existing redacted fail-open path while PostgreSQL remains
authoritative. A real node-redis regression uses an owned loopback RESP peer: it completes
the client handshake, withholds more than 16 mixed reads and writes, verifies only 16 reach
the peer while every caller settles, releases replies in order, and proves a later valid
read succeeds over the same connection. The rate-limiter Redis client and its fail-closed
budgets remain unchanged.

## Mainline s60 integration, 2026-10-06

The cache branch merged `origin/main` at `fb7f41c`, after s60 passed its final review and hosted
checks. This is a mainline synchronization, not a stacked feature: s59, s61 and the customer-site
adapter remain outside this branch.

The combined route keeps s60's exact-count optimization only on normalized page-scoped database
reads. Legacy reads with no `page_path` retain unknown-count empty-page termination, and a warm
cache hit bypasses pagination entirely. Both response paths preserve advisory liveness without
putting its write round trip back in front of the visitor:

- a warm cache hit schedules `recordSiteReport` through its own Next `after()` callback before
  returning the cached public projection; and
- a cache miss schedules the stable-revision cache fill and liveness as two separate `after()`
  callbacks. A delayed or skipped fill cannot suppress the liveness task, and liveness cannot
  delay or write into the cached envelope.

The operator's current median of 826 ms was measured against the old deployed backend. It is a
pre-deployment baseline, not evidence for this combined source and not a reason to weaken the
unchanged 200 ms browser acceptance gate.
