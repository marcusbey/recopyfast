---
validated: yes
validated_by: user scope and operator pre-validation, 2026-09-25
---

# Plan — s34-checkout-hardening

Branch feature/s34-checkout-hardening at c3b2b28. No live Stripe, production database, remote migration, merge, ready marking or deployment. Use mocked Stripe and exact CI placeholders. No new dependencies. Design unchanged; use existing billing page/checkout flow.

## Decisions

Operator fix-mode decision (2026-09-25) supersedes the initial cancellation policy: NEVER cancel an existing subscription from checkout. For incomplete/past_due/unpaid/paused retrieve authoritative Stripe subscription and latest invoice payments. Processing returns 409 with the approved processing message; other incomplete/past_due/unpaid states return 409 plus hosted invoice resumeUrl, paused uses configured billing portal or clear recovery message. Recovered active/trialing returns the normal 409 upgrade message. Preserve transactional nonterminal claim guards and prevent replacement subscriptions. UI follows resumeUrl.

Founding: use ten-minute grace after stored session expires_at, plus a five-minute lower-bound clock-skew allowance for Stripe history. Catch provider-specific per-row failures, continue processing other rows, retain unresolved rows within grace, and atomically release/flag overdue unresolved holds using a service-only RPC and the same capacity lock. Persist reconciliation timestamp/reason (bounded reason codes) and sanitized warning; keep historical flag even after late payment. Database failures remain fail-closed. Known paid/completed sessions are not released as unresolved. Completion accepts a released hold and grants atomically/idempotently without a capacity recheck: ordinary claims cannot exceed 50 committed+held slots, but an already-paid late completion can yield 51 (or multiple delayed paid exceptions); customers are never refused. Preserve refund/account deletion durability.

## Initial implementation tasks (historical; fix-mode decisions below supersede T3/T4)

- [x] T1 Add red regressions for per-row unresolved recovery, expiry+grace boundary, missing session/API failure/skew, continued healthy claims and history bound. Add DB tests for timed release, operator flags, one active hold, capacity races and late paid completion/idempotency. Preserve all guards; no scoped failing markers currently exist.
- [x] T2 Add idempotent migration `20260925100000_checkout_hardening.sql`: reconciliation fields/RPC, released-to-completed grant, and nonterminal subscription claim guard (all overloads). Explicit REVOKE PUBLIC/anon/authenticated and GRANT service_role per 20260805190000. Never edit old migrations. Implement reconciliation changes and late-webhook coverage.
- [x] T3 Add IP-before-auth and user-before-provider tests; enforce independent checkout-specific buckets with existing enforceRateLimit and onStoreFailure deny. Suggested explicit presets: IP 20/15min, user 5/15min. Keep rate-limit Retry-After responses and one active founding hold. Update only test mocks required by new dependency.
- [x] T4 Test-first terminal cancellation/replacement for incomplete/unpaid/paused, all owned obligations, failures, provider recovery to active, cross-request concurrency and no create until cancellation is confirmed and durable. Add a focused stripe helper rather than broaden cancelSubscription's existing user contract. Reuse current Stripe/client patterns, no new provider library. Update the three old allow-new tests to the explicitly approved cancel-first behavior and explain the change in PR. Database claim rejects all recoverable states transactionally, including existing pending intents.
- [x] T5 Add mutation-sensitive DB positive-price guard test (active zero-price row in transaction), call isAgencyCheckoutEnabled from billing page with a helper-sensitive test, fix webhook comment, and write ADR 031 plus errata for ADRs 028/029/019 and the historical unpublished-wrapper comment. Document operator query and rollout/rollback without executing production operations.
- [x] T6 Run focused tests, disposable loopback DB tests and migration reapply/ACL checks, then final gates once: npm run precommit (single Jest worker), npm run build, node scripts/build-embed.mjs --check, npm run audit:prod, type-check:build and format:check. Record counts and gaps; rerun load-only failures without weakening assertions/timeouts. Review file contains only pending independent review.

