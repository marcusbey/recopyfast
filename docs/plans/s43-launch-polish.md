---
validated: yes
validated_by: operator directive 2026-09-25 — "keep going, don't ask for permission, until tested live in production and ready to launch"
---

# Plan — Story s43-launch-polish

Branch: `feature/s43-launch-polish`
Research: `docs/research/s43-launch-polish.md` — read it first; this plan does not repeat it.

## Target story

Public pages load without errors, and `/pricing` works (launch audit, 2026-09-25).

- `/blog` hydrates without React #418 in any visitor locale/zone; blog dates (list and article)
  come from one shared formatter — `en-US`, `dateStyle: "medium"`, `timeZone: "UTC"`.
- `/pricing` → permanent (308) redirect to `/#pricing`, declared in `next.config.ts`.
- Formatter unit test (TZ matrix), BlogPostList hydration render test, redirect config test.

## Tasks (ordered)

1. [x] Formatter, test-first. `src/lib/utils/__tests__/format-date.test.ts`: `formatDate` returns
   `Jan 15, 2024` for `"2024-01-15"` (UTC midnight) and for `"2024-01-15T23:30:00Z"`, the UTC
   calendar day for an offset timestamp, accepts a `Date`, and returns `""` without throwing for
   an unparseable value (research trap: `Intl#format` throws `RangeError`). Watch it fail, then
   add `src/lib/utils/format-date.ts` — one module-level `Intl.DateTimeFormat("en-US",
   { dateStyle: "medium", timeZone: "UTC" })`, a tombstone comment naming #418 on /blog. Run the
   suite under `TZ=Pacific/Kiritimati` and `TZ=UTC`; mutation check: drop `timeZone`, run under
   Kiritimati, see red, restore.
2. [x] BlogPostList, test-first. `src/components/blog/__tests__/BlogPostList.test.tsx`:
   `renderToString` the list (featured `2024-01-15`, grid `2024-01-14`), then emulate a visitor
   whose *default* locale/zone differ (`fr-FR`, `America/Los_Angeles` — only calls that omit a
   locale or `timeZone` are affected), `hydrateRoot` into the server HTML, and assert: no
   `onRecoverableError`, and the dates read `Jan 15, 2024` / `Jan 14, 2024`. Watch it fail with
   the hydration text mismatch, then swap `BlogPostList.tsx:92,144` to `formatDate`.
3. [x] Article page, test-first. `src/app/blog/[slug]/__tests__/page.test.tsx` (mock
   `@/lib/supabase/server`, stub `Header` as `src/app/dashboard/sites/__tests__/page.test.tsx`
   does): a post with `published_at: "2024-01-15T00:30:00+00:00"` shows `Jan 15, 2024`. Watch it
   fail, then swap `blog/[slug]/page.tsx:75-79` to `formatDate`.
4. [x] Redirect, test-first. `src/__tests__/next-config-redirects.test.ts` (pattern:
   `src/__tests__/try/try-delivery.test.ts`): `await nextConfig.redirects?.()` contains exactly one
   rule with `source: "/pricing"`, equal to `{ source: "/pricing", destination: "/#pricing",
   permanent: true }`. Watch it fail, then add the entry in `next.config.ts` `redirects()` with a
   comment on why (launch audit 404; config redirects run before middleware).
5. [x] Gates and evidence. New suites under `TZ=Pacific/Kiritimati` and `TZ=UTC`; `npm run
   format:check`; `npm run precommit`; `npm run build` (CI placeholders); local `next start` on
   the build: `curl -sI` `/pricing`, `/PRICING`, `/pricing?utm_source=x` → 308 with the expected
   `Location`, and `/blog` HTML contains `Jan 15, 2024`. Fill the Execution log, tick the s43
   boxes in `docs/stories.md`, one commit `fix: stable blog dates and a /pricing redirect`.

## Run interdicts

- Empty diff: `src/middleware.ts`, `src/__tests__/middleware.test.ts`,
  `src/__tests__/middleware-matcher.test.ts`, `src/app/sitemap.ts`.
- Empty diff: every dashboard/billing call site listed in research's "Other locale-dependent call
  sites" table — listed, not changed.
- Empty diff: `jest.config.js`, `jest.setup.js` (no global `TZ` pin), `package.json`,
  `package-lock.json` (no dependency), `public/embed/*`.
- No `src/app/pricing` route — the redirect is the whole fix.
- No push, PR, merge, deploy, or request to production. Never `--no-verify`.

## The point everything turns on

