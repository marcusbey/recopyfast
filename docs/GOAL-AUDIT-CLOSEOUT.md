# Goal: Production Audit Closeout — 100%

**Source:** `docs/QA-PRODUCTION-AUDIT-2026-08-07.md` (91 findings / 37 numbered sections + 31 P2/P3 items)
**Baseline measured:** 2026-08-09, six parallel read-only assessment agents, every finding re-verified against HEAD `e94463d` at its cited `file:line`, cross-checked against the 85 `test.failing` markers and `git log`.
**Owner:** rboboe@gmail.com

---

## Definition of done (= 100%)

1. Every T/A finding is **FIXED + verified** or **DECIDED-WONTFIX with owner sign-off** recorded in this file.
2. **`test.failing` marker count = 0.** 84 of the current 85 retire by fixing their defect; the 1 remaining (`FloatingEditorToolbar.viewport.test.tsx:174`) is un-retirable by construction and must be **rewritten**, not deleted (asserts `left >= 0` AND `left + 420 <= 390` — impossible; rewrite when `toolbarWidth` goes responsive).
3. DB-gated suites executed at least once against a scratch Supabase (`supabase start`), and the production-verification checklist (§ M7) completed with the rotated password.
4. `e2e/hero-demo-mobile.spec.ts` executed at least once (never run — CI e2e job self-skips).
5. P2/P3 items each fixed, wontfixed, or re-derived (P2-31).
6. The 5 disproved items stay excluded: WebGL crash on `/`, EditableImage fixed-inset dialog, useContentElements race, STRIPE_CONFIG.PUBLISHABLE_KEY, winston-daily-rotate-file runtime risk (its *dead-weight* removal stays in P2-20).

## Measured baseline (2026-08-09)

| Group | Fixed | Partial | Open | Notes |
|---|---|---|---|---|
| Tier 0 (T-1, T-2) | T-2 (pending env update) | T-1 | — | T-1 money hazard closed; guard script + file deletion left |
| P0 (A-1…A-8) | 0 | 0 | **8** | zero commits touched billing/auth source |
| P1 (A-9…A-35) | A-24, A-27, A-31, A-33, A-34 (+A-32 code-fixed, unverified) | — | 13 | all 5 fixes came from PR #11 |
| P2/P3 (31 items) | P2-16 mostly | 6 partial | ~23 | P2-31 unconfirmed — re-derive before scheduling |

**True completion: ~19% of T/A findings (7 of 37). Earlier "35%" estimate was commit-reference overcount.**

Marker ledger: 85 `test.failing`/`it.failing` call sites across 32 files. Every planned fix below names the markers it flips; the sum is 84 + 1 rewrite.

---

## Dependency spine

```
OWNER ACTIONS ──> new SUPABASE_PASSWORD in .env + CI ──> prod-verify checklist (M7)
             ──> Stripe dashboard: subscribe charge.dispute.closed ──> A-8
             ──> decisions D1–D5 ──> A-5, A-14, A-15, A-25, P2-6

MIGRATION 2 (log_content_change) ──> A-11 deletion reorder
P2-10 (CI redis service) ──> enable e2e job ──> A-32 verification
MIGRATION 3 (version RPCs) must ship A-15+A-16+A-23 together (same two functions)
Webhook branch: A-6/A-7/A-8/A-20/A-22 all edit src/app/api/webhooks/stripe/route.ts + stripe libs — ONE branch
```

### New migrations required (write in this order)