Leader owns docs, integration, gates, commit/push/draft PR. Executor owns code/test/migration implementation and task checkboxes; no independent review verdict. No code commit until final gates are recorded. User explicitly authorizes a draft PR before the separate review; ordinary ks-ship review gate is superseded only for this draft handoff.

## Verification evidence

- Root + server `npm run setup` succeeded. No worktree `.env` was copied or created; only the committed `.env.example` is present.
- Baseline `npm run lint`: 0 errors, 39 inherited warnings.
- Disposable PostgreSQL 14.17 on `127.0.0.1:55434`, fresh cluster and database, minimal auth-role shim: 59 baseline migrations applied in order; 15/15 founding DB tests passed before new tests. Storage migration self-skipped because vanilla PostgreSQL has no Supabase Storage schema; this is not full Supabase/PostgREST evidence.
- New DB suite failed against the baseline's missing s34 RPC (red), then passed 20/20 after `20260925100000_checkout_hardening.sql`; reapplication was idempotent. All four added/replaced RPCs permit only owner/service_role; reconciliation columns are not readable by anon/authenticated.
- Removing the founding capacity lock made the concurrency barrier fail; restoring it passed. Removing `plan.price_monthly > 0` allowed the zero-price claim and made the new guard fail; restoring it passed.
- A rollback-only SQL probe confirmed the late paid grant creates exactly one Agency entitlement, replay returns duplicate, and reconciliation flag/reason survive completion; no probe rows persisted.
- Helper-sensitive billing page regression failed with direct environment access and passed after shared-guard use: 1/1. The async section remains private; no invalid page-module export was added.

Final gate evidence is recorded below; the handoff is a draft PR with independent review pending.

Validation environment incident: the first full precommit run passed lint/typecheck, but a
Colima SSH-forwarded local PostgreSQL listener appeared on the shared default port 54322
after the initial no-listener check. An unrelated `function-grants` test reached that local
schema and reported `update_translation_coverage(uuid) -> authenticated` (also recorded in
the s33 review). The run was stopped. The listener was identified from its local process
as Colima, left untouched, and the full gate was restarted under a verified macOS sandbox
policy denying outbound TCP to port 54322. That preserves the ordinary CI-without-database
gating without modifying, skipping or weakening tests. s34 SQL proof remains the separate
owned port-55434 database validation above, whose cluster has been stopped. No production
credentials or remote database endpoint were used.


## Initial implementation local gates — 2026-09-25 (before fix mode)

Node 24.14.0. The temporary command runner clears inherited provider/deployment variables
and reads the exact main CI job placeholder environment from `.github/workflows/ci.yml`.
The final precommit run additionally uses
`/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network-outbound (remote tcp "*:54322"))'`
to isolate the shared default database port. No tests, retry counts or timeouts were weakened.

| Command | Result |
| --- | --- |
| `npm run precommit -- -- --runInBand` | Exit 0; lint 0 errors / 39 inherited warnings; full typecheck passed; 235 suites passed / 2 inherited skipped, 3,106 tests passed / 38 inherited skipped / 0 failed, Jest 369.576s. DB-gated assertions in this no-database run are not counted as SQL proof. |
| `npm run build` | Exit 0; optimized production build, TypeScript and prerendering passed with CI placeholders. |
| `npm run type-check:build` | Exit 0. |
| `npm run format:check` | Exit 0; all matched source files conform. |
| `node scripts/build-embed.mjs --check` | Fresh artifact; gzip bundle 46,601 <= 46,681 B, widget 33,837 <= 33,865 B, transport 13,141 B. Build leaves the embed diff empty. |
| `npm run audit:prod` | Exit 0; 0 vulnerabilities. |
| `npm test -- --runInBand src/__tests__/api/billing/checkout-concurrency.test.ts src/__tests__/lib/stripe/subscription-checkout-recovery.test.ts src/__tests__/lib/billing/founding-agency.test.ts src/__tests__/api/billing/lifetime-grant-plan.test.ts` | 4 suites / 89 tests passed. |
| `npm test -- --runInBand src/app/dashboard/billing/__tests__/page.test.tsx` | 1 suite / 1 test passed. |
| `RCF_TEST_DB_URL=postgresql://postgres@127.0.0.1:55434/recopyfast_s34 npm test -- --runInBand src/__tests__/db/founding-agency-cap.test.ts` | Final frozen file: 1 suite / 20 tests passed, including actual late Agency grant and retained reconciliation flag. Dedicated cluster stopped; no listener remains on 55434. |
| `git diff --check` | Clean. |

