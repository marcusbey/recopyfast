# RecopyFast QA Register

> ## ✅ SCHEMA REPAIRED 2026-08-17 — 57 tables, all with RLS. Ledger 43 of 44.
>
> `20260818000000_repair_aborted_migrations` is **applied to production** and merged to `main`.
> Re-probe any time with `node scripts/check-schema.mjs`.
>
> ```
> before:  39 tables, 18 absent, ledger 32/43
> after:   57 tables,  0 absent, ledger 43/44 — every table RLS on, ≥1 policy
> ```
>
> 57 is exactly the count `architecture.md` always claimed and never had. Production smoke-tested
> after: `/api/health` database and storage `ok`; `/`, `/api/pricing`, `/blog`, `/demo` all 200.
>
> **A SIXTH aborted migration was found during the repair** — `20260731000000_collaboration_schema_alignment`.
> `site_permissions` held only `(id, user_id, site_id, permission, created_at)`: no `role`, no
> `team_id`, no `granted_by`. It had to be folded in, because `collaboration_notifications`' INSERT
> policy joins `site_permissions` on `team_id` — without it the repair would have died exactly as
> `20260731001000` did.
>
> **The root cause of the editor outage is now known.** `20260801100000_editor_access_2fa` aborted
> because its first `site_editors` policy calls `user_has_site_permission()`, which does not exist:
> only `20260731008000` creates it and that also aborted, while `20260804130000` restored the
> policies with plain predicates and never redefined the helper. Both helpers are now created.
>
> **Method, again, because it is the fix for the scar:** dry run in `BEGIN … ROLLBACK` against real
> production first, then apply with the ledger `INSERT` **inside the same transaction as the body**.
> A failing migration rolls back its own "applied" marker. The migration also carries a postcondition
> that re-asserts "RLS on + ≥1 policy" for all 17 new tables and raises if not, so it cannot
> half-land a lockout or an open door.
>
> `20260813140000_site_permissions_delete_per_row` (the A-4 per-row DELETE fix) applied immediately
> afterwards, confirming the `granted_by` fold-in.
>
> ### One migration still blocked, deliberately
>
> `20260809120000_lock_down_definer_functions` fails on `function update_site_analytics() does not
> exist`. That belongs to the **analytics-alignment trio** (`20260731005000/006000/007000`), which
> also aborted. It is not a matter of creating the function: a plpgsql body is not name-resolved at
> creation, so creating it alone yields a function that creates cleanly and **raises at call time**,
> because the trio also never added the `site_analytics` / `user_activity_logs` columns its body
> writes. That repair is in progress as a separate migration. A blocked REVOKE is an acceptable
> state; a function that raises at call time is not.

> ## ✅ APPLIED 2026-08-17 — nine of the eleven unapplied migrations are now in production
>
> The ledger went from **32 to 41 of 43**. Verified by re-running `node scripts/check-schema.mjs`,
> and production smoke-checked afterwards: `/api/health` reports database and storage `ok`, the
> homepage and `/api/pricing` both 200.
>
> ```
> 20260804120000_billing_customers_write_policy      20260805190000_lock_down_content_version_rpcs
> 20260804130000_restore_missing_rls_policies        20260809130000_content_history_definer_and_delete_split
> 20260804140000_yearly_price_matches_stripe         20260813120000_hide_sites_api_key
> 20260804150000_reconcile_restore_content_version   20260813130000_checkout_reservations
> 20260805120000_reconcile_create_content_version
> ```
>
> `checkout_reservations` now exists (it was absent). RLS remains healthy: **every** table has RLS
> on with at least one policy. Several of these were security hardening that had simply never been
> run — `hide_sites_api_key`, `lock_down_content_version_rpcs`, `content_history_definer_and_delete_split`.
>
> **Method, because it is the fix for the scar that caused all of this.** Each migration was first
> run inside `BEGIN … ROLLBACK` as a dry run, so a failure cost nothing. Then each was applied with
> **the ledger INSERT inside the same transaction as the migration body** — so if the SQL fails, the
> "applied" marker rolls back with it. The original damage happened precisely because a file could
> abort while the ledger recorded success. That cannot happen with this method, and
> `scripts/check-schema.mjs` re-checks it in seconds.
>
> ### The two that could not be applied, and why
>
> Both fail the dry run because they depend on the **aborted** `20260801100000_editor_access_2fa`:
>
> | Migration | Blocked on |
> |---|---|
> | `20260809120000_lock_down_definer_functions` | `function public.purge_expired_editor_artifacts() does not exist` |
> | `20260813140000_site_permissions_delete_per_row` | `column "granted_by" does not exist` |
>
> Both are **security work** — the first revokes EXECUTE on definer functions, the second is the A-4
> per-row DELETE fix. Neither can land until the editor tables are repaired, which is the same work
> that unblocks the product's angle. That makes the editor repair the highest-value remaining item
> by some distance: one forward migration closes the wedge *and* two security migrations.
>
> **17 tables remain absent** (was 18). A repair must be a NEW forward migration modelled on
> `20260801200000_missing_base_tables.sql` — additive, `IF NOT EXISTS` on every table and index,
> `DROP POLICY IF EXISTS` before every `CREATE POLICY`, RLS in the same migration per non-negotiable
> 6, and every intent from the aborted files folded in, since none of them will ever re-run. It also
> needs a scoping decision: several absent tables serve **graveyard** features (`compliance_reports`,
> `conversion_events`, `collaboration_notifications`, `team_activity_log`) that `s04` retires, and
> recreating those would contradict the PRD's perimeter.

> ## ✅🔴 MEASURED 2026-08-17 — the database was finally probed. Run `node scripts/check-schema.mjs`
>
> Every claim below is from a live read-only query against production, not from a migration file.
> The probe is committed, repeatable, and connects over the **IPv4 pooler**
> (`aws-0-us-east-2.pooler.supabase.com:5432`) — `db.<ref>.supabase.co` is IPv6-only, which is why
> every earlier attempt was abandoned.
>
> ### ✅ GOOD NEWS FIRST: the RLS tenant boundary is intact
>
> **All 39 tables have RLS enabled and at least one policy. Zero exceptions.** ADR 002's boundary is
> real. This **retracts** the alarm an earlier revision of this register raised: `site_permissions`
> has 2 policies, `content_history` 2, and `teams` / `team_members` / `domain_verifications` 2 each
> — the "five tables locked out with zero policies" state described in
> `20260801200000_missing_base_tables.sql:70-77` **is not live**. `security_events` and
> `rate_limits` also have RLS **on**, contradicting the same tombstone. That tombstone is a snapshot
> of a moment, not of today.
>
> ### 🔴 The real problem is worse, and it is not RLS
>
> **18 of the 57 tables `architecture.md` describes do not exist.** Two independent causes, both
> live:
>
> **(a) Five migrations ABORTED and are marked applied** — in the ledger, tables absent, will never
> re-run. Every table from each file is missing, which is the transaction-rollback signature:
>
> | Migration | Tables it should have created |
> |---|---|
> | `20260127_ab_testing_v2` | `ab_test_results`, `visitor_buckets` |
> | `20260731001000_missing_tables_collaboration` | `collaboration_notifications`, `content_editing_sessions`, `team_activity_log` |
> | `20260731002000_missing_tables_audit_analytics` | `api_usage`, `audit_logs`, `compliance_reports`, `conversion_events` |
> | `20260731004000_missing_tables_integrations` | `blog_posts`, `bulk_operations`, `webhooks`, `webhook_deliveries` |
> | **`20260801100000_editor_access_2fa`** | **`site_editors`, `editor_verification_codes`, `editor_device_grants`, `editor_handoffs`** |
>
> **That last row is the product's angle.** `architecture.md` files those four under "Non-account
> editing (the angle)" and the PRD sells it as the wedge. **Nine source files on `main` already
> query `site_editors`** — `api/editor/editors`, `api/editor/validate-grant`, `SiteEditorsCard`,
> and five modules under `lib/auth/` (`editor-directory`, `editor-grants`, `editor-handoff`,
> `editor-hub-session`, `staging-access`) plus `feature-gating/permissions`. The table has never
> existed in production, so every one of those paths fails at runtime. It has gone unnoticed
> because production holds 1 user and 1 site — nobody has exercised the wedge.
>
> **(b) Eleven migrations have NEVER BEEN APPLIED.** The ledger stops at `20260803020000`; `main`
> has 43 files and the ledger has 32. These are clean, additive, re-runnable files — they did not
> abort, **nobody ran them**. Several are security hardening:
>
> ```
> 20260804120000_billing_customers_write_policy      20260809120000_lock_down_definer_functions
> 20260804130000_restore_missing_rls_policies        20260809130000_content_history_definer_and_delete_split
> 20260804140000_yearly_price_matches_stripe         20260813120000_hide_sites_api_key
> 20260804150000_reconcile_restore_content_version   20260813130000_checkout_reservations
> 20260805120000_reconcile_create_content_version    20260813140000_site_permissions_delete_per_row
> 20260805190000_lock_down_content_version_rpcs
> ```
>
> `hide_sites_api_key` and `lock_down_definer_functions` are not cosmetic. **Applying these is an
> operator decision and has not been done** — they are listed here so the gap is a decision rather
> than a discovery.
>
> ### What this invalidates
>
> - **`s14a-grant-authorized-editing` is built on `site_editors`, which does not exist.** Its diff
>   adds 14 lines referencing that table and it ships **zero migrations**. It passed review as
>   minor/ship-yes — correctly, because the reviewer judged the diff against `main`, and on `main`
>   the code around it makes the same assumption. **Merging it changes nothing for the worse; it
>   also cannot work.** Whoever creates these tables owns `s14a`'s real acceptance.
> - **`s05`'s `bulk_operations`** is absent for the same reason.
> - **`s16-webhook-config`** creates `webhooks` / `webhook_deliveries` in its own migration, so it
>   is unaffected — it supplies what `20260731004000` failed to.
> - `docs/architecture.md`'s Data model is annotated with these counts.

