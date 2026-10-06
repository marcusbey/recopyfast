# Review — Story s62-versioned-public-content-cache

> Fresh-context review of `git diff origin/main...feature/s62-versioned-public-content-cache`.
> Pinned commit: `be0e09f3b7c2e5ac30dddacaa024012532c9b65a`.
> Pinned tree: `059796a64206563affbab2546af42aa02a95391d`.
> Base: `origin/main` at `fb7f41ca09437dce1bac41398cc58399203584b5`.
> Judged against the validated plan, research, ADR 045, `AGENTS.md`, the prior cache review,
> the final s60 review and the accepted tenant/security decisions.

## Verdict

The final integrated source is coherent. Fresh widget authorization and revision lookup precede
every cache read; revoked credentials and denied origins cannot reach a warm entry. Cached values
contain only the existing public projection, and a transactional UUID revision makes every old
generation unaddressable after content mutation.

The merge with shipped s60 preserves page-scoped exact-count pagination and its permanent invalid-
count fallback. Warm cache hits defer advisory liveness before returning. Database misses defer
cache fill and liveness as two independent Next `after()` tasks, so neither post-response operation
delays or suppresses the other.

The s62 cache module, authorization extension, migration and database proofs remain byte-identical
to the previously reviewed `5604c13` source. I found no remaining critical, major or minor issue.

## Final integration behavior

- [x] **Warm hit.** After current authorization, identity validation and page normalization, a
  cache hit returns the validated public rows with the request's current CORS decision. It schedules
  exactly one deferred liveness task and performs no content query or cache write.
- [x] **Miss.** A miss uses s60's current pagination/projection, returns that database result, then
  schedules a stable-revision cache fill and liveness as separate callbacks. A delayed, skipped or
  failed fill cannot suppress visitor liveness; liveness cannot enter the cached envelope.
- [x] **Current exact counts.** Only a normalized page-scoped database read requests exact counts.
  Every reliable later count replaces the earlier target; once a count is absent or invalid, that
  scope permanently returns to empty-page termination. Legacy no-path reads remain unknown-count.
- [x] **Fresh authority.** The IP limiter and existing site-token/domain authorization run before
  cache access. Only the widget branch requests `public_content_revision`; dashboard-cookie reads
  remain on the uncached database path.
- [x] **Default-off activation.** Only exact lowercase
  `PUBLIC_CONTENT_CACHE_ENABLED=true` expands the auth projection and enables Redis. Disabled mode
  retains the pre-migration projection and direct database path.

## Cache and privacy contract

- Keys hash `[format, siteId, revision, language, variant, pagePath]`; null legacy scope and `/`
  remain distinct.
- Read envelopes must match that full identity and contain only whitelisted public rows. Private
  fields and `metadata.staging_attributes` are rejected before returning data.
- `GETRANGE 0..MAX` bounds bytes before decode. Payloads over 1 MiB, malformed entries, missing
  Redis, connection/read timeouts and all client errors degrade to a database miss.
- The visitor read/connect budget is 30 ms. Deferred connect/write has its own 250 ms budget and
  never joins the response path. Entries expire after 300 seconds.
- The private node-redis client disables offline queuing and reconnect and caps the ready-socket
  command queue at 16. Excess work rejects through the redacted fail-open cache path; the separate
  fail-closed rate-limiter client is unchanged.
- A miss fills only after rereading the server-owned revision and confirming it still equals the
  authorization revision. A later mutation can produce only an old-generation key that fresh
  authorization cannot address.

## Migration and database boundary

- The forward migration adds a non-null UUID revision to `sites`, explicitly outside web-role
  column access.
- SECURITY INVOKER functions with fixed `public, pg_temp` search paths lock affected site rows in
  UUID order and rotate once per statement event.
- Separate AFTER STATEMENT INSERT, UPDATE, DELETE and TRUNCATE triggers cover all content DML.
  UPDATE includes OLD and NEW sites and deliberately invalidates draft/no-op changes.
- PUBLIC, anon and authenticated cannot execute the revision functions or read/write the revision;
  service_role retains the explicit required access. Existing RLS, history and content grants are
  unchanged.
- Real PostgreSQL coverage proves rollback coherence, cascade cleanup, TRUNCATE, upsert, row moves,
  empty writes, once-per-event rotation, opposite-order two-site contention and concurrent
  liveness updates. The design does not claim arbitrary multi-statement deadlock freedom.

## Anti-hallucination and mutation proof

- Installed Next 16.3.8 exports the used `after` callback API. Installed node-redis provides Buffer
  mapping, `getRange`, `disableOfflineQueue`, `reconnectStrategy:false`, `destroy` and
  `commandsQueueMaxLength` with the used shapes.
- Removing warm-hit liveness made the final route suite **1 red / 49 green**.
- Suppressing miss-path liveness left one callback instead of two; the isolated integration
  assertion went **1 red / 49 skipped**.
- Prior core review mutations remain applicable because those files are byte-identical: accessing
  cache before authorization, removing the revision mismatch guard, removing the UPDATE revision
  trigger and removing the Redis queue cap each made their dedicated security/regression proof red.
- All new mutations ran in disposable archives. The active worktree remained source-clean apart
  from the generated `AGENTS.md` delta, which is excluded from the story diff.

## Independent verification

Fresh reviewer checks used Node 24.14.0:

- Final route, exact-count helper, cache, real Redis, auth and source-projection set:
  **6 suites / 153 tests passed**.
- Changed-file ESLint, full TypeScript and configured format checks passed.
- Root and server production audits both exited 0 with zero vulnerabilities.
- Embed freshness and fixed ceilings passed unchanged: 45,880-byte bundle, 33,120-byte widget and
  13,141-byte transport gzip.
- The frozen implementation's normal final gates additionally recorded the full **4,075 tests
  passed / 38 skipped**, production build, coverage, both typechecks and lint/format green.
- Disposable PostgreSQL 14 full-ledger proof passed **27 assertions / 1 inherited gated skip**;
  the owned Redis proof covered SET, GETRANGE, TTL, expiry, stalled ready-peer queue bounding and
  same-connection recovery.
- `git diff --check` is clean.

## Production migration checkpoint

The operator separately reports that the exact reviewed
`20261005000000_versioned_public_content_cache.sql` migration was applied transactionally before
application activation: production ledger 69, four triggers present, function/column roles and
grants correct, and non-null revisions on all seven existing sites. The cache flag remains OFF.

This is deployment evidence supplied by the rollout owner, not a migration action performed by the
reviewer. I did not reapply or modify the production database. The remaining safe order is deploy
the reviewed backend, verify disabled-mode health, then enable the flag and redeploy under the
root-owned production readout plan.

## Findings

None.

## Release boundaries and unverified surfaces

- Hosted final-SHA CI remains a hard merge gate. This report does not turn a pending or failed
  check green.
- No merge, deployment, cache activation, production Redis command or customer content mutation
  ran in this review.
- The local matched benchmark and cache tests establish behavior, not hosted Supabase/Redis TLS
  latency or the stable-copy 200 ms outcome.
- Backend/cache rollout may proceed under the user's staged authorization after CI, but it does not
  prove first-visible published copy. PR59/PR31 and the permanent-URL plus untouched-production
  19-of-20 measurements remain separate gates; authored fallback is not counted as speed success.
- After activation, root must verify exact deployment identity, cold miss/deferred fill, warm hit,
  fresh-token refusal before cache, database fallback, revision rotation and redacted failure logs.
- Registry advisory state can change without a source commit. Merge and deployment must use current
  audit results rather than treating this review as a permanent waiver.

Max severity: none
Ship allowed: yes
