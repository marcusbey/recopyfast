---
validated: yes
validated_by: user scope and operator pre-validation, 2026-09-25
---

# Plan — s34-checkout-hardening

Branch feature/s34-checkout-hardening at c3b2b28. No live Stripe, production database, remote migration, merge, ready marking or deployment. Use mocked Stripe and exact CI placeholders. No new dependencies. Design unchanged; use existing billing page/checkout flow.

## Decisions

Choose **cancel before replacement** for incomplete/unpaid/paused subscriptions. They do not confer entitlement, but may recover into a second obligation. Confirm every owned recoverable subscription is terminal at Stripe before a new Checkout can be created; on cancellation ambiguity, re-read and accept only canceled/incomplete_expired. Provider/read/write failures fail closed. Never reinterpret an active/trialing/past_due provider result as safe to replace. Persist confirmed cancellation with user and provider-id scoping; preserve the durable-intent, cross-isolate claim and trial-conversion guards. Portal-only recovery is rejected because paused/incomplete recovery depends on provider product configuration and the user explicitly permits cancellation. Do not change LIVE_SUBSCRIPTION_STATUSES; create a separate checkout blocking status contract. The claim RPC must refuse recoverable DB rows as a final transactional guard, including when a pending intent exists.

Founding: use ten-minute grace after stored session expires_at, plus a five-minute lower-bound clock-skew allowance for Stripe history. Catch provider-specific per-row failures, continue processing other rows, retain unresolved rows within grace, and atomically release/flag overdue unresolved holds using a service-only RPC and the same capacity lock. Persist reconciliation timestamp/reason (bounded reason codes) and sanitized warning; keep historical flag even after late payment. Database failures remain fail-closed. Known paid/completed sessions are not released as unresolved. Completion accepts a released hold and grants atomically/idempotently without a capacity recheck: ordinary claims cannot exceed 50 committed+held slots, but an already-paid late completion can yield 51 (or multiple delayed paid exceptions); customers are never refused. Preserve refund/account deletion durability.

## Tasks

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


## Final local gates — 2026-09-25

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
