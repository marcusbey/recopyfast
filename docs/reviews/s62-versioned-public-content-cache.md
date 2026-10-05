# Review — Story s62-versioned-public-content-cache

> Fresh-context review of `git diff main...feature/s62-versioned-public-content-cache`.
> Pinned commit: `b552bf3ccdb0bf613ff1a1b26038d2b3c0191895`.
> Pinned tree: `0b0e356f4cb8ab65635377aace995a866fd4825f`.
> Base: `main` at `9aa492d5afee05268e24440dc679d20214840bc9`.
> Judged against the validated plan, research, accepted ADR 045, `AGENTS.md` and prior accepted
> security/data decisions. The generated local `AGENTS.md` change is unstaged and excluded.

## Summary

The transactional revision and cache-addressing design is implemented correctly. Fresh widget
authorization precedes every cache read, revoked credentials cannot reach a warm entry, the cached
shape matches the existing public response, and a revision change makes every older key
unaddressable. The migration covers statement-level insert, update, delete and truncate, preserves
rollback coherence and keeps the revision outside web-role column access.

The first review at `f4fb1e4` found one major Redis lifecycle defect: caller timeouts left commands
on an unlimited ready-socket queue. The final `b552bf3` tree caps that private node-redis queue at
16 and proves bounded fail-open behavior plus same-connection recovery against an owned RESP peer.
The finding is resolved. I found no remaining critical, major or minor source issue.

## Plan compliance and verified behavior

- [x] **Fresh authorization before cache.** The IP limiter runs first. Only the widget branch asks
  `authorizeSiteRequest` for `public_content_revision`; only its validated UUID can construct a
  cache identity. Invalid/revoked token and denied-origin paths return before cache access.
  Dashboard-cookie reads remain on the uncached database path.
- [x] **Current CORS and liveness remain per request.** A hit serializes a newly validated body
  with the request's current allowed origin, then performs the existing best-effort liveness write.
  No cached header, CORS decision, credential or grant is stored.
- [x] **Public projection and exact scope are preserved.** The cache accepts only the selected
  public fields, rebuilds a whitelist, rejects private fields and `metadata.staging_attributes`,
  and matches site/language/variant. Legacy `pagePath=null` permits the existing all-site rows;
  scoped `P` permits only `P` plus shared NULL rows. Null and `/` hash to different keys.
- [x] **Payload bounds precede decode.** `GETRANGE 0..MAX` retrieves at most MAX+1 bytes as a
  Buffer. Oversize is rejected before `JSON.parse`; writes over 1 MiB skip cache without changing
  the database response. TTL is 300 seconds.
- [x] **Ready-socket failure is bounded.** The private client sets
  `commandsQueueMaxLength:16` in addition to disabling offline queuing and reconnect. Excess work
  rejects through the existing redacted fail-open path, so a stalled peer cannot retain one
  command per request without bound. The rate-limiter client remains separate and unchanged.
- [x] **Transactional invalidation.** The forward migration adds a non-null UUID revision, locks
  affected existing sites with `SELECT ... ORDER BY id FOR UPDATE`, then rotates once per event.
  Separate AFTER STATEMENT transition-table triggers cover INSERT, UPDATE and DELETE; TRUNCATE
  rotates every remaining site. UPDATE includes OLD and NEW site ids and deliberately invalidates
  draft/no-op writes.
- [x] **Database privilege boundary.** All five functions are SECURITY INVOKER with fixed
  `public, pg_temp` search paths. PUBLIC/anon/authenticated execution is denied; service_role is
  explicit. The revision has no effective web-role SELECT and remains readable to service_role.
  Existing RLS, history triggers and content-write grants are unchanged.
- [x] **Rollback, cascade and concurrency behavior.** Real PostgreSQL verifies rollback restores
  the revision, site deletion cascades, TRUNCATE, upsert, moves, empty statements, multi-row
  once-per-event rotation, opposite-order two-site contention and concurrent liveness updates.
  ADR 045 correctly avoids claiming arbitrary multi-statement deadlock freedom.
- [x] **Raced fills are not addressable.** A miss returns the existing database result. Next
  `after()` rereads the revision and stores only when it still equals the authorization revision.
  A mutation after that reread can at worst produce an old-generation key; fresh authorization
  obtains the new revision and cannot address it. The response itself is not mislabeled as an
  atomic paginated snapshot.
- [x] **Schema activation is fail-closed and default-off.** Only exact lowercase
  `PUBLIC_CONTENT_CACHE_ENABLED=true` requests the new auth projection or Redis. Disabled mode
  retains the old projection and works before migration. ADR 045 records migration-first enable
  and flag-first rollback procedures.