> ## 🔴 NEW 2026-08-17 — nobody has observed the live schema or the live RLS state
>
> This is the root cause behind two separate wrong claims made this week, and it will produce more
> until someone runs a probe.
>
> **Migration files are not evidence of database state in this project.** Seven migrations aborted
> in full and are marked applied, so they will never re-run
> (`20260801200000_missing_base_tables.sql:29-56`). Supabase wraps each in a transaction, so one
> `42P01` rolls back the whole file while the ledger records success. Benchmark:
> `20250817000000_complete_database_setup.sql` declares **25 tables; 15 existed.**
>
> Two documents asserted schema facts by reading `CREATE TABLE` statements and were wrong:
> `docs/stories.md` (retracted — see the A/B entry below) and `docs/architecture.md`'s "57 tables"
> (now annotated). Both errors have the identical shape.
>
> **The unobserved part that matters most is RLS.**
> [ADR 002](../decisions/002-rls-tenant-boundary.md) makes RLS the tenant boundary — the multi-tenant
> security guarantee of this product. Its actual state has never been measured. What the files say,
> in sequence:
> - `20260731008000` left `site_permissions`, `teams`, `team_members`, `domain_verifications` and
>   `content_history` with **RLS enabled and zero policies** — a total lockout for anon-key clients,
>   because RLS applies recursively inside policy subqueries and every per-site policy is an
>   `EXISTS` over `site_permissions`.
> - `20260804130000_restore_missing_rls_policies.sql` restored `site_permissions` and
>   `content_history` three days later, and documents the recursive-`EXISTS` trap in its own header.
> - `security_events` and `rate_limits` have `ENABLE ROW LEVEL SECURITY` **only** in
>   `20260611010000_rls_hardening.sql`, which is one of the seven that aborted — at its first
>   statement.
>
> **Whether any of that is true in production is unknown.** `teams` / `team_members` are graveyard
> surfaces so a lockout there is consistent with them being dead; `domain_verifications` is read by
> live code (`api/domains/verify/route.ts:188,219`, `api/security/stats/route.ts:151`).
>
> **What to run, once, from a host with IPv6 or the pooler region:** a `pg_catalog` probe listing
> tables, `pg_class.relrowsecurity`, and `pg_policies` counts per table. Compare against
> `architecture.md`'s Data model. That single query replaces every inference in this entry.
>
> **The instrument already exists — but not on `main`.** `scripts/check-ab-schema.mjs` (306 lines)
> is tracked **only on `feature/s11a-ab-data-plane`**, which is unmerged. Read it with
> `git show feature/s11a-ab-data-plane:scripts/check-ab-schema.mjs`. Its `pg_catalog` half is
> genuinely written and genuinely unrun: `relrowsecurity` from `pg_class`, policy counts from
> `pg_policies`, the unique-constraint check, and it already handles Supabase's pooler presenting a
> certificate for a different host. It is **scoped to the A/B tables** via its `REQUIRED` map —
> broaden that map to cover `architecture.md`'s Data model and it answers the whole question.
>
> *(Recorded precisely because an earlier revision of this entry called it "the template" as though
> it sat on `main`. It does not. That was the same infer-from-a-report habit this entry is about.)*
>
> Until then: **the security boundary this product depends on is unverified**, and the app largely
> works around it — 28 of 77 routes use the service-role client, which bypasses RLS entirely.

> ## 🔴 NEW 2026-08-17 — the A/B data plane is dead in production, and always has been
>
> **`ab_test_results` and `visitor_buckets` do not exist.** Probed live over PostgREST during
> `s11a`'s fix run: both return `PGRST205`, while the error hints name other `public` tables — so
> the schema cache is populated and the absence is real, not a caching artifact.
>
> This is **not new information to the repository** — it is new information to the *pipeline*.
> `supabase/migrations/20260801200000_missing_base_tables.sql` documents it at `:41-42` and
> `:64-68`: `20260127_ab_testing_v2.sql` aborted with `42P01` (it creates `ab_test_results` with
> `REFERENCES ab_tests`, and `ab_tests` did not exist), and Supabase wraps each migration in a
> transaction, so it rolled back **in full** and is nonetheless marked applied. It will never run
> again.
>
> **Live code reads and writes tables that are not there:**
> `src/app/api/ab-tests/track/route.ts`, `src/app/api/ab-tests/bucket/[siteId]/route.ts`,
> `src/lib/ab-testing/lifecycle.ts:43`.
>
> **`docs/stories.md` asserted the opposite and has been retracted.** It claimed both tables "DO
> exist" on the strength of reading `CREATE TABLE` in the migration file and finding no `DROP`.
> **A migration file containing a `CREATE TABLE` is not evidence that the table exists.** That
> mistake dismissed `research/s11`'s "database repair" pricing, which was correct.
> `research/s09` and `research/s12` cite the same migration and inherit the same error — **re-check
> both against the live schema before `s09` or `s12` executes.**
>
> **Not repairable by replay, and `s11a` correctly refused to try.** Its Task 9 was withdrawn under
> the plan's own stop rule rather than ship a migration that would abort, be marked applied, and
> reproduce the exact scar that created this situation. Creating these tables is a **scope
> decision reserved to the operator**, not a task an implementer takes on.
>
> **Still unrun:** the `pg_catalog` half of the probe — RLS enablement, policies, and
> `UNIQUE(visitor_id, test_id)` — needs a host with IPv6 or the pooler region. Do that **before**
> anything creates these tables, not after.

