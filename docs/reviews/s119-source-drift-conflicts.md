# Review — s119-source-drift-conflicts

Reviewed October 22, 2026, fresh context, in the worktree
`.claude/worktrees/magical-sinoussi-7d76fe`, branch `feature/s119-source-drift-conflicts`,
commit `ec7de8aa` judged as `git diff 5d42b8e9..HEAD` (29 files). Spec: AGENTS.md, CLAUDE.md,
ADR 075, the research, the validated plan (including its implementation notes) and the story in
`docs/stories.md`. Read-only review. The only changes made were temporary mutations and one probe
test file. Each was restored or deleted, and `git diff --exit-code` / `git status` came back clean
before this file was written.

## Verdict

The required behavior works as specified, and the tests show it at all three levels. Original
"5 to 10", published "5 to 11", deploy "5 to 9": the drift is recorded once, it shows on the
Changes page, visitors keep "5 to 11", and only a site admin can Keep or Use new source. The
migration, the grants, the trigger change and the auth chain are correct. Every guard I
neutralized turned tests red. There are two major findings. Neither one is silent corruption,
and neither is reachable without opt-in integration or a deploy mistake.

## Findings

### M1 — major — Sites using the documented ADR 046 snapshot SSR get a false "Source changed" on every published edit, and the ADR 075 trust argument does not hold for them

- `public/embed/recopyfast.src.js:3274-3276` (the new predicate in `postContentMap`)
- `supabase/migrations/20261023120000_content_source_drift.sql` (`record_content_source_drift`, the SET/WHERE CASE)
- `docs/decisions/075-source-drift-is-flagged-not-enforced.md` ("Trust")

The premise in the research and ADR 075 is that `data.originalContent` is the page's *authored*
source. That is false for the integration documented in `docs/architecture/published-snapshot.md`
(ADR 046, s65a). The integrator's server renders `current_content` from
`GET /api/published/[siteId]` into the HTML, and the doc says "Keep the embed installed". On those
pages the widget's first-seen text **is the published override**. The doc also promised: "an
existing row's `original_content` is never overwritten with the published text you rendered."

Reproduced with a temporary probe built on the branch's own jsdom harness, then deleted. Page
rendered with "5 to 11", row `original_content` "5 to 10", `current_content` "5 to 11",
`source_seen` "5 to 10". The widget POSTs `{"pricing-range":{"content":"5 to 11",...}}`. The RPC
receives "5 to 11", sees it differs from the baseline on an edited row, and records it. The
Changes page then shows "Source changed since this edit" with "Page now says 5 to 11 / Visitors
see 5 to 11".

Concrete failure:

- Every publish on an SSR-integrated site raises a false conflict. Publishing "5 to 12" leads, at
  most 60 s later, to the SSR page reporting "5 to 12" as drift. The CDN stale window after a
  publish (the page still shows the old override) also reports the old override as drift.
- On those sites a real developer deploy can never be seen, because the widget never sees the
  authored source.
- "Use new source" on such a false drift rewrites `original_content` to the override text, which
  is exactly what the integrator doc promised would not happen.
- "Drop makes the row unedited, so the page shows its real authored text whatever the forged
  value was" holds only when the widget is the sole renderer. An SSR integrator, and any consumer
  of `current_content` (v1 API, snapshot), renders the stored value. So a forged drift that an
  admin accepts through "Use new source" is published to their visitors. The admin does see the
  text in the dialog first, which is why this is not critical.

Suggested direction (not prescribed): do not treat a live text equal to the row's served copy
(`current_content`) as drift evidence. Apply that check in the widget, so it does not spend one
report per view, and also in the RPC (`reported.content IS DISTINCT FROM
COALESCE(published_content, original_content)`). Then amend ADR 075's Trust section and the
integrator doc. Either way, the snapshot path needs its own sentence in ADR 075.

### M2 — major — Deploy-order hazard with a site-wide blast radius, recorded only in a plan note

- `src/app/api/content/[siteId]/route.ts:432-437`
- `src/app/api/content/changes/route.ts:409-421`

The visitor content GET now selects `source_baseline, source_drift_content,
source_drift_detected_at`. If the app is deployed before
`20261023120000_content_source_drift.sql` is applied, PostgREST answers that select with an
error. The route then returns 500 to every widget on every customer site, so all published copy
disappears and visitors see authored text. The Changes page also fails ("drift read failed" →
500).