| # | Name (suggested) | Closes | Content |
|---|---|---|---|
| M-1 | `lock_down_definer_functions` | A-3, A-5 | REVOKE ALL from PUBLIC/anon/authenticated on publish_staging_content, revert_staging_content, publish_staging_content_atomic, add_tickets, consume_tickets, get_user_ticket_balance, purge_expired_editor_artifacts, update_site_analytics, update_translation_coverage; keep authenticated on the 3 RLS predicates; `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE FROM anon, authenticated`. Check `src/app/api/staging/**` callers move to service-role first. |
| M-2 | `content_history_definer_and_delete_split` | A-35, A-13, unblocks A-11b | `CREATE OR REPLACE log_content_change()` with SECURITY DEFINER + `SET search_path = public, pg_temp`; split trigger into AFTER INSERT OR UPDATE + BEFORE DELETE. Regression check = remove `session_replication_role` workaround in `db-harness.ts:200-224` + new DB-gated test deleting a site WITH content. |
| M-3 | `version_rpcs_composite_key_and_lock` | A-15, A-16, A-23 | Rewrite create_content_version + restore_content_version in ONE migration: composite snapshot key (element_id‖language‖variant), restore filters on all three, `GET DIAGNOSTICS` row-count return (DROP+recreate → re-apply grants from `20260805190000`), `pg_advisory_xact_lock(hashtextextended(p_site_id::text,0))` before MAX+1. Legacy element_id-keyed snapshots need a fallback branch (D5). |
| M-4 | `consume_credits_rpc` | A-18 | SECURITY DEFINER `consume_credits(...)` with advisory lock per user, oldest-first decrement, ledger insert in same txn; grants scoped per `20260805190000` precedent. |
| M-5 | `checkout_pending_intent` | A-21 | Pending-intent row + partial UNIQUE on user_id where pending (approach (a) — survives the sequential case). |
| M-6 | `sites_created_by_and_last_admin_guard` | A-4 | `sites.created_by` + backfill from earliest site_permissions row; BEFORE DELETE trigger on site_permissions refusing last admin; tighten DELETE policy. Heaviest schema item. |
| M-7 (opt) | `grant_lineage_started_at` | A-28 | Only if the lineage-ceiling design carries a column; else walk `rotated_from`. |

### Owner actions (nothing else unblocks these)

- [ ] **O1**: Put rotated `SUPABASE_PASSWORD` into local `.env` + CI secret (T-2 close; gates A-4 verify + M7 checklist).
- [ ] **O2**: Stripe dashboard → webhook endpoint → subscribe `charge.dispute.closed` (A-8).
- [ ] **O3**: Confirm live Stripe keys in `.env` were rotated or are safe (T-1 residual — unverifiable from repo).
- [ ] **O4**: GitHub Actions secrets `E2E_SUPABASE_URL` (+ friends) against a disposable project, or accept local-only E2E.
- [ ] **O5**: Supabase email template → `{{ .SiteURL }}/auth/confirm?token_hash=…` (carried over from QA-REGISTER).

### Decisions needed (blocker only for their own items)

- [ ] **D1** (A-5): DROP the orphaned wallet functions vs lock to service_role. Recommendation: drop — zero callers, removes replay risk. Check `20260802020000` conversion path first.
- [ ] **D2** (A-14): page-scoped element ids orphan every stored id in production. One-time re-discovery backfill vs accept re-keying on next scan. (Production ≈ empty per register — cheap to decide now.)
- [ ] **D3** (A-25): token rotation — re-mint endpoint the widget calls on `site_token_expired` vs drop age cap + revoke via api_key rotation.
- [ ] **D4** (P2-6): ratify or reverse any-subdomain origin matching in `editor-request.ts:74` (comment claims deliberate).
- [ ] **D5** (A-15): legacy snapshot fallback semantics in restore (apply-to-all-languages vs skip + report).

---

## Phases

Each phase = one branch/PR, review + full gates (`tsc`, lint, jest, build) before merge. Marker deltas are the acceptance evidence.

### Phase 1 — P0 money + data corruption, code-only (no external deps) — ✅ DONE (PR #13, merged 2026-08-09, `5195f73`)

All seven findings closed. Marker count 85 → 57. Six bot-review rounds on the PR
surfaced and closed five additional real defects in/around the new code:
- restore-after-refund: a dispute settled by refunding restored the entitlement
  to a refunded customer (both orderings guarded; refund predicate shared with A-20)
- per-dispute revocation records + floor-based credit restore (replay-safe)
- redelivered `dispute.created` after a win re-revoked permanently; `closed(lost)`
  now applies revocation itself; dispute events enter the webhook seen-list
- one oversized element (base64 `data:` img src) permanently blocked a page's
  whole discovery → per-element skips, reported and capped
- `isLocalhostHost` prefix match handed both dev bypasses to
  `127.0.0.1.attacker.example`; CR/LF element ids were accepted and could forge
  log lines; refused preflights could fall back to a wildcard CORS grant