> ## 🔴 NEW 2026-08-17 — `NEXT_PUBLIC_APP_URL` is the apex, and only ONE reader canonicalises it
>
> Measured against production, not inferred:
>
> ```
> GET https://recopyfa.st/embed/recopyfast.js   → 308 → https://www.recopyfa.st/…
> GET https://www.recopyfa.st/embed/recopyfast.js → 200
>     cache-control: public, max-age=0, must-revalidate
>     etag: "489475dff486f36755347aa611cddd11"   174420 bytes
> ```
>
> `.env` sets `NEXT_PUBLIC_APP_URL=https://recopyfa.st` — the apex, which 308s to `www`. That
> redirect is incident **B-11**, and `canonicalizePublicAppUrl` (`embed-script.ts:29-40`) exists to
> rewrite it. **It is called from exactly one place**: `getPublicAppUrl` in the same file. Sixteen
> other call sites read `process.env.NEXT_PUBLIC_APP_URL` raw. The embed snippet is therefore
> correct and every other consumer emits an apex URL.
>
> ### ✅ D-1 FIXED 2026-08-17 (pending a deploy) — and confirmed live first
>
> Measured against production before changing anything:
> ```
> https://www.recopyfa.st/sitemap.xml → <loc>https://recopyfa.st/</loc>   (every entry, all 308)
> homepage                            → <link rel="canonical" href="https://recopyfa.st"/>
>                                       <meta property="og:url" content="https://recopyfa.st"/>
> ```
> The canonical tag was the worst of it: it declared the canonical URL to be one that immediately
> redirects away.
>
> **`NEXT_PUBLIC_APP_URL` in Vercel Production is now `https://www.recopyfa.st`** (was the apex).
> Two notes on the change: it is a **build-time inlined** variable, so **nothing changes until the
> next deploy** — no redeploy was triggered. And it is now marked **non-sensitive**, where
> production variables default to sensitive; a public URL is not a secret, and sensitive values
> cannot be read back with `vercel env pull`, which makes exactly this kind of verification
> impossible. The value was read back and confirmed.
>
> Local `.env` updated to match. `canonicalizePublicAppUrl` becomes a no-op safety net rather than
> a load-bearing rewrite — which is the safer arrangement, since it removes the failure mode instead
> of adding call sites that must remember.
>
> D-2 and D-3 below are **also fixed by this**, since they share the cause. Original entry follows.
>
> **D-1 · SEO — every sitemap, robots and canonical URL 308s. Live, and it undercuts `s17`–`s19`.**
> `sitemap.ts:14` and `robots.ts:13` build from the raw value via `resolveSiteUrl()`, and
> `layout.tsx:50` uses it as `metadataBase`, so every `<link rel="canonical">` and every OG URL
> points at the apex too. A sitemap whose entries all redirect wastes crawl budget and muddies
> which host is canonical. **The three SEO cluster stories exist to rank; they will publish their
> URLs through this same path.** Fix before `s17` ships, or the cluster inherits the defect at
> scale.
>
> **D-2 · The content route's CORS fallback can never produce a working grant.**
> `content/[siteId]/route.ts:178` falls back to `NEXT_PUBLIC_APP_URL` when `allowedOrigin` is null,
> setting `Access-Control-Allow-Origin: https://recopyfa.st`. The app is served from
> `www.recopyfa.st`, and ACAO must equal the request's `Origin` exactly — apex ≠ www — so this
> branch cannot match any real first-party browser request. Not a security hole (the value is our
> own origin, and "no grant" is still expressed by absence, never `*`), but it reads as a safety
> net while being a no-op. Either canonicalise it or delete it; leaving it is the worst of the
> three.
>
> **D-3 · Lower severity, same root.** `api/editor/editors/route.ts:203` puts an apex `/edit` link
> in editor invitations, and `api/cron/generate-blog-post/route.ts:14,28` POSTs to an apex API URL.
> Both work — browsers and `fetch` follow 308 and 308 preserves method and body — so these are
> waste, not breakage. Listed because they share the cause and should be fixed in the same pass.
>
> **Deliberately NOT flagged:** `checkout.ts` and `auth/public-origin.ts` rank the deployment's own
> origin above this variable on purpose, each carrying a tombstone (F-14, and the magic-link
> cookie incident). They are correct as written — do not "fix" them into consistency with the
> others.
>
> **The fix is one line of judgement, not sixteen edits:** either set `NEXT_PUBLIC_APP_URL` to
> `https://www.recopyfa.st` in the environment — which fixes all sixteen at once and makes
> `canonicalizePublicAppUrl` a no-op safety net rather than a load-bearing rewrite — or route the
> SEO and CORS readers through `getPublicAppUrl()`. **Changing the env var is strictly safer**,
> because it removes the failure mode instead of adding more call sites that must remember.
>
> ## ✅ VERIFIED SAME DAY — the embed artifact has zero production drift
>
> The deployed `/embed/recopyfast.js` ETag `489475dff486f36755347aa611cddd11` is exactly the md5 of
> the committed `public/embed/recopyfast.js` on `main`, at an identical 174,420 bytes. The
> source-of-truth → build-artifact discipline (AGENTS.md non-negotiable 1) is holding in
> production, not merely in the repo. Also: `/embed/*` carries `max-age=0, must-revalidate`, so a
> rebuilt artifact reaches every install on its next page load — **but nothing sets that
> deliberately.** `next.config.ts` defines only security headers and `vercel.json` only a cron, so
> it is Vercel's inherited default for `public/`. Adding long-lived caching to `/embed/*` as an
> "optimisation" would create a stale-artifact window across every customer site at once.

