# Review — s70b-changes-page

Reviewer: fresh-context `reviewer` subagent, 2026-10-09. Diff: `git diff origin/main...feature/s70b-changes-page`
(72f4cff → 27d473b: 2706b92 view migration + DB test + CI step, 27d473b story commit; 55 files).

## Verdict summary

Tasks 1–10 done; run interdicts hold — only the two new read routes under `src/app/api` (GET only, RLS client,
no `.or(`, no service role), no write route, no RPC, no change to an existing route (`openEditSession(request,
path?)` keeps the request body byte-identical; existing callers pass no path), `public/embed`, `server/`,
`package.json` untouched, `src/components/ui` only the sanctioned `status-badge` registry entry, no
`dangerouslySetInnerHTML`, the page never calls `GET /api/sites`.

**Security, verified on a real database** (throwaway PostgreSQL 16, bootstrap + all migrations, simulated JWT
claims, then real PostgREST 14.16 via postgrest-js): `reloptions = {security_invoker=true}`; with it reset, an
`edit` member of site A read site B and the admin-only emails — with it on, admin A sees A with `changed_by`,
edit/view members see A with `changed_by` NULL, admin B sees only B, a stranger 0 rows, `anon` "permission
denied"; grants exactly `authenticated=r`, `service_role=r`. Search escaping literal (`50%_off`); site B's text
and history email unreachable from A. Routes: limiter before `getUser`, offset bounded (≤ 10,000), 404 for a
site not the caller's, generic 500s, history admin-gated with `@`-only addresses. Publish enforced server-side
by the existing publish route (403 without the grade).

**PG15+ gate — accepted.** The view's DDL runs only on `server_version_num >= 150000` (CI's PG14 replay rejects
`security_invoker`); on PG14 it creates nothing (CI runner replayed: warning, no view, 50 tests green); on 15+
the DDL always runs and fails loudly; the only `CREATE` carries `security_invoker = true` (replayed over a
plain view of the same name → still `{security_invoker=true}`). Fails closed: no view → the route 500s → the
page shows its error. Production is **PostgreSQL 17.4** (orchestrator, read-only `current_setting`).

Gates: jest 387 suites / 5,088; type-check (both) 0; lint 0 errors; `format:check` clean; build lists
`/dashboard/changes` and both routes; `build:embed -- --check` 45828 / 33062 unchanged; Playwright `--list` 85
(contract 80 → 85 consistent in `playwright.config.ts`, `ci.yml`, the contract test). 24 mutations red (20 app
guards + D1–D4 on the database: `RESET (security_invoker)`, anon / PUBLIC SELECT, INSERT grant). Deleted
`content-load-states` cases re-asserted in `ChangesView.test.tsx`; moved/renamed tests keep their assertions.

## Findings (first review)

**M1 (major)** — picking a site unmounted the site `<select>` and blanked the counts while the list reloaded
(`useContentChanges.ts:164` emptied the data the filter bar reads); focus fell to `<body>`. **m1** `*` acted
as a wildcard (PostgREST rewrites `*` to `%` in like). **m2** deviations unrecorded (PG15+ gate,
`SiteSelectorBar` kept, `buttonVariants`). **m3** "Open" built `https://${domain}${path}` with no host check.
**m4** location cut at 375. **m5** "N changes on M sites" counted every site. **m6** history cache survived
sign-out. Pre-existing, not counted: `<Button asChild>` drops every class (`button.tsx:106-117`) at 10 call
sites — follow-up story.

## Fix pass `730d6fe` — verified (fresh reviewer)

M1 fixed: the hook keeps the last answer's sites and counts while reloading; only rows skeleton; same select
keeps focus (jest + e2e). m2 plan Deviations section and an ADR 054 consequence (PostgreSQL 15+ only; appended,
precedent ADR 052/020, no decision changed). m3 `new URL(path, origin)`, single leading `/`, host must equal the
site's, for the row's Open and ⋮ "Open on page" (hostile paths probed); "Edit on page" already re-checks the
host. m5 counts sites with a change once all rows loaded. m6 `clearChangeHistory()` on `SIGNED_OUT`, inside an
effect, SSR-safe. 15 mutations; jest 5,106. New minors: **N1** a `*` search showed as a page failure; **N2** the
375 row moved ⋮ off the design, cutting "when"; **N3** an e2e counts assertion could not fail; **N4** clearing
only on sign-out unpinned.

## Fix passes `f06ddd6`, `5e4f9ec`