New follow-ups filed: widget should stop reporting `data:` srcs as content
(cached-widget rollout); staging editor path still sanitizes like pre-A-1
discovery (already Phase 3). Deflaked the slow-Supabase session test.

Original scope (for reference):
| Finding | Fix (short) | Effort | Markers |
|---|---|---|---|
| A-6 | service-role client in update/cancel/reactivateSubscription + keep `.eq(user_id)` predicate; Stripe call after ownership check. Do NOT add authenticated UPDATE policy. | S | 3 |
| A-7 | handleSubscriptionUpdated → upsert onConflict like Created; Deleted → `.select()` + throw on 0 rows | M | 3 |
| A-8 | `charge.dispute.closed` branch + restoreEntitlementForPayment(); credits re-granted as fresh row (monotonicity trigger forbids increase); persist revoked amount (route.ts:752 only logs it). Needs O2. | M | 3 |
| A-20 | full-vs-partial refund check on `amount_refunded`/`refunded`; split the Charge|Dispute union | S | 2 |
| A-22 | `grants_plan_id` into session-level metadata (checkout.ts) + read it at route.ts:723 + catalogue validation in grantLifetime; keep "pro" fallback behind alert for transition window | S | 3 |
| A-1 | discovery: plain-text validator instead of sanitizeIncomingContent; reject-400 over silent truncation; delete the identity-mock hiding it | M | 5 |
| A-2 | origin binding mandatory in authorizeSiteRequest + authorizeSiteOrigin (null origin → reject); keep dev/demo bypass; rate-limit content POST. Sweep first-party non-browser callers first. | M | 5 |

A-6…A-22 all touch `webhooks/stripe/route.ts` + stripe libs → single branch. A-1/A-2 can be a sibling branch same phase.

### Phase 2 — security lockdown migrations + access fixes — flips 12 markers
| Item | Fix | Effort | Markers |
|---|---|---|---|
| M-1 migration | A-3 + A-5 (after D1) | M | 1 (shared) |
| M-2 migration | A-35 + A-13 code side | S | 1 + new DB-gated test |
| A-9 | service-role for site_permissions insert + move pre-checks to same client | S | 3 |
| A-11a | compensating sites delete on permission failure (registration) | S | 2 |
| A-11b | deletion reorder (AFTER M-2 lands) — delete sites first, cascade cleans up | S | 2 |
| A-10 | 15 call-site edits: pass readStagingDeviceFingerprint(request) | M | 2 |
| A-12 | extract resolveUserIdentity → shared module; fix 5 auth.users embeds (audit missed the 5th at members/route.ts:174) + invitations email lookup via auth.admin | M | 2 |

### Phase 3 — versioning + content integrity — flips 13 markers
| Item | Fix | Effort | Markers |
|---|---|---|---|
| M-3 migration | A-15 + A-16 + A-23 in one file (after D5) | L | 4 |
| A-16 caller | surface "matched none" as non-success in history/[versionId] route | S | (in 4) |
| A-15 A/B half | lifecycle.ts language/variant predicates + change_type "update" + check insert error; WRITE the missing promote-winner-scope test | M | 0 (test to add) |
| A-17 | optimistic concurrency on staging PUT: expectedUpdatedAt precondition, 409 + current value, previous_content from guarded update | M | 2 |
| A-26 | parse href/alt extras; scheme allowlist (javascript: = stored-XSS today); persist to metadata JSONB; publish + hydration read-back; include in staging_history | M | 4 |
| A-14 | pathname-prefixed stable ids (after D2) + rebuild embed | M | 3 |

### Phase 4 — billing hardening — flips 7 markers
| Item | Fix | Effort | Markers |
|---|---|---|---|
| M-4 + A-18 | consume_credits RPC; consumeCredits → one rpc(); deterministic refund idempotency key | L | 3 |
| A-19 | startOfCurrentAllowanceWindow(periodStart) month-stepping; include trialing/past_due (adjacent gap) | S | 2 |
| M-5 + A-21 | pending-intent guard, UNIQUE violation → 409 | M | 2 |