> **STATE: DEPLOYED.** `db677b0..f2951b8` pushed and live (deployment Ready).
> `tsc` 0 errors, `lint` 0 errors, **1352 tests passing**, pre-commit hook run
> on every commit.
>
> ## ✅ DATABASE PASSWORD ROTATED
>
> `SUPABASE_PASSWORD` was printed in full into an agent session transcript on
> 2026-08-02 (a `psql` connection-string parse error echoed it). **Rotated by
> the owner on 2026-08-09** (audit finding T-2 closed). Remaining follow-through:
> update the value in local `.env` and any CI secret that carries it — the six
> findings T-2 blocked can only be verified against production once the new
> password is in the environment.
>
> `CRON_SECRET` has already been rotated (see below) — that one is done.
>
> ## ✅ THE THREE HEADLINE BLOCKERS WERE STALE — ALL NOW RESOLVED
>
> This register spent two sessions warning about a migration that had already
> been applied. Verified directly against production, not inferred:
>
> - **`20260802020000` is applied.** `credit_purchases.expires_at` is nullable
>   and the `plan` CHECK had already been widened. The far-future-expiry
>   fallback in `insertNonExpiringGrant` is now dead code and can be removed.
> - **Starter is sellable.** Both live price ids are present in Vercel and the
>   CHECK admits `'starter'`. The "Starter is switched OFF on purpose" section
>   below is history, not current state.
> - **The free plan is fully retired** (`f2951b8`): row `is_active = false`,
>   CHECK narrowed to `('starter','pro')`, and a `'free'` write is now rejected
>   by the database. Confirmed by a rolled-back test insert.
>
> **Production is effectively empty**: 1 user, 0 subscriptions, 1 site, 0 credit
> purchases. Every warning in this document about stranding or grandfathering
> existing accounts is therefore moot — there are none.
>
> Purchased credits remain spendable without a subscription — a credit holder
> keeps AI and translations, but gets no sites and no seats.
>
> ## ✅ THE CORE E2E NOW RUNS, AND FOUND FOUR REAL DEFECTS
>
> `e2e/share-edit-publish.spec.ts` had never been executed. Running it took
> four attempts before it reached anything real, and then found, in order:
>
> 1. **`edit_sessions` rejected `publish`** (23514). The API validates its input
>    against `["view","edit","publish","admin"]` and accepts `publish`; the
>    database refused it. Same shape as the Starter checkout that charged a card
>    and wrote no subscription row.
> 2. **`publish_staging_content_atomic` did not exist** — `POST
>    /api/staging/publish` answered 500. Publishing, half of what the product
>    promises, did not work at all.
> 3. **The staging banner swallowed clicks on Save.** The inline toolbar flipped
>    below its element only at the viewport edge, so anything near the top of a
>    page put Save underneath the banner, which has the higher z-index.
> 4. **Every CORS preflight threw.** `NextResponse.json({}, { status: 204 })`
>    is invalid — 204 forbids a body — so ten OPTIONS handlers threw on every
>    call. In the content route the exception was caught into a blanket 403, so
>    the widget's cross-origin fetch was never sent and **published copy could
>    not reach a visitor on any real customer site**. That is the defect
>    `47e414e` set out to fix, still live, because its fixture never crossed an
>    origin.
>
> Both tests now pass end to end, and the production preflight is verified: the
> site's own origin gets 204, a stranger still gets 403.
>
> **Two lessons worth keeping.** `20260617000000` is recorded as applied and
> none of its contents are in production; `supabase db push` cannot apply a file
> containing a dollar-quoted function body plus GRANTs ("cannot insert multiple
> commands into a prepared statement"). Assume any migration of that shape is
> absent until checked. And the jest mock of `NextResponse` was more permissive
> than the runtime, so the unit test asserting "OPTIONS returns 204" passed for
> as long as the bug existed — a mock looser than the platform certifies bugs as
> correct. It now refuses a body on 204/205/304.
>
> ## ✅ SCOPE CUTS AND CLEANUP, ALL DEPLOYED
>
> - **A/B testing is out of the launch**, reversibly. The cron that ran every
>   five minutes is gone, the nav entry and the site-detail card are gone (its
>   only button pointed at the route), and the page is disabled by moving it to
>   `_ab-tests`, which Next does not route. Components, API routes, tables and
>   `plan.limits.abTesting` all survive, so restoring it is a rename.
> - **Real-time is opt-in.** Nothing listens on the configured socket endpoint
>   and Vercel cannot host `server/index.js`, so the widget was dialling a dead
>   host five times per visitor page load and deriving an endpoint when none was
>   set — which made "no server" look like "flaky server". `NEXT_PUBLIC_WS_URL`
>   is removed from production. Editing and publishing are entirely HTTP.
> - **A dead Publish button.** The confirm handler was attached only after the
>   pending-changes preview resolved, so the button rendered enabled with no
>   `onclick` while that request was in flight. Found because it made the E2E
>   alternate between pass and fail; a slow connection makes it routine.
> - **2,392 `node_modules` files untracked** across two nested trees. This is a
>   public repository and those files were most of what GitHub's 15 vulnerability
>   reports covered — `npm audit --omit=dev` in the root reports **0**.
>
> ## 🔴 WHAT ACTUALLY BLOCKS LAUNCH NOW
>
> 1. **P0-1 / P0-2 below** — an invited editor still cannot edit. This is the
>    product, and it is the only remaining functional blocker.
> 2. **Supabase email template** still points at `/auth/callback`; magic links
>    break cross-device. Console change, owner.
> 3. **The core E2E has never run.** `RUN_RECOPYFAST_CORE_E2E=1` against a
>    disposable project. Both P0 embed bugs shipped because nothing ran it.
> 4. **15 dependency vulnerabilities (8 high)** reported by GitHub on push;
>    one Dependabot PR is open.
> 5. **Is the Socket.io server deployed?** `server/index.js` is a separate
>    process Vercel cannot host, and `NEXT_PUBLIC_WS_URL` points at
>    `wss://recopyfa.st:3001`. If nothing listens there, real-time sync is dead
>    in production and no test would notice.
> 6. **`server/node_modules` is tracked in git** — 2,130 files.
>
> ## ▶️ NEXT SESSION — nine builds, none started
>
> All are *builds*, not fixes, which is why they were left. In priority order:
>
> 1. **Team-invite acceptance** (`InvitationManager`) — invited people cannot
>    accept, today. A broken flow, not a missing tab.
> 2. **Editor enrolment P0-1 / P0-2** — the magic-code widget client and the
>    `site_editors` enrolment UI. Same shape of defect twice over: an invited
>    person cannot get in.
> 3. **Five feature wire-ups** — bulk ops, domain verification, security
>    dashboard, AI translate, AI suggest. Each is a built, authorised,
>    working API route with no UI at all (see P4).
>
> Also open, needing a product decision rather than a build: multi-team
> switching, and whether A/B testing stays in the product at all — there is a
> live `/dashboard/ab-tests` page and ~11 components behind a feature the owner
> is not currently pursuing.
>
> **Check before deploying:** if the marketing site still advertises real-time
> collaboration or presence, that claim now has nothing behind it —
> `CollaborativeEditor` and `PresenceIndicator` were deleted in `5455c9d`
> because they spoke a socket protocol `server/index.js` does not implement.
> Same category as the "14-day free trial" copy an earlier lane had to remove.
>
> ## 🔴 ONE MIGRATION IS OWED TO PRODUCTION
>
> `20260802020000_plan_constraint_and_credit_collapse.sql` has **not** been
> applied. Confirmed against the live database via the PostgREST schema:
> `credit_purchases.expires_at` is still NOT NULL. Two consequences:
>
> 1. **Credits.** The deployed code writes `expires_at: null`, which the live
>    schema rejects with 23502. Left alone that means charge the card, throw,
>    500, Stripe retries forever, customer gets nothing — the Starter failure
>    shape exactly. **Mitigated in code**, not left open: `insertNonExpiringGrant`
>    tries NULL, and on 23502 falls back to a far-future expiry that the
>    `expires_at.gt.<now>` arm of the balance filter treats as spendable. The
>    grant is identical either way, and the fallback stops being used the moment
>    the migration lands. Credits are sold through inline `price_data`, not a
>    price id, so the Starter trick of pulling an env var would not have worked
>    here.
> 2. **Starter is still unsellable** until the constraint is rewritten, and the
>    `tickets` balances are still not carried into `credit_purchases`.
>
> ## 🔴 DEPLOY ORDER — Starter is switched OFF in live on purpose
>
> `billing_subscriptions.plan` shipped with `CHECK (plan IN ('free','pro','enterprise'))`
> from a migration predating the Starter tier. Every Starter checkout raises
> 23514, the webhook returns 500, and Stripe retries forever — **card charged,
> subscription row never written, customer stranded on free.**
>
> `STRIPE_STARTER_PRICE_ID_LIVE` and `STRIPE_STARTER_YEARLY_PRICE_ID_LIVE` have
> been **removed from Vercel production** and the site redeployed, so Starter now
> fails at checkout creation instead of taking money. Pro is unaffected and still
> sells normally.
>
> **To re-enable Starter, in this order and no other:**
> 1. Run `supabase/migrations/20260802020000_plan_constraint_and_credit_collapse.sql`
>    against production. It rewrites the constraint to `('free','starter','pro')`
>    and grandfathers any enterprise subscriber to pro *before* tightening it —
>    that ordering is load-bearing and asserted by a test.
> 2. Deploy the committed code.
> 3. Re-add both Starter live price ids to Vercel, then **redeploy** — Vercel bakes
>    env vars per deployment, so adding a value without redeploying does nothing.
>    (Values are in local `.env`.)
> 4. Verify with a real Starter checkout that the subscription row is written.
>
> **To land everything:**
> 1. Fix `src/lib/stripe/__tests__/config.test.ts` (3 failures). It asserts the
>    OLD live-mode contract — `NODE_ENV=production` implying live Stripe keys.
>    That was the bug: Vercel sets `NODE_ENV=production` on *preview* builds too,
>    so PR previews took real money. The discriminator is now `VERCEL_ENV`
>    (`src/lib/stripe/mode.ts`). Rewrite the assertions to the new contract:
>    `VERCEL_ENV=production` → live; `preview` → test; unset/`development` → test;
>    and `NODE_ENV=production` with `VERCEL_ENV` unset → **test, not live**.
>    Do not delete assertions to get green.
> 2. `npx jest --json` to confirm zero failures, `npx tsc --noEmit -p tsconfig.build.json`
>    for 0 errors.
> 3. Commit in four chunks: embed core loop / auth security / billing / UI+a11y.
> 4. Deploy, then remove the Enterprise vars from Vercel (not before — the
>    running build still reads them).
>
> **Not QA any more, deliberately deferred:** P0-1 (widget has no client for the
> magic-code system), P0-2 (no enrollment UI), ~15 orphaned components. These are
> builds, not fixes, and want a fresh session.
>
> **Sections 4 and 5 (Dashboard/UI, Accessibility) are now closed** except for
> P4. Both were almost entirely `[~]` in this register while commits
> `0bbb3de` ("make the dashboard's controls do what they appear to do") and
> `db677b0` ("rebuild /demo, and give the landing page a spine") had already
> fixed nearly everything they flagged. Reconciled against the code below, with
> file:line evidence per item. The one accessibility item that was still
> genuinely open after that reconciliation — the landing page's demo text
> being mouse-only to edit — has since been fixed and test-covered
> (`EditableText.tsx`, see section 5). The only thing left open in either
> section is P4's ~15 orphaned components, and that is a deferred build, not
> a fix.


## ✅ DONE — the free plan is gone (`e7ae07a`, `ed639fb`, `0af7668`)

**No free plan, no access without payment.** Shipped, code-only, in the order
the previous entry insisted on: nothing touches the schema.

`getEffectivePlan` returns an `Entitlement` — a discriminated union whose
unentitled branch carries `plan: null`, so `entitlement.plan.limits` does not
compile until the caller narrows. The compiler enumerated the call sites rather
than grep, and each one had to say in code what it does about somebody who has
not paid. A zero-limit plan object would have been indistinguishable from a real
plan at exactly the sites that matter.

It also removed a bug nobody had reported: `findPlanById` and
`findSubscriptionPlan` used to fall back to `free`, so a plan id retired years
ago kept conferring access by resolving to a live row.

**The signup question was answered: checkout before the account is usable.**
Middleware redirects a session with no entitlement off `/dashboard` and
`/settings` to `/dashboard/billing`, which is deliberately ungated — Stripe
returns there on success *and* cancel, and the webhook usually has not landed
when a paying customer arrives back. It fails open on a read error, because a
Supabase blip must not lock out a subscriber; every API route resolves
entitlement independently anyway, so this gate is routing, not authorisation.

**Two owner decisions were made on top:**

- **Purchased credits entitle their holder.** A credit balance is spendable
  with no subscription. Taking back a delivered good is the shape of a
  chargeback. Credits buy *metered* things only — never sites or seats.
- **`plan = 'free'` resolves to unentitled immediately**, not grandfathered.
  Normalised in `readEffectivePlanId` via `RETIRED_PLAN_IDS`, so the middleware
  path and the gates agree. The catalogue row stays seeded and inert: it is the
  code that makes it mean nothing, and deactivating the row first would have
  been the code-before-schema inversion that already broke credits once.

**Still owed to the database, separately and deliberately:** deactivating the
`free` row, and deciding whether the `billing_subscriptions.plan` CHECK drops
`'free'`. Existing rows may hold it, so it is a data question, not a constraint
edit — and nothing may be written while `20260802020000` is unapplied.

---

Living tracker for the full-journey QA pass. Findings are from four parallel
read-only recon agents (payments, auth, embed, UI) plus direct verification.

Status key: `[ ]` open · `[~]` in flight · `[x]` fixed + verified · `[!]` needs a decision

---

## 0. Blockers

- [x] **Production `REDIS_URL`** — was an EMPTY STRING in Vercel, not a stale
  host. Set to the verified `rediss://` value, redeployed, and confirmed: the
  Redis-gated path now returns 401 (auth rejecting an anonymous caller) instead
  of 503 (rate limiter unavailable). All ten fail-closed endpoints are back.
  Root cause of the confusion: Vercel bakes env vars per deployment, so editing
  a value does nothing to the running build until a redeploy.
- [x] Local `REDIS_URL` — fixed (scheme was `redis://`, Upstash is TLS-only).
- [x] `STRIPE_WEBHOOK_SECRET` was empty → every non-prod webhook 500'd, making
  local payment QA impossible. Pulled a real `whsec_` from Stripe CLI.
- [x] Production Stripe price ids synced (12 vars). Production had the old $29
  Pro price and no Starter/yearly/lifetime ids at all.
- [x] `EDITOR_GRANT_SECRET` was absent in production, so device grants were
  silently keyed off `SUPABASE_SERVICE_ROLE_KEY` — rotating that key would have
  killed every grant and hub session at once. Now has its own 64-char secret.
- [x] **`RESEND_API_KEY`** — added and verified live. `/api/editor/request-code`
  now returns a neutral 200 instead of 503. Same redeploy trap as `REDIS_URL`:
  storing the value in Vercel does nothing until a deployment picks it up.
- [ ] **Supabase email template still points at `/auth/callback`.** Until it is
  repointed at `{{ .SiteURL }}/auth/confirm?token_hash=…`, magic links break
  cross-device — request on a laptop, open on a phone, land on `/auth/error`,
  because the PKCE verifier cookie is not there. That is the most common
  real-world magic-link path. Console change, not code. **Owner: user.**
- [x] Enterprise env vars removed from Vercel production, after confirming the
  deployed build no longer reads them (`STRIPE_ENTERPRISE_PRICE_ID`,
  `_PRICE_ID_LIVE`, `_YEARLY_PRICE_ID`). The only surviving `ENTERPRISE` symbol
  in the source is the unrelated `RATE_LIMIT_CONFIGS.API_KEY_ENTERPRISE`.
- [ ] **Migration `20260802020000` not applied to production.** Owner: user —
  it needs credentials this session does not have. `supabase migration list
  --linked` fails SASL auth, there is no DB password or PAT in the environment,
  and PostgREST exposes no SQL-executing RPC. The hosted Supabase MCP server is
  now configured in `.mcp.json`; it needs `claude /mcp` → Authenticate, run
  from a real terminal, before an agent can apply it.

---

## 1. Core product loop — **BROKEN** (highest priority)

The central promise — edit copy, visitors see it — does not work on any real
site. Both verified directly, not just by reading.

- [x] **P0 Element IDs regenerate every page load.** Fixed and verified against
  the artifact actually serving production (`/embed/recopyfast.js`, sha256
  `3d32b615…` — byte-identical to `public/embed/recopyfast.js`). Ids now derive
  from structure alone via `computeStableElementId`. Observed, not argued: a
  fixture with two structurally identical sections, six `<li>` sharing byte
  identical text, framework ids (`:r3:`, `radix-:r7:`, `css-1a2b3c`) and an
  authored anchor, loaded in **separate fresh browser contexts**, yields
  identical ids across all 10 probes — and still does after every string on the
  page is rewritten, and after a decorative `<div>` is inserted between the two
  sections. No id contains a timestamp; identical siblings stay distinct;
  `data-rcf-id="author-chosen-id"` is honoured verbatim. 13 elements stamped.
- [x] **P0 Published content is never fetched on load.** Fixed and verified. A
  plain visitor load now issues `GET /api/content/{siteId}` — request order
  captured off the wire was `fixture.html → recopyfast.js → /api/content →
  /api/ab-tests/active → socket.io`, so hydration precedes both the A/B
  pipeline and the socket handshake, as intended. With one element stored
  server-side, the visitor's heading rendered `PUBLISHED COPY FROM SERVER`
  rather than the author's markup.
- [x] **P1 `content_elements` grows with traffic, not edits.** Closed as a
  consequence of stable ids: the probe set is byte-identical across loads, so
  `(site_id, element_id, language, variant)` now collides and the upsert
  matches instead of inserting a fresh row set per page view.
- [~] **Why it shipped:** the hand-authored-fixture problem is fixed —
  `e2e/share-edit-publish.spec.ts` no longer pre-seeds `data-rcf-id`; the id is
  now read off the DOM after the widget assigns it, with the comment there
  explaining why: a real customer page never carries the attribute
  (`e2e/share-edit-publish.spec.ts:27-31, 100-111`). What is still true: the
  suite remains `test.skip`'d unless `RUN_RECOPYFAST_CORE_E2E=1`
  (`share-edit-publish.spec.ts:13-16`), so the core loop still has no coverage
  in a default run — only against a disposable Supabase project on demand.

## 2. Editor auth — two systems, neither complete

- [x] **P1 Forwarding a *verified* invite URL granted full access.** Fixed:
  verification is now bound to a User-Agent fingerprint captured when the code
  is accepted, plus a 12h validity window. A forwarded URL yields
  `verified:false`, `permissions:[]` and a code prompt the holder cannot clear.
  Existing verified rows fail closed rather than being grandfathered — the whole
  bug was that already-forwarded URLs kept working. 6 regression tests.
- [x] **P1 A stale rotated grant revoked every device for that editor.** Fixed:
  the automatic lineage revoke is gone entirely. The inference it rested on does
  not hold — an honest stale tab and a thief present an identical token, so the
  detector cannot separate them and was firing on the common case. Response is
  now proportionate: that one token is dead. Grace window 60s → 5 min, because
  background timers throttle to minutes and a suspended laptop stops firing them
  altogether. Mutation-verified.
- [x] **P1 `staging/verify {action:"resend"}` had no rate limit.** Fixed:
  per-recipient and per-IP, both fail-closed. Keyed on the recipient address
  rather than the token, since one person can hold several invites. 6 tests.
- [x] **P2 Edit sessions extended without bound.** Fixed: 24h absolute ceiling
  from `created_at`, with the requested duration clamped rather than rejected.
  Added the revoke endpoint that did not exist — and found while implementing
  that `revokeEditSession` used the user-scoped client against a table with no
  UPDATE policy, so revocation matched zero rows and reported success.
- [x] **P3-11 Concurrent refresh forked the grant lineage.** Fixed: rotation is
  serialised claim-first via a conditional UPDATE, so exactly one caller wins.
  Mint-failure rollback preserved so a failed mint never strands the holder.
- [ ] **P0-1 Magic-code system has no client.** `/api/editor/*` + `/edit` are
  complete and well-built server-side. The widget has zero references to
  `rcf_handoff`. Every hub sign-in lands the user as an anonymous visitor.
  **Deferred — this is a build, not a fix.** Note for whoever wires it:
  `nextActionFor` can now return `"refresh"` as a third value alongside
  `verify`/`hide`; handle it or the tab falls through to a needless code prompt.
- [ ] **P0-2 No UI enrols a `site_editors` row.** `POST /api/editor/editors` has
  no caller. Share writes `staging_access` instead. An invited person requests a
  code, none is ever sent, and it is indistinguishable from a broken inbox.
  **Deferred — build, not fix.**
- [x] **P2 `request-code` leaks editor existence via latency.** Fixed: both
  branches now return `NEUTRAL_RESPONSE` from the same `return` statement
  (`src/app/api/editor/request-code/route.ts:137`), and the two operations
  that only the recognised branch used to do — minting a code (a DB write)
  and mailing it (a Resend round trip) — are deferred to Next's `after()`
  (`route.ts:108-130`), which runs once the response has already been
  committed. A recognised and an unrecognised request now do the same amount
  of work before the caller sees anything.
- [x] **New, not previously recorded: a sharper status-code oracle on the same
  route.** Reading the fix surfaced a second leak the latency finding didn't
  cover: the old code answered a distinct 503 `code_unavailable` when
  `issueVerificationCode` returned null, and that line was reachable only for
  a *recognised* address — no timing statistics needed, one request confirmed
  the address. Closed by the same `after()` move: a mint failure inside the
  deferred callback can now only `console.error`, never shape the response
  (`route.ts:117-121`). Regression-tested, not just reasoned about:
  `src/__tests__/api/editor/request-code/route.test.ts` (11 tests) — asserts
  recognised/unrecognised responses are `toEqual` on status and body, that the
  route never awaits the mint/send before responding (a test that would hang
  if it did), that `after()` fires only for a recognised address, and that
  invoking the captured deferred callback actually mints+sends and still logs
  on either failure. The three address-independent branches (malformed email,
  mail-provider-unconfigured, rate limit) are asserted unchanged. `npx jest
  src/__tests__/api/editor/request-code/route.test.ts` → 11/11 pass; `tsc`
  and `eslint` clean on both files.
- [ ] **Optional, needs a migration:** durable replay telemetry. Removing the
  automatic lineage revoke removed its visibility too; the only trace now is a
  log line. Persisting replay counts on the grant row would make "is this editor
  actually under attack?" answerable.

## 3. Billing

- [x] Stripe products + prices rebuilt; test now mirrors live exactly.
- [x] Live Enterprise archived. Junk test products archived.
- [x] Lifetime Pro $199 created in both modes.
- [x] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE` was never defined (missing
  prefix) → Stripe.js got `undefined` in production.
- [x] **C1 Preview deploys transact against LIVE Stripe.** Fixed: the decision
  lives only in `src/lib/stripe/mode.ts`, keyed off `VERCEL_ENV`, failing to
  TEST when absent, with `STRIPE_LIVE_MODE=true` as the explicit opt-in for a
  non-Vercel host. Verified live: production carries `VERCEL_ENV="production"`
  and 8 `STRIPE_*_LIVE` vars, so production is live and previews are test. No
  `NODE_ENV`-based mode branch remains outside comments.
- [x] **C3 Every paying customer gets 0 AI credits.** Fixed: reads use the real
  column `plan`. The surviving `plan_id` occurrences are Stripe *metadata* keys
  and a type field, not column names. `assertRead` now turns a PostgREST error
  into a throw rather than a silent zero balance.
- [~] **H5 Credits purchasable but unspendable** — code side done:
  `credit_purchases` is the single store and `addPurchasedCredits` is wired to
  the webhook. **Blocked on the migration** for the `tickets` carry-over; see
  the header. Not a regression from this deploy — balances read
  `credit_purchases` before it too, so `tickets` money was already invisible.
- [x] **H6 Plan limits are decorative** — closed in `e4759cc`, after auditing
  all six fields of `PlanLimits` rather than only the one the entry named.
  Five were already enforced: `websites` at `sites/register/route.ts:93` via
  `canCreateWebsite` (including Pro's `additionalSitePrice` overage, so the
  denial quotes a price rather than a wall); `aiFeatures` and `translations`
  through `consumeFeatureUsage`, which routes to `canUseAIFeatures` /
  `canUseTranslation` and is called by both AI routes; `abTesting` inline at
  `ab-tests/generate/route.ts:85`; `monthlyCredits` is an allowance the credit
  system grants, not a gate.
  **`collaborators` was the decorative one, and the register never named it.**
  `canAddCollaborator` was written, correct, and had **zero callers**, while
  `sites/[siteId]/share/route.ts` inserted into `site_permissions` — the table
  that gate counts — unguarded. Starter sells 0 seats and Pro sells 5; both
  were unlimited. Now checked before the insert via `canShareSite`, which bills
  the site **owner** (an `admin` row in `site_permissions`) rather than the
  sharer, since a manager may share a site they do not own. 8 tests, both
  quota edges pinned.
  **Known and deliberately not closed:** the check and the insert are not
  atomic, so two concurrent shares can both pass on the last seat. Closing it
  needs a DB constraint, and no migration may be written while
  `20260802020000` is unapplied.
- [x] **H8 Refunds and chargebacks revoke nothing.** Fixed: `charge.refunded`
  and `charge.dispute.created` both route to `handleMoneyReturned`, which claws
  back only unspent credits so a customer who already spent them is not driven
  negative.
- [x] **M9 Failed webhooks return 200**, so Stripe never retries. Fixed: failure
  paths answer 500. The one deliberate 200 is the already-processed case, where
  retrying would double-apply.
- [x] **M12 Pricing page advertises a 14-day free trial and "no credit card
  required".** Resolved by deleting the claims, with a comment at each site
  recording why. Verified on the live page: zero matches for "14-day", "free
  trial" or "no credit card". The two surviving "Free Trial" strings are sample
  copy *inside* the mock site on `/demo`, editable by the widget and explicitly
  commented as not a real CTA.

## 4. Dashboard / UI

- [x] P0 Analytics export hits a route that does not exist; failure swallowed.
  Fixed: `GET /api/analytics/export` now exists
  (`src/app/api/analytics/export/route.ts`), authorised identically to the read
  path (`authorizeSiteReadAccess`/`requireAuthenticatedUser`, lines 109-115),
  CSV output RFC-4180 quoted and formula-injection guarded (lines 30-42).
  `AnalyticsDashboard.tsx` no longer swallows a failed export into
  `console.error` — `exportError` is set and rendered
  (`AnalyticsDashboard.tsx:99-136, 294-301`).
- [x] P0 A/B wizard can never list an element (unauthenticated fetch → 401 →
  empty, with no empty state). Fixed: content elements are now read from
  `GET /api/sites/[siteId]/content-elements` via `useContentElements`
  (`src/hooks/useContentElements.ts:34`), a session-authorised route distinct
  from the token/Origin-gated embed endpoint. `ABTestElementPicker.tsx` has
  real loading, error-with-retry and empty states (lines 38-79), and the list
  itself is a keyboard-operable `radiogroup` (lines 84-119, Space/Enter
  activate).
- [x] P0 `/sites` is auth-gated but has no page → 404 behind an auth gate.
  Fixed by removing the gate rather than inventing a page: site management lives
  at `/dashboard/sites`, nothing links to `/sites`, and gating it only turned a
  404 into a login redirect that led nowhere. Live `/sites` is now a plain 404.
- [x] P1 Dead buttons with no handler. Verified one by one:
  - Update Password / Enable 2FA — the password card is deleted outright (this
    is a magic-link product; `recovery` is excluded from allowed OTP types) and
    replaced with an honest "Sign-in Method" card; fake 2FA is gone
    (`src/app/dashboard/settings/page.tsx:332-370`).
  - Generate API Key — `ApiKeysPanel.tsx` now calls the real
    `POST /api/api-keys` and reveals the plaintext key exactly once
    (`src/components/settings/ApiKeysPanel.tsx:90-115, 185-194`).
  - Theme tiles / Save Appearance — `ThemePicker.tsx` is a keyboard-operable
    radiogroup that applies and persists on click; the Appearance tab has no
    save button on purpose because there is nothing left for one to do
    (`settings/page.tsx:386-389`, `ThemePicker.tsx:20-62`).
  - Save Preferences — wired to `PATCH /api/auth/profile` with a validated
    whitelist (`settings/page.tsx:131-159`).
  - Invite Member / Send Invite / remove-member — all real now:
    `handleInvite` posts to `/api/teams/{id}/invitations`, `handleRemoveMember`
    deletes via `/api/teams/{id}/members`, both routes exist
    (`src/app/dashboard/teams/page.tsx:127-184`,
    `src/app/api/teams/[teamId]/{invitations,members}/route.ts`).
  - 6 blog category filters — `BlogPostList.tsx` derives categories from the
    posts and filters live; no pill can lead to an empty page
    (`src/components/blog/BlogPostList.tsx:29-42`).
  - Load More — `VersionHistoryPanel.tsx`'s Load More is wired to
    `fetchVersions(offset, append: true)` with real `hasMore`/`loadingMore`
    state (`VersionHistoryPanel.tsx:190-220`); the blog's own load-more was
    removed outright rather than wired, since three posts need no pagination.
  - Newsletter Subscribe — deleted; there was no subscriber table or endpoint,
    so the form silently discarded every address (`src/app/blog/page.tsx`,
    comment at the CTA).
  - 2 demo CTAs — confirmed not a bug, not "fixed": they have no handler on
    purpose, because the widget's selector includes `button` and they are live
    edit targets inside the mock customer site.
- [x] P1 Registration modal documents `data-recopyfast-editable`, an attribute
  the widget ignores — following the instructions literally yields nothing.
  Fixed: the modal now documents the attribute the widget actually honours
  (`src/components/dashboard/SiteRegistrationModal.tsx`), with a regression
  test locking it in (`SiteRegistrationModal.test.tsx:382`).
- [x] P1 The embed snippet renders invisible (`bg-foreground text-foreground`).
  Fixed — `bg-surface-2 text-foreground` now, with the old bug preserved only
  as an explanatory code comment (`SiteRegistrationModal.tsx:321-326`).
- [x] P3 Sign-in drops the redirect destination (`next` vs `redirectedFrom`).
  Fixed: `redirectedFrom` is the consistent param end to end
  (`src/middleware.ts:60`, `AuthContext.tsx`, `dashboard/layout.tsx:37`).
- [x] P3 Integration Status is hardcoded "Verified"/"Connected". Fixed: both
  rows now derive from `hasReportedContent` (whether the site has ever posted a
  content element back), not a constant
  (`src/components/dashboard/SiteDetailView.tsx:92, 352-378`).
- [x] P3 Header `#features`/`#pricing` are dead on every non-home page. Fixed:
  both links are now `/#features` and `/#pricing`
  (`src/components/layout/Header.tsx:58, 68`), which navigate to the homepage
  and land on the anchor from any page, rather than a bare fragment that only
  worked from `/`.
- [x] P3 Analytics chart bars unstyled (dynamic Tailwind class names). Fixed: a
  literal `CHART_BAR_CLASSES` map replaces the interpolated class name Tailwind
  could never see at build time (`AnalyticsDashboard.tsx:528-533`).
- [x] P3 Share dialog defaults to a retired link type; the DB rejects it and the
  admin is told they lack permission on their own site. Fixed: default is now
  `"invite"`, with a comment explaining the old default's failure mode
  (`ShareSiteDialog.tsx:55-58`).
- [x] **P4 orphaned components — audited, not just "~15."** A second, more
  rigorous pass (import-path grep across every non-`ui/` component, not the
  symbol-name grep that produces false positives against unrelated,
  same-named lib exports) found exactly 15, not ~15 — `knip` alone would
  have missed 5 of them. Classified into three groups and resolved:
  - **Deleted (7).** Two genuinely dead: `collaboration/CollaborativeEditor.tsx`
    and `collaboration/PresenceIndicator.tsx` both depended on
    `collaborationRealtime` (`src/lib/collaboration/realtime.ts`), whose
    expected Socket.io events share nothing with what `server/index.js`
    actually emits/listens for beyond the built-in `connect`/`disconnect`/
    `error` — wiring either in would have connected a socket that never
    receives anything it asked for. Five superseded by a live replacement
    using the same API route: `dashboard/ApiKeyManagement.tsx` (→
    `settings/ApiKeysPanel.tsx`, `/api/api-keys`), `dashboard/PublishButton.tsx`
    and `dashboard/StagingDiff.tsx` (→ the embed widget's own in-page publish
    button, `public/embed/recopyfast.src.js:1243,1269`, calling
    `/api/staging/publish` directly), `dashboard/StagingAccessManager.tsx`
    (→ `ShareSiteDialog.tsx` + `ShareLinkCard.tsx`, `/api/staging/access`),
    `collaboration/TeamDashboard.tsx` (→ `dashboard/teams/page.tsx`,
    `/api/teams/{id}/{invitations,members}`). Deleting `ApiKeyManagement.tsx`
    lost one real capability — its per-key rate-limit display — restored on
    the surviving panel: `ApiKeysPanel.tsx:34,230` now shows
    `rate_limit_per_minute` (the only rate-limit field the route or the
    `api_keys` table actually has — the deleted component's TS interface
    additionally claimed `requestsPerHour`/`requestsPerDay`, but neither
    exists in `/api/api-keys`'s `select()` or in migration
    `20250817000000_complete_database_setup.sql:88`; restoring those would
    have been inventing data, not restoring it). The only test file touching
    any of the seven, `src/__tests__/integration/collaboration.test.tsx`,
    covered `TeamDashboard` plus two survivors (`TeamSelector`,
    `NotificationCenter`) in one file — its `TeamDashboard` describe block
    (and the fixtures used only there) is removed, the other two are
    untouched and still pass (5/5).
  - **Kept on purpose, not orphaned by mistake (1).**
    `collaboration/TeamSelector.tsx` — it is the only multi-team switcher in
    the codebase; deleting it would make the gap below unfixable without a
    rewrite. See the new open item.
  - **Kept, being wired up (7).** `dashboard/BulkOperations.tsx`,
    `dashboard/DomainVerification.tsx`, `dashboard/SecurityDashboard.tsx`,
    `dashboard/TranslationDashboard.tsx`, `editor/AISuggestionButton.tsx`,
    `collaboration/InvitationManager.tsx`,
    `collaboration/NotificationCenter.tsx` — all back real, authorised,
    working API routes with zero UI anywhere. A separate lane is wiring
    these in; nothing was changed here.
  Verified, not asserted: `npx tsc --noEmit -p tsconfig.build.json` 0 errors,
  `npm run lint` 0 errors, `npx jest` 1319 passed / 0 failed (84 suites),
  `npm run format:check` clean.
- [!] **New: multi-team switching is unreachable.** `dashboard/teams/page.tsx:109`
  fetches `/api/teams` and silently uses `teams[0]` — a user who belongs to
  two or more teams has no way to switch which one they are managing.
  `TeamSelector.tsx` is the only component that ever did this and was kept
  specifically against this gap (see P4 above), but nothing renders it.
  Needs a product decision on whether multi-team support is wanted before
  it is a build.
- [~] **New, claimed: team-invite acceptance has no UI.**
  `collaboration/InvitationManager.tsx` is the invitee side — accept a team
  invite via a URL token or a pending-invitations list from
  `/api/notifications` — and nothing else in the app lets an invited person
  accept; `dashboard/teams/page.tsx` only covers the inviter side (sending
  invites). A real, broken flow, not just a missing dashboard tab. Claimed
  by the lane wiring up the seven load-bearing components above — listed
  here for visibility, not as unowned work.
- [x] **New: the dashboard nav could not tell anybody apart.** Closed in
  `9e541ad`. The sidebar read `user.user_metadata.plan`; nothing in the
  codebase has ever written that key, so it was always `undefined` and every
  account fell to the `"free"` default — a Pro subscriber saw "Plan: free",
  was offered an Upgrade button for the plan they were on, and had Teams
  greyed out. Also the wrong source in principle: `user_metadata` is
  client-writable, so the gate that failed closed for everyone would have
  failed open for anyone who edited their own metadata.
  It now reads `GET /api/billing/entitlement`, which resolves through
  `getEffectivePlan` — the same function middleware and the feature gates
  share, so the shell cannot hold a fourth opinion about who has paid. A
  dedicated endpoint rather than `/api/billing/dashboard`, which calls Stripe
  and pulls invoices, transactions and 30 days of usage to draw a sidebar.
  That also closed the trap it exposed: an unentitled account is bounced off
  every dashboard route back to `/dashboard/billing`, but the shell still drew
  all seven other links around it, each leading back where the user already
  was. Only Billing is offered now — and it *is* offered, since being unable
  to reach the page that sells the way out is its own trap. Unknown is treated
  as entitled while the fetch is in flight: being wrong that way costs a
  redirect, the other way tells a paying customer they have nothing.
  33 nav tests (rewritten from the old `userPlan="free"` contract, which
  described a state only the bug could produce) + 6 endpoint tests.

## 5. Accessibility

- [x] 7 unlabelled icon-only buttons. Every icon-only `Button` found carries an
  accessible name now: `ShareButton.tsx:31` (sr-only "Share"),
  `VersionHistoryPanel.tsx:157` (sr-only "Close version history"),
  `DashboardNavigation.tsx:187-189` (sr-only "Open/Close navigation"),
  `SiteCard.tsx:108` (sr-only "Open menu"), `ApiKeysPanel.tsx:232`
  (`aria-label="Delete API key …"`), `teams/page.tsx:444`
  (`aria-label="Remove … from the team"`), `ShareLinkCard.tsx:113,127`
  (`aria-label` on copy/revoke).
- [x] 3 mouse-only controls (A/B element picker, landing demo text, theme
  tiles). A/B element picker is a keyboard `radiogroup` (Space/Enter activate,
  `ABTestElementPicker.tsx:96-118`) and theme tiles are native `<button>`s in a
  `radiogroup` (`ThemePicker.tsx:40-45`). Landing demo text was the last of
  the three, fixed separately from the `0bbb3de` sweep: its read-mode element
  (`src/components/landing/demo/EditableText.tsx`) is now `role="button"`,
  `tabIndex={0}`, with an `onKeyDown` for Enter/Space (Space's default scroll
  suppressed via `preventDefault`), and an `aria-label` that states the
  affordance (`"Edit: <copy>"`) rather than exposing only the raw copy as the
  accessible name. The two CTA-styled ids (`"cta"`, `*-btn`) share this
  component and were checked specifically — they open the editor on
  activation like any other editable text, so making them focusable does not
  add a dead stop to the tab order. Driven by keyboard end to end, not just
  attribute-asserted: `src/components/landing/demo/__tests__/EditableText.test.tsx`
  tabs to the control, presses Enter (and separately Space), and asserts focus
  actually lands in the opened `<textarea>` — 4 tests, `npx jest
  src/components/landing/demo/__tests__/EditableText.test.tsx` passes; `tsc`
  and `eslint` clean on both files.
- [x] 5 unassociated form labels. Sampled every input/label pair touched by the
  sweep; all use `useId()` with matching `htmlFor`/`id`:
  `AnalyticsDashboard.tsx:52-54,208-254` (site/date filters),
  `ApiKeysPanel.tsx:54-55,165,243` (site select, key name),
  `teams/page.tsx:74-75,351,364` (invite email, role),
  `settings/page.tsx` (notification checkboxes,
  ``htmlFor={`notification-${option.key}`}``), `ShareSiteDialog.tsx:239,286,303`
  (email, expiry, label).
- [x] 2 modals without a working focus trap. Fixed: `useFocusTrap.ts` is a new
  hook (traps Tab, closes on Esc, restores focus on unmount), used by
  `VersionHistoryPanel.tsx:8,32` and the demo's replace-image modal in
  `EditableImage.tsx:6,47`.

---

## Verification protocol

No item moves to `[x]` on reasoning alone. Each needs: the command or click path
run, and the observed output pasted. For the embed fixes specifically, "the same
element yields the same id across two separate page loads" must be demonstrated,
not argued.