N1: search uses PostgREST `imatch` with every POSIX ERE metacharacter escaped (`escapeRegex`); the `*` 400 is
gone; scratch PostgreSQL 16 + PostgREST 14.16: 12 searches each returned exactly their literal rows, unescaped
controls matched lookalikes; `imatch` exists (maps to `~*`) in PostgREST 12.2, 14.16, 16.2. N2: the 375 grid is
the design's (`expand status location location menu` / `. text…` / `. who who open open`); in `5e4f9ec`
(orchestrator) a long address truncates in its own span and the time never shrinks. N3: per-site fixture
counts and a held reload — the assertion now fails on the old code. N4: TOKEN_REFRESHED / SIGNED_IN keep the
cache. Mutations red; jest 5,130 passed; `e2e/changes.spec.ts` 5/5 against a production build (scratch stack).

## Devin Review on PR #77 — fixed (`8bcc805`)

Discard left staged `href`/`alt` attributes (the save RPC merges attribute patches) → the discard PUT sends each staged
attribute back with its live value; the list route returns `draftAttributes` for pending rows; a draft whose attribute
cannot go back is not offered Discard and the row says why. A failed publish after "Revert and publish" saved the draft
→ the row turns Pending with the reverted draft and says so, Publish retries. `nextOffset` is null past the 10 000
ceiling (it offered 10 050, refused forever) and the page says the list is capped. Revert is not offered when the live
text is already the original. Page bands keep the first segment (`Products › Alpha › Setup`).

## Verification of `8bcc805` — critical N1, fixed (`e3098b6`)

Fresh reviewer: the row a write left on screen kept the staged attributes' old live values, so Publish → Revert → Save
as draft → Discard re-staged the old link and the next Publish restored it (**critical**). Fixed per action from the
RPCs' semantics; N2–N5 (missing metadata row = unknown, never offered a discard; metadata read fenced by `site_id`;
malformed list refused; design doc matches the code).

## Verification of `e3098b6` — critical C1, major M1, fixed (`0fec9ad`)

Fresh reviewer: Publish promotes every language and variant row of the element (`20260924060000`) but the page redrew
only the row acted on, so an `fr` sibling kept its old draft and a Discard there re-staged old copy (**C1 critical**);
Discard built its PUT from the row on screen (**M1 major**). CTO decision: stop deriving post-write state on the
client — refetch after mutate. After every write that lands, the page re-reads every row of the element and the
current filters' counts (`refreshAfterWrite`; `rowAfter` deleted); GET `/api/content/changes` gains a read-only
`element` filter (needs `site`, ≤ 255 chars, RLS client). Discard re-reads its row just before the PUT and sends
nothing if it was published, replaced or gone ("updated elsewhere"). Reads are numbered; a row is only replaced by a
later read. The read-to-PUT window stays open → s81 (compare-and-set in the staging PUT).

## Verification of `0fec9ad` — major (single-tab race), fixed (`e6fc8cf`)

Fresh reviewer: two writes on the same element from one tab (Publish on one language, Discard on another) could
interleave (**major**), plus minors 2–7. Fixed: per-write `inFlight` entries and an element lock (site + element id)
across panel and ⋮; the hook refuses a second write; out-of-order count re-reads; element read follows `nextOffset`
and refuses non-advancing offsets; a thrown write is re-read ("may or may not have landed"); revert+publish never
publishes after an unanswered save; never-published translations (`hasLiveText`) are not offered Discard; focus
branches tested. 22 mutations red.

## Verification of `e6fc8cf` — minor

Fresh-context `reviewer` (opus), 2026-10-09. All seven claims hold; no regression, no invented symbol, no security change.

Gates (HEAD e6fc8cf): jest 388 suites / 5,214 passed; type-check (both) 0; lint 0 errors; format:check clean;
build:embed 45828 / 33062; Playwright `--list` 85; `git merge-tree` against origin/main clean.

- Element lock (`useChangeActions`): per-write `inFlight` entries; every row of the element (all languages/variants)
  disabled in panel and ⋮ while a write is in flight; the hook refuses a second write. Lock per site + element id.
- `hasLiveText` matches the SQL: `is_pending` = `staging_content IS NOT NULL AND staging_content IS DISTINCT FROM
published_content`; discovered elements get a published text (`api/content/[siteId]/route.ts:174`), translations
  don't (`api/ai/translate/route.ts:315-336`).
- Removing the `rereadFrame` generation check is safe: the reviewer built the out-of-order case (old filter's count
  re-read landing while the new first page loads) — `data` is null then, nothing is patched; the other order is covered
  and goes red without `patchFrame`'s read-order check.
