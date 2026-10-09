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

## Not verified

The DB suite's GoTrue block (real signup JWTs) and the full 85-test Playwright run — CI. A real browser at 375
for the who·when line. Production: after applying the view (owner approval), check
`SELECT reloptions FROM pg_class WHERE oid = 'public.content_changes'::regclass` read-only, then open
`/dashboard/changes` and revert one row as an editor and as a publisher.

Max severity: minor
Ship allowed: yes