No scoped failing markers existed; none were flipped or removed. The parameterized
`allows a new checkout for a %s row that does not grant entitlement` test now requires
cancel-before-create for the same incomplete/paused/unpaid cases. The founding no-session
release case is split into grace retention and flagged post-grace release. Other guards remain.

Only migration `20260925100000_checkout_hardening.sql` is new; old migrations and ADRs are
unchanged. Independent review, operator migration and any release remain outstanding. Local
mocked/provider-state and vanilla PostgreSQL evidence do not establish live Stripe delivery.
Required gates were run explicitly; redundant shared git-hook reruns are suppressed per command
at commit/push to honor the requested heavy-load policy, without changing the hooks themselves.

## Operator-prevalidated fix-mode tasks — 2026-09-25

The user explicitly validated these decisions; existing T1–T6 evidence above is historical. Review file is externally owned: leave it byte-identical and uncommitted.

- [x] F1 M1/m5: replace checkout cancellation with invoice/portal recovery, test processing across recoverable statuses and recovered-active 409, remove unused cancel helper/tests, update ADR 031 and migration-comment erratum without editing prior migrations.
- [x] F2 m2: atomically enforce one founding lifetime per account, return duplicate-account outcome without cap increment/grant, refund duplicate Stripe payment idempotently per session with safe retry semantics, log; new idempotent migration in assigned 20260925100000–199999 range, DB and webhook regressions.
- [x] F3 m3: separate new-session buckets (10/user/15min); confirmed existing open-session resumes consume no session quota; an unattached intent alone does not bypass admission. Only FOUNDING holds deny Redis store failure, ordinary subscription/credit checkout allow with logging; UI formats 429 retry time as Try again at HH:MM. Preserve before-auth flood protection with an independent bucket. Founding admission precedes any new hold, and quota rejection never invokes the expired-only subscription cleanup RPC on a fresh intent.
- [x] F4 m1/m4: handle checkout.session.async_payment_failed to release founding hold; document operator endpoint subscription, resetAllMocks hygiene, valid expiry fixture.
- [x] F5: targeted red→green proof, disposable DB migration/reapply/ACL checks, independent read-only review, final precommit/build/official-Node20 embed/audit gates; commit fix(s34), push existing draft PR #32, no merge/deploy.

## Resumed fix-mode verification — 2026-09-25

- `origin/main` was refreshed and remains `c3b2b28`, the story's merge base. No integration merge was needed.
- The externally owned review remains unmodified and unstaged; its SHA-256 is `b9f6ae16be9b11cf9f3675938ce9f6c9cf8aacbb2f6e073dafc1892f9f7a13a1`.
- Checkout/UI TDD: the new expectations initially produced 52 failures; a terminal-state follow-up produced one additional red regression. Final focused checkout, subscription recovery and checkout-hook suites pass 88/88; three related trial/subscription regressions pass 16/16.
- Independent checkout verification reran the 88 tests. Neutralizing the processing-payment predicate caused four failures; restoring the exact file bytes passed all 17 recovery tests.
- A dedicated PostgreSQL 14 instance at loopback port 55435 received all 60 baseline migrations through `20260925100000`. Vanilla PostgreSQL uses minimal local auth shims; this is SQL evidence, not Supabase/PostgREST or live provider evidence.
- `npm audit --omit=dev` reports zero vulnerabilities. The official Node 20.15.1 embed check passes with bundle 46,601 / 46,681 B, widget 33,837 / 33,865 B and transport 13,141 B; no package or embed changes are part of this fix.