- Route change is one derived field from a column already read under the caller's permissions; limiter, getUser,
  ownership 404, generic errors, no service role unchanged. Page-following loop bounded (offsets must advance; route
  refuses > 10 000; ~201 requests worst case, cut by the 200/min IP limiter).

Mutations: 27 guards; red for all except M3c/M3e (Revert lock in panel / ⋮) and M16 (lock clear on throw — no
production path throws inside `track`; `finally` handles it). M6 (non-advancing offset) red only via worker OOM.

Findings: minor 1 — Revert lock untested (`ChangeDetail.tsx:232`, `ChangeRow.tsx:404`). minor 2 — lock lives in the
mounted page, not the tab; comment `useChangeActions.ts:439` overstated (same class as the second-tab case → s81).
minor 3 — no timeout on write requests (`useChangeActions.ts:233`): a hung request locks the whole element until
reload; add a local page cap in `readElementChanges` so M6 fails by assertion.

Not verified: e2e specs executed (CI); real-browser lock under Slow 3G; DevTools Offline during Discard; `hasLiveText`
against real PostgREST (non-prod stack, translation with a draft → no Discard); `next build`; merged-result jest.

## Final fix pass (`b48db29`) — verified by the orchestrator

Revert lock tested (a published `de` sibling: panel Revert disabled, ⋮ Revert `aria-disabled`, no dialog; both
mutations red). Lock scope comment honest (the lock lives in the mounted page; leave-and-return during a write → s81
follow-up). Writes bounded: `AbortSignal.timeout(30 s)` (same 30 s as `DELIVERY_TIMEOUT_MS`), a hung write ends as
"may or may not have landed", is re-read and unlocks; `readElementChanges` stops after `MAX_ELEMENT_PAGES` (201) so the
non-advancing-offset mutation fails by assertion, not a heap crash. Residual: reads done while the lock is held share
`fetchChanges` and have no timeout (recorded in the plan). Jest 5,229 passed.

Rebased onto main `2357871` (s74): the Playwright strict contract is now 81 + 5 = **86** in `playwright.config.ts`,
every place in `ci.yml` and `playwright-ci-contract.test.ts`; `--list` 86 / expected 86; contract test 11/11.

## Devin re-review on PR #77 (head `0d95001`) — fixed (orchestrator)

The four first-round findings are marked resolved by Devin. New 🔴 **Hung reads lock every sibling action** (valid —
the residual the final fix pass recorded): writes gave up after 30 s, but `fetchChanges` had no deadline, so a re-read
after a write, or Discard's read before its PUT, that never answered kept the element lock until reload. Every list read
now carries `AbortSignal.timeout(READ_TIMEOUT_MS)` (30 s, the write timeout's value) and a timed-out read fails like any
failed read: the re-read resolves false ("may be out of date"), Discard sends nothing, the lock is released. Test (red
first: "Expected rejected, Received pending" at 30 s): a read that never answers makes `readElementChanges` reject at
30 s and not before. Hooks + Changes + dashboard suites 314/314.

Flag **Discard remains vulnerable to concurrent edits** (investigate): the read-to-PUT window recorded since the
`e3098b6` verification; the compare-and-set in the staging PUT is follow-up s81-version-restore-integrity.

## Devin re-run on PR #77 (head `112b775`) — fixed (orchestrator)

The hung-read bug is resolved. New 🟡 **Older browsers cannot load changes** (valid): `AbortSignal.timeout` is missing in
Safari before 16 (the embed already treats it as optional), and calling it threw before any request was sent — the page
could not load and every re-read reported stale data. New `src/lib/utils/timeout-signal.ts` uses the native API when
present, else an `AbortController` that aborts with the same `TimeoutError`; both hooks (reads and writes) use it. Tests
(red first: "Expected number of calls: 1, Received 0"): with `AbortSignal.timeout` removed, the element read is still
sent and still gives up at 30 s; the helper aborts at 30 s and not before, with and without the native API. Hooks,
utils and Changes suites 225/225; type-check and lint clean.

## Not verified

The DB suite's GoTrue block (real signup JWTs) and the full 86-test Playwright run — CI. A real browser at 375
for the who·when line. Production: after applying the view (owner approval), check
`SELECT reloptions FROM pg_class WHERE oid = 'public.content_changes'::regclass` read-only, then open
`/dashboard/changes` and revert one row as an editor and as a publisher.

Max severity: minor
Ship allowed: yes