- [x] **No unrelated product or dependency change.** Manifests, lockfiles, widget source,
  generated embeds, server runtime and AGENTS are byte-identical to main in the story diff.

## Anti-hallucination and mutation proof

- [x] **Imports and APIs exist.** Next 16 exports `after`; installed node-redis 5.8.1 provides
  Buffer type mapping, `getRange`, `disableOfflineQueue`, `reconnectStrategy:false`, `destroy`,
  and `commandsQueueMaxLength`. The production Redis round trip verifies the actual SET,
  GETRANGE, TTL and expiry option shapes.
- [x] **Auth-before-hit assertion bites.** In an isolated archive I inserted cache access into the
  authorization-refusal branch. The route suite went **1 red / 45 green**, specifically the
  revoked-token cache-access assertion.
- [x] **Revision reread assertion bites.** Removing the revision-mismatch return made the route
  suite **1 red / 45 green** because a delayed old fill was written.
- [x] **Database invalidation assertions bite.** Removing the UPDATE revision trigger in an
  isolated archive made the real PG14 gate **4 red / 23 green / 1 inherited skip**, covering
  conservative update, move/upsert behavior and liveness serialization.
- [x] **The ready-socket queue cap bites.** Removing only `commandsQueueMaxLength` made the owned
  RESP-peer suite **1 red / 1 green**: all 40 mixed data commands reached the peer instead of the
  required 16. With the cap present, all callers settle inside their read/write budgets, ordered
  replies drain and a later valid read succeeds on the same single connection.
- [x] Every mutation ran outside the worktree and was discarded automatically. The pinned source
  remained clean apart from the pre-existing unstaged generated `AGENTS.md` block.

## Tests and static gates

Reviewer-run evidence with Node 24.14.0 and `/tmp/s59-ci-env.sh`:

- Final focused cache and route runs: **69 tests passed**, including the real Redis and stalled
  ready-peer cases.
- Final full Jest: **312 suites and 4,047 tests passed**; 2 suites / 38 tests skipped.
- Disposable PostgreSQL 14 full-migration replay, retry and real invariants: **27 passed**, one
  inherited gated skip. The runner reapplied both security migrations successfully.
- Lint: 0 errors / 35 inherited warnings. `type-check`, `type-check:build` and `format:check`
  passed.
- Production Next 16.3.5 build passed under inert external-service values.
- Embed freshness passed unchanged: 45,880-byte bundle, 33,120-byte widget and 13,141-byte
  transport gzip.

## Resolved review finding

### Ready-socket command queue

Initial finding: `f4fb1e4`, major. Resolved by: `b552bf3`.

`withTimeout` uses `Promise.race`. Once node-redis has written GETRANGE or SET to a ready socket,
settling the timeout promise does not remove that command from RESP's ordered waiting-for-reply
queue. `disableOfflineQueue` does not cover that state. The fix adds the explicit 16-command cap
supported by installed node-redis; its queue counts both waiting-to-write and waiting-for-reply
commands. The real peer regression completes the actual node-redis handshake, withholds replies to
40 mixed GETRANGE/SET attempts, observes exactly 16 accepted data commands, then releases responses
in order and verifies a subsequent read over the original connection. The repair is confined to
the optional content-cache client and preserves both programmed budgets and identity-safe cleanup.

## Release dependencies and unverified surfaces

- The local Playwright run reported 15 passes, 4 pricing failures and 25 skips because the
  workstation lacks the seeded plan catalogue. Hosted CI subsequently passed its seeded E2E job on
  the `f4fb1e4` precursor. The final `b552bf3` SHA still needs its own hosted check after push; no
  production-browser or speed success is inferred from either run.
- Current branch audits independently reproduce the inherited baseline: root has 1 critical,
  2 high, 2 moderate and 1 low advisory; server has 1 high and 1 low. These are not introduced by
  s62. [PR #60](https://github.com/marcusbey/recopyfast/pull/60) is open, merge-clean and currently
  green across its hosted checks, but remains unmerged.
- No production migration, cache activation, Redis/Supabase TLS measurement, merge or deployment
  ran. The 20-pair 100-row measurement is valid loopback functional evidence only; it does not
  prove production/browser latency or s61's 200 ms outcome.
- s59 guide integration, s60/s61 reconciliation, the companion aicompoz head adapter and at least
  19/20 representative cold homepage visits within the unchanged hold remain separate release
  gates. A successful 200 ms authored fallback is not counted as performance success.

Max severity: none
Ship allowed: yes