- Founding/webhook TDD produced six focused JS failures before implementation; the baseline SQL run failed against the missing forward RPCs. Final focused JS verification passes four suites / 124 tests. The new migration applied and reapplied successfully, and the founding DB suite passes 23/23.
- Independent direct SQL inspection confirms all nine founding function signatures are SECURITY DEFINER with a fixed search path, deny EXECUTE to anon/authenticated, and grant it to service_role. The unused two-argument subscription claim overload is absent. Existing migrations remain byte-identical.
- Integration hardening: admission no longer treats an unattached intent as proof of a resumable session; fresh quota-denied subscription intents are retained instead of sent to the expired-only cleanup RPC. Founding checks and recovers provider-confirmed open sessions before quota and hold creation. Duplicate refunds use the exact verified Checkout Session, survive lost bind/write acknowledgements, reuse pending refunds, and persist confirmed success.

Final application gates and independent review results follow.

The first full Jest invocation passed 3,143 tests but its temporary runner incorrectly set
`RCF_TEST_DB_URL` to a closed loopback port. Three unrelated suites interpret any explicit URL
as an instruction to run database assertions and failed with connection refused. The runner
was corrected to leave that variable absent, matching the main CI job. The sandbox still denies
the unrelated shared port 54322; the owned port-55435 founding proof is separate. Jest was rerun
without changing tests, assertions, retry settings or timeouts. The four preceding application
gates had already passed and were not repeated.

### Final resumed gates

All commands use Node 20.15.1 and the exact main CI placeholder environment. No real provider
credentials, remote database URL or deployment configuration enter the runner.

| Gate | Result |
| --- | --- |
| `npm run lint` | Passed; 0 errors, 39 inherited warnings. |
| `npm run type-check` | Passed. |
| `npm run type-check:build` | Passed. |
| `npm run format:check` | Passed across all source files. |
| `npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB --coverage` | Passed; 235 suites, 3,143 tests; 2 suites / 38 tests skipped by existing gates. No failures. Coverage: 55.92% statements, 49.99% branches, 51.63% functions, 56.45% lines; all ratchets passed. |
| `npm run build` | Passed; optimized production build, TypeScript and prerendering; embed diff remains empty. |
| `~/.asdf/installs/nodejs/20.15.1/bin/node scripts/build-embed.mjs --check` | Passed; fresh, bundle 46,601 / 46,681 B and widget 33,837 / 33,865 B. |
| `npm audit --omit=dev` | Passed; zero vulnerabilities. |
| Dedicated founding PostgreSQL suite | 23/23 passed, independently repeated by the reviewer. |
| Forward migration apply/reapply and ACL inspection | Passed; nine founding function signatures are service-only; legacy two-argument claim removed. |
| `git diff --check` | Passed. |

The main CI-style suite deliberately does not claim its database-gated skips as SQL evidence;
the owned PostgreSQL run above supplies that evidence for this story. Stripe, Redis outage
behavior and redirects are covered with mocks; real provider delivery and a rendered browser
checkout are not claimed. Supabase/PostgREST and production remain untested and untouched.

Independent fix review: **APPROVE**, max severity **none**, zero open findings. The reviewer
independently ran 88 checkout/UI tests, 42 founding/webhook tests and all 23 SQL tests, checked
all 12 changed TypeScript files with zero diagnostics, and verified the processing guard's four
mutation failures and exact restoration. Its one stale research sentence was corrected before
commit. The externally owned verdict was neither rewritten nor staged.

Delivery is one `fix(s34)` commit to the existing feature branch and draft PR #32. A second
fetch confirmed main is still `c3b2b28`. Explicit gates above replace redundant hook reruns for
this commit/push only, as in the original plan; hook files and all test/coverage thresholds are
unchanged. The disposable cluster was stopped/deleted, and `.next` plus coverage were removed.
The operator still owns migration application, the live endpoint event subscription and any
merge/release.