### Phase 5 — widget / sessions / infra — flips 16 markers
| Item | Fix | Effort | Markers |
|---|---|---|---|
| A-29 | drop token from editUrl + normalizeDomain at read; token delivered out of band | S | 3 |
| A-30 | checkCache() via real rate-limiter path; cache failure = fatal (503) — roll-up at :227 needs 2+ errors today; HEAD checks both | S | 3 |
| A-25 CORS half | typed auth error carrying reason+origin; withCors on all 3 catch paths; expired vs forged discriminator | M | 6 |
| A-25 rotation | per D3 | L | (in 6) |
| A-28 | re-derive rememberDevice from row; GRANT_LINEAGE_MAX_MS ceiling (M-7 optional); drop rememberDevice from refresh body | M | 4 |
| A-4 + M-6 | created_by backfill + last-admin guard + route check (after O1 for prod verify) | L | 5 |

### Phase 6 — P2/P3 sweep — flips 6 markers
**Cheap first pass (do immediately, any phase):** P2-17 (fold visibility into frameloop expr — best perf-per-line), P2-24 (stop leaking Postgres error text to customers), P2-3 (delete fail-open limiter doing unscoped cross-tenant DELETE per request; repoint v1/content), P2-26 (2 raw timingSafeEqual → existing helper; flips manager.test.ts:431, delete companion enforced test :437).
**Then, S-effort batch:** P2-2, P2-4 (shared Zod parser + unconditional scoping), P2-5 (delete 3 dead security classes), P2-8, P2-9, P2-14, P2-15, P2-18 (currentScript guard + singleton), P2-21, P2-22 (HSTS + single header source), P2-23, P2-25, P2-27.
**M-effort batch:** P2-1 (7 routes → withPublicCors), P2-7 (A/B cron — or kill per A/B scope cut), P2-11, P2-12, P2-13 (first half; second half FALSE — correct the audit doc: tracker IS instantiated), P2-19 (re-measure target rect + listen on real scroll container), P2-20 (6 deps → devDeps/server), P2-28, P2-29 (isConnected sweep + per-element delete), P2-30.
**Re-derive:** P2-31 (cited innerHTML sites don't exist as filed).
**UI markers:** button.test.tsx:149+:250 (Radix Slot/Fragment root cause, both flip together), TranslationDashboard.test.tsx:475+:487 (label/name a11y), SiteRegistrationModal.test.tsx:822 (validate trimmed domain), A-33 residual (responsive toolbarWidth at InteractiveHero.tsx:216 + rewrite the un-retirable marker).

### Phase 7 — verification closeout (gates 100%)
1. **P2-10 first**: redis:7 service container + REDIS_URL in ci.yml, then O4 secrets, then un-skip e2e job. (Sequence matters: enabling E2E without redis turns CI red.)
2. Run `e2e/hero-demo-mobile.spec.ts` (closes A-32) + `RUN_RECOPYFAST_CORE_E2E=1` core suite.
3. `supabase start` + run all DB-gated suites (unify env-var convention: RCF_TEST_DB_URL vs SUPABASE_TEST_DB_URL — pick db-harness.ts's).
4. Production verification (needs O1): `20260731008000` applied? (A-9 branch question) · A-3 grants live? · A-13 trigger firing? · A-4 policy state.
5. Marker count: `grep -rE "^\s*(test|it)\.failing\(" src/ e2e/` → **0**.
6. Update audit doc + QA-REGISTER with final status; delete this file's checklist or mark 100%.

---

## Effort roll-up

- **S:** 16 findings + ~14 P2 items — mostly 1-file changes
- **M:** 14 findings + ~10 P2 items
- **L:** A-4, A-15(+M-3), A-18, A-25-rotation
- **7 new migrations**, 5 owner actions, 5 decisions

Suggested cadence: Phases 1–2 first (all P0 + the two security migrations — biggest risk retired, 36 markers), then 3–5 in parallel branches, 6 as filler, 7 last.

## Errata to carry back into the audit doc

- A-31 is FIXED (audit still lists open).
- P2-13 second half is FALSE — `analytics` singleton IS instantiated (tracker.ts:579).
- P2-31 citations don't resolve — re-derive.
- A-12 is worse than filed: 5 auth.users embeds (audit counted 4); cited test path is members-embed.test.ts.
- A-1 marker count is 5 (audit brief said 3; two are `.each` blocks).
- Hero-demo line cites are stale post-squash (PR #11); BrowserWindow.tsx moved to landing/demo/.
- `git merge-base --is-ancestor` misleads on hero fixes — content merged via squash 7c02029.