The plan's implementation notes say "Migration first, then deploy". There is no
`docs/operations/*` runbook for it, and nothing in the code degrades. Stories with the same
hazard ship a runbook: `docs/operations/founding-offer.md` ("migration first, then the
application … Never merge…"). Merge is manual, so a human can do this right. But the cost of
getting it wrong is every site at once.

Fix: add a short operations note and a PR callout. Optionally, make the GET fall back to
`PUBLIC_CONTENT_COLUMNS` on an undefined-column error.

### m1 — minor — ADR 046's parity statement is now false and was not amended

- `src/__tests__/api/published/route.test.ts:807-823`

ADR 046 says the snapshot serves "exactly what the widget-authorized content GET serves", and a
parity test pins that. The diff weakens the parity to "identical except `source_seen`". The
implementer's reasoning (do not widen an unauthenticated CDN projection) is sound and is pinned
by tests. But neither ADR 046 nor ADR 075 records the amendment. Add one line to ADR 075 (and
ADR 046's "Amended by").

### m2 — minor — No same-origin guard on a cookie-authenticated POST that changes what visitors see

- `src/app/api/content/source-drift/route.ts:142-226`

The codebase convention, checked against the code: `isSameOriginRequest`
(`src/lib/http/same-origin.ts`) is used only by `admin/blog/posts/[id]` and `blog/generate`.
`tools/scan` uses its own guard. The ADR 037/042 content writes (`staging/publish`,
`staging/content`) use none, and the middleware adds no CSRF check. So the route follows the
convention of its closest analogue.

Two things narrow the exposure but do not remove it. `readBoundedJson` does not require
`Content-Type: application/json`, so a `text/plain` simple POST skips preflight. And s89's own
rationale ("a POST that changes what the public sees", same-site `*.recopyfa.st` hosts) applies
to "Use new source". Exploitation needs script on a same-site origin, because SameSite=Lax
blocks cross-site POST subrequests. Worth adding `isSameOriginRequest` here and on
`staging/publish` together, in a follow-up.

### m3 — minor — "Use new source" changes published copy without a `content.updated` webhook marker

- `supabase/migrations/20261023120000_content_source_drift.sql` (`resolve_content_source_drift`, drop branch)

`staging/publish` records `WEBHOOK_EVENTS.CONTENT_UPDATED` after a publish. The drop path
rewrites `published_content` and records no webhook marker. Integrators who rebuild a static
site or snapshot cache on that webhook miss it. Bulk and v1 writes already skip webhooks, so
this is consistent with existing gaps, not a new class of gap.

### m4 — minor — Lazy-loaded images and other per-load "authored" values can make drift flap

- `public/embed/recopyfast.src.js:2809` (`getElementText` for IMG reads `getAttribute('src')`)

On an edited image row, a host lazy-loader that swaps `src` after the first scan can make one
visitor report the placeholder and the next report the real source. That records and then clears
the drift, one report per view while it flaps, spending the fail-closed per-site discovery budget.
This is covered in spirit by ADR 075's "per-visitor authored text" known limit, but images are
not named there. Not reproduced; inferred from the code.

## Verified, no finding

- **Migration.**
  - Three nullable columns with no default, forward-only, `IF NOT EXISTS`.
  - Both functions are `SECURITY DEFINER` with `SET search_path = public, pg_temp`. `REVOKE ALL
    … FROM PUBLIC, anon, authenticated, service_role`, then `GRANT EXECUTE … TO service_role`.
    The generic `function-grants.test.ts` and the story's own grant tests pass on PG 17.
  - The recorder is one UPDATE, scoped to `site_id = p_site_id` and `en`/`default`. It writes
    only rows that are edited (widget definition) and only when something changes, and
    EvalPlanQual re-checks its decisions on the newest row version.
  - The resolver locks with `FOR UPDATE` on `id AND site_id` and returns
    missing / conflict / pending / resolved as in ADR 075 §6. The drop branch writes a `revert`
    history row.
  - No cross-tenant path: the route passes `site.id` after `authorizeSiteRequest`, and the
    resolution passes the `siteId` the admin row was read for.
- **Trigger.** The replacement body keeps SECURITY INVOKER, `search_path = pg_catalog, pg_temp`,
  the GREATEST monotonic rule and the REVOKE, with an else branch byte-identical to
  `20261012122000`. The new exception applies only when the three source columns differ **and**
  the rest of the row (minus `updated_at`) is equal, so a full no-op UPDATE still bumps.
  `staging-content-cas.test.ts` passes unchanged on PG 17.
- **Discovery POST.**
  - Order: `shedUnauthenticatedLoad` → authorize → fail-closed per-site limiter. The RPC runs
    after the upsert, best effort, with the error logged and the discovery answer unchanged. No
    exception text reaches the caller.
  - A forged report can only set `source_drift_content` (validated verbatim text) on an edited
    row of the token's site. M1 covers the one place where the ADR's harmlessness argument fails.
- **Resolution route.**
  - Chain order matches ADR 037/042: IP limiter (deny) → `getUser()` → per-user `USER_GENERAL`
    (deny) → bounded body → `site_permissions` via the RLS client → `admin` only →
    `checkOwnerCanEdit` → service client → RPC.
  - Validation uses `src/lib/api/validation.ts` (`requireUuid`, `requireEnum`,
    `readBoundedJson`) plus `validateVerbatimText` with no trimming. No zod.
  - Status mapping is 200 / 409 / 409 / 404, with an unknown status → 500 that carries a generic
    message.
  - Every import resolves, and type-check is green.
- **ADR 046 snapshot.** The widget never reads `/api/published/` (it only uses
  `contentReadEndpoint`, which is `/content/<site>?page_path=`), and there is no middleware or
  config rewrite. So leaving `source_seen` out of the snapshot cannot hide drift from the widget
  or break it. The SSR integrator case is M1.
- **Widget rewrites, each behavior-preserving.**
  - Object spread replaces `Object.assign`. Every target was a fresh literal. Key order is kept.
    `null`/`undefined` sources behave the same. The only difference is that an own `__proto__`
    key from JSON stays a plain key instead of reaching the setter, which is safer.
  - `3` for `Node.TEXT_NODE`, and more robust if a host shadows `Node`.
  - `.length`/string truthiness inside `if`/`some`.
  - `slice` for `substring` at all three sites: non-negative, ordered bounds.
  - `url.href` ≡ `toString()` per the URL standard.
  - The target is es2018, so object spread is native.
  - The new predicate and `delete (rows[id] || 0).source_seen` cannot throw. The index is
    `Object.create(null)` or `{}`, and deleting a missing property of a Number wrapper is not a
    strict-mode TypeError.
  - `node scripts/build-embed.mjs --check`: "embed artifact is up to date", 45742 / 32964 B gz
    against ceilings lowered to 45774 / 33016 (from 45801 / 33044). The ceilings went down.
- **Dashboard.**
  - The badge and panel are composed from `ui/badge`, `ui/button`, `ui/content-value`,
    `ui/dialog` and `ui/alert`, with existing tone tokens.
  - Resolve buttons are admin-only (`isAdmin && sourceDrift`), and a confirm dialog consistent
    with RevertDialog comes before any write.
  - 404/409 are stale → re-read. A lost answer is uncertain → re-read. Other refusals keep the
    server's words in the dialog.
  - Malformed `sourceDrift` is dropped by `knownSourceDrift`.
  - The changes read is RLS, site-fenced, bounded to the page's edited ids, and fails to 500 with
    a generic message, never an empty list.
- **Plan vs diff.**
  - Every task is present.
  - The `conflicts` filter was not built. That is justified in the notes: it cannot be done
    without widening the view (ADR 054).
  - Choices beyond the plan's wording are each listed in the implementation notes: the "edited"
    definition mirrors the widget, the claim deletes rather than sets `source_seen`, the byte
    rewrites, and drop moves a non-pending draft.
  - Modifications to existing tests are justified and narrow: the parity test now compares the
    rows minus `source_seen` (see m1), the public-rows select string, the lifecycle test's
    migration list, the changes-route helper, and the size-gate seeds following the ratchet.
  - No `skip`, `only` or `todo` in any changed test file.

## What I ran

| Command | Result |
|---|---|
| `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx jest src/__tests__/api/content src/__tests__/api/published src/__tests__/embed src/components/dashboard/changes src/hooks src/lib/content` | 53 suites, 1062 passed |
| `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx jest` (full suite) | 551 passed / 1 skipped suite; 8193 passed / 2 skipped tests |
| `LC_ALL=en_US.UTF-8 RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/run-db-invariants.mjs` | all migrations replayed on a scratch PostgreSQL 17.11; 22 named suites passed (214 passed, 1 skipped: the PostgREST placeholder), including `content-source-drift.test.ts`; "Database replay: all 22 named suites ran against PostgreSQL 17." (the first attempt failed only on the host locale: "postmaster became multithreaded", fixed by `LC_ALL`) |
| `npm run lint` | 0 errors (32 pre-existing warnings) |
| `npm run type-check`, `npm run type-check:build` | green |
| `node scripts/build-embed.mjs --check` | up to date, within the lowered ceilings |
| `prettier --check` on changed `src/**` files (`format:check` scope) | clean; the docs and the widget source are outside the script's scope and were already unformatted on main |

## Neutralization (every mutation restored; tree proven clean)

| # | Neutralized | Red |
|---|---|---|
| 1 | widget predicate reduced to `!known.has(id)` | 3 of 7 widget tests |
| 2 | widget claim `delete … source_seen` removed | 1 of 7 (rescan re-report) |
| 3 | content GET `sourceSeenFor` edited guard removed | 6 |
| 4 | discovery POST: recorder RPC never called | 3 |
| 5 | resolution route: any member instead of `admin` | 2 |
| 6 | resolution route: per-user limiter `onStoreFailure` deny → allow | 1 |
| 7 | recorder: "edited" predicate dropped (real PG 17 replay) | 2 |
| 8 | trigger: drift-only exception disabled (real PG 17 replay) | 3 |
| 9 | resolver: `expectedObserved` comparison dropped (real PG 17 replay) | 1 |
| 10 | resolver: `pending` refusal disabled (real PG 17 replay) | 2 |

Probe (temporary file `src/__tests__/embed/zz-review-ssr-probe.test.ts`, deleted): page
server-rendered with the published copy → the widget reports it as drift (M1).
`git diff --exit-code` and `git status --short` were clean after every step.

## Not verified, and what a human should do instead

- **No browser, no `next dev`/`next start`, no `npm run build`.** The Changes page badge, panel
  and dialog were seen only through Testing Library in jsdom. Gesture: on a preview deploy, open
  Changes for a row with a recorded drift, as an admin and as an editor. Check the badge layout
  in the grid, the three-column panel at narrow widths, the dialog focus return, and the
  announcements.
- **No end-to-end path.** Widget → POST route → real DB → Changes page was never run as one
  flow. Each layer was tested against mocks of its neighbour (only the DB layer was real).
  Gesture: on a staging site, publish "5 to 11" over "5 to 10", deploy "5 to 9", load the page
  in two browsers. Expect one POST carrying "5 to 9" from the first and none from the second,
  the badge on Changes, and visitors still seeing "5 to 11". Then try Keep, and separately
  Use new source, and confirm the page shows "5 to 9" after the drop.
- **Supabase/PostgREST was mocked in every route test.** The real PostgREST answer to the new
  select, and its behavior before the migration is applied (M2), were not exercised. The replay
  is bare PostgreSQL. Gesture: apply the migration to staging first, then deploy, and watch
  content GET 5xx rates.
- **Rate-limit store (Redis) was mocked.** Fail-closed behavior is asserted only through the
  `onStoreFailure: "deny"` option.
- **SSR snapshot integrators (M1)** were reproduced only in jsdom. Gesture: on a site that uses
  `/api/published` SSR, publish an edit and check whether Changes shows a false "Source changed".
- **Byte measurements** depend on Node 24.14.0 / zlib. CI's runner is the authority.
- **CI and the coverage ratchet were not run here.** `founding-offer-cap.test.ts` (Supabase-stack
  only) was not run.

Initial verdict, on `ec7de8aa` (superseded by the fix pass below): max severity major, ship allowed yes.

## Fix pass (d8ea1309)

I re-reviewed `git diff ec7de8aa..d8ea1309` fresh, on October 22, 2026. I neutralized every new
guard, restored it, and confirmed `git diff --exit-code` was clean after each one. Nothing was
committed.

| Finding | Status | Evidence |
|---|---|---|
| M1 — snapshot SSR false conflicts | **Closed** for a page that renders the current served copy | Widget (`recopyfast.src.js:3279-3282`): a drift report now also requires `live != row.current_content`. RPC: `AND reported.content IS DISTINCT FROM COALESCE(ce.published_content, ce.original_content)`, which neither records nor clears. `current_content` in the GET is `published ?? original ?? ""`, the same value the RPC compares against. ADR 075's Trust paragraph now says plainly that "drop" publishes the observed text to every renderer of stored copy and that the dialog review is the control. A known-limit entry for SSR was added. The edit to the migration in place is acceptable: it has never been applied (unmerged branch), and the runbook's dry run guards it. |
| M2 — deploy order | **Closed** | `docs/operations/s119-source-drift-deploy-order.md` is correct. Migration first, merge after, because merging to `main` is the production deploy. Its commands (`supabase migration list/db push --linked [--dry-run]`) match `founding-offer.md` and `content-writes-service-role.md`. Its catalogue checks (columns nullable; both functions `prosecdef`, anon/authenticated without EXECUTE, service_role with it) match the migration. It describes the 42703 → 500 → authored-copy-everywhere failure and an application-only rollback, and states that old code is safe on the new schema. That last claim is true: old code never names the columns, and the trigger only keeps the token when only the new columns change. It is linked from the plan, the story and `docs/README.md`. |
| m1 — ADR 046 parity | **Closed** | ADR 075's header has a "Narrows: ADR 046 parity" line with the reason. ADR 046 itself carries no back-pointer, which is acceptable. |
| m2 — same-origin guard | **Deferred** (plan "Deferred"), still open, minor | No change. The follow-up should cover it together with `staging/publish` and `staging/content`. |
| m3 — webhook marker | **Closed** | `recordNewSourcePublished` runs only when `status === "resolved" && resolution === "drop"`. It runs inside `after()`, re-reads `element_id` scoped by `id` and `site_id`, and records `WEBHOOK_EVENTS.CONTENT_UPDATED` with `{ elements: [{ element_id, content, attributes: {} }] }`, the same shape the publish RPC returns (`RETURNS TABLE(element_id, content, attributes)`). `content` is `expectedObserved`, which the RPC just verified equals the text it published. Failures are logged and never alter the response. Nothing is recorded on keep or on conflict/pending/missing. |
| m4 — lazy images | **Deferred**, still open, minor | Mitigation written into the plan. |

### New finding

**m5 — minor — after a publish, a stale snapshot can leave a false conflict that stays open.**

On an SSR snapshot site, inside the cache window after a publish (at most 60 s at our edge, plus
whatever cache the integrator runs, which `published-snapshot.md` says "adds to that bound"), a
page can still show the previous override. Say "5 to 11" is still on the page while
`current_content` is now "5 to 12". The widget reports "5 to 11", and the RPC records it as
drift, because it equals neither the baseline nor the served copy.

Once the snapshot refreshes, every later report equals the served copy, so it is ignored and the
drift is never cleared. It stays open until an admin resolves it. "Use new source" on it would
re-publish the previous override over the client's latest publish ("Visitors will see 5 to 11
instead of 5 to 12").

The dialog shows exactly that, so this is not silent. ADR 075's known limit names the case but
says it is reported "once", which understates that the conflict stays open. One way to close it:
ignore reports equal to a previously published value (from `staging_history`). Another: let a
served-copy report clear a drift recorded within the snapshot window. Follow-up, minor.

### Neutralization of the fix

| # | Neutralized | Red |
|---|---|---|
| F1 | widget: `&& live != row.current_content` dropped | 1 of 8 (the new SSR test) |
| F2 | RPC: served-copy clause dropped (real PG 17 replay) | 2 (both new SSR DB tests) |
| F3 | route: marker also recorded on `keep` | 1 of 7 webhook tests |
| F4 | route: marker never recorded | 3 of 7 |
| F5 | route: marker recorded before the status check (also on refusals) | 3 of 7 |

### What I ran on d8ea1309

| Command | Result |
|---|---|
| `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx jest src/__tests__/api/content src/__tests__/api/published src/__tests__/embed src/components/dashboard/changes src/hooks src/lib/content` | 54 suites, 1070 passed |
| `LC_ALL=en_US.UTF-8 RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/run-db-invariants.mjs` | 22 suites passed (216 passed, 1 skipped: the PostgREST placeholder); "all 22 named suites ran against PostgreSQL 17" |
| `node scripts/build-embed.mjs --check` | up to date; 45750 / 32972 B gz against unchanged ceilings 45774 / 33016 |
| `npm run type-check`, `npm run lint` | green; 0 errors |
| `prettier --check` on the changed `src/` files | clean |

The "Not verified" list above still applies unchanged. In particular, the SSR behavior is proven
in jsdom and against PG 17, not on a real snapshot-integrated site.

Remaining open: m2, m4, m5, all minor.

Max severity: minor
Ship allowed: yes