The render test must reproduce #418 before the fix *in this process*, whatever its zone — CI
runs in UTC, where a naive `toLocaleDateString()` is indistinguishable from the fix. It does so
by emulating a visitor whose default locale and zone differ from the server's, delegating to the
real `Intl` so explicit `locale`/`timeZone` arguments are untouched. Where it could be wrong:
(a) the emulation also rewrites explicit arguments and so would "break" the fix too — compare the
green run's dates against the formatter's own output; (b) the red run fails for a reason other
than hydration (e.g. `renderToString` unavailable under Jest's export conditions) — the red
evidence must show React's hydration text-mismatch error, recorded below; (c) `/#pricing` plus
query ordering — compare against the `Location` header of the local `next start`.

## Files touched

- New: `src/lib/utils/format-date.ts`, `src/lib/utils/__tests__/format-date.test.ts`,
  `src/components/blog/__tests__/BlogPostList.test.tsx`,
  `src/app/blog/[slug]/__tests__/page.test.tsx`, `src/__tests__/next-config-redirects.test.ts`.
- Changed: `src/components/blog/BlogPostList.tsx`, `src/app/blog/[slug]/page.tsx`,
  `next.config.ts`.
- Docs: `docs/research/s43-launch-polish.md`, `docs/plans/s43-launch-polish.md`,
  `docs/stories.md` (s43 entry).

## Test strategy

Unit (pure formatter, TZ matrix from the shell), component hydration (server HTML hydrated under
an emulated visitor environment — the regression that matters on `/blog`), server-component
render (article date), config (exact redirect entry). No Playwright change: the e2e suite
already loads `/blog` (`e2e/public-pages.spec.ts:45`); console-error assertions there are out of
scope.

## Definition of Done

- The four new suites pass under `TZ=Pacific/Kiritimati` and `TZ=UTC`; each was seen red first.
- `npm run precommit` (lint, type-check, full Jest) and `npm run build` green; format check clean
  on changed files.
- Local production server answers `/pricing` with 308 → `/#pricing`; `/blog` HTML carries the
  UTC `en-US` medium date.
- One commit on `feature/s43-launch-polish` carrying code, tests, research, plan and the s43
  story entry. Review and ship are separate gates.

## Execution log

2026-09-25, branch `feature/s43-launch-polish` from `fb28a8b`, implementer subagent. Env: CI
placeholders sourced before every Jest/build run; local Node v24.14.0, machine zone America/Toronto.

- **Task 1 — formatter.** Red: `Cannot find module '../format-date'`. Green: 5/5 under
  `TZ=Pacific/Kiritimati` and `TZ=UTC`. Mutation check (drop `timeZone`): Kiritimati 3 failed,
  America/Los_Angeles 1 failed, UTC 5 passed (vacuous, as research predicts); restored, green.
- **Task 2 — BlogPostList.** Red for the production reason: `onRecoverableError` received
  React's "Hydration failed because the server rendered HTML didn't match the client", diff
  `1/15/2024` (server, en-US/UTC) vs `14/01/2024` (visitor, fr-FR/America/Los_Angeles). Green
  after the two call-site swaps; no console output. Plan risk (a) settled: the emulation leaves
  explicit `locale`/`timeZone` alone (the fixed component hydrates cleanly under it); risk (b)
  settled: `renderToString`/`hydrateRoot` run under Jest's export conditions.
- **Task 3 — article page.** Red: rendered `January 14, 2024` (Toronto zone, long month) where
  `Jan 15, 2024` was expected. Green under Kiritimati, UTC and America/Toronto.
- **Task 4 — redirect.** Red: `redirects()` returned `[]`. Green; the existing
  `src/__tests__/try/try-delivery.test.ts` still passes.
- **Task 5 — gates.** Four new suites, 8 tests: green under `TZ=Pacific/Kiritimati` and
  `TZ=UTC`. `npm run format:check`: clean. `npm run precommit`: lint 0 errors / 38 inherited
  warnings (none in changed files), type-check clean, Jest 252 suites passed / 2 skipped,
  3,315 tests passed / 39 skipped. `npm run build`: green, 102 pages, `/blog` static (`○`); the
  `fetch failed` log lines come from the placeholder Supabase URL (inherited). Local `next start`
  on that build: `/pricing` → `308`, `location: /#pricing`; `/PRICING` → same;
  `/pricing?utm_source=launch` → `308`, `location: /?utm_source=launch#pricing` (risk (c)
  settled); `/blog` HTML contains `Jan 15, 2024`, `Jan 14, 2024`, `Jan 13, 2024`; `/` carries
  `id="pricing"`. Interdicted paths: `git diff` empty.
- **Inherited, not fixed:** `next.config.ts` was already Prettier-unclean on `main` (quoted keys,
  whitespace-only lines); it is outside the `format:check` glob and the added lines conform.
  Reformatting the whole file is out of scope.
- **Not verified here:** production. Whether the three hard-coded `/blog` slugs exist in
  `blog_posts` (research, Open questions) needs one `curl -I` after deploy.

### Review fix — M1 (2026-09-25)

Deleting `timeZone: "UTC"` left every test green under CI's UTC. A runtime `process.env.TZ`
switch does not reach Intl inside a Jest worker (tried: mutant still 7/7 green), so the new test
spies on `Intl.DateTimeFormat` while `jest.isolateModules` loads a fresh module and asserts the
UTC pin. Proven: fix 6/6 green; mutant under `TZ=UTC` 1 red; restored with `git diff --exit-code`.
n1 (null `published_at` → 1970) is pre-existing and left as a follow-up.
