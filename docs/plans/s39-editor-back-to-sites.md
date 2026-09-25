---
validated: yes
validated_by: operator directive 2026-09-25 — "keep going, don't ask for permission, until tested live in production and ready to launch"; scope decisions taken by the operator in session (hub 7 d when Remember ticked, Remember unticked by default)
---

# s39 — Get back to all my sites

Research: `docs/research/s39-editor-back-to-sites.md`. No new screen: the hub keeps its current
layout and tokens; the banner control reuses `.rcf-editor-banner-dismiss`. Design step folded in
here (two controls, both composed from existing primitives/classes).

TDD order: each task writes its failing test first, records red, then goes green.

- [x] **T1 — Hub session carries "remembered".** `src/lib/auth/editor-hub-session.ts`:
      payload `{ e, x, r?: 1 }`; `createHubSessionToken(email, remembered = false)` sets
      `x = now + (remembered ? REMEMBERED_GRANT_TTL_MS : HUB_SESSION_TTL_MS)` (import the 7-day
      constant from `editor-grants.ts`; do not restate 7 days). New `readHubSession(token)` →
      `{ email, remembered } | null` and `getHubSession()`; keep `readHubSessionToken` /
      `getHubSessionEmail` as thin wrappers (callers unchanged). `hubSessionCookieOptions(remembered = false)`
      sets `maxAge` from the same TTL. A token without `r` reads as not remembered. Tests:
      `src/lib/auth/__tests__/editor-hub-session.test.ts` — 30 min default, 7 d remembered,
      expiry honoured, tampered token rejected, legacy payload without `r`.
- [x] **T2 — submit-code hub mode honours rememberDevice.** Pass `rememberDevice` to
      `createHubSessionToken` and `hubSessionCookieOptions` in the hub branch only; response adds
      `remembered`. Test the hub branch (mock directory/verification like
      `src/__tests__/api/editor/request-code/route.test.ts`): cookie maxAge 1800 vs 604800.
- [x] **T3 — sites + handoff read the session flag.** `GET /api/editor/sites` returns
      `remembered`. `handoff/create`: `rememberDevice = session.remembered || body.rememberDevice === true`
      (the body stays accepted so an already-open hub tab keeps working through a deploy). Tests
      for both routes: 401 without session, list + flag with session, handoff forwards the flag.
- [x] **T4 — Sign out of the hub.** New `src/app/api/editor/sign-out/route.ts`, `POST` only, no
      CORS. If an `Origin` header is present and is not the request's own origin → 403 (logout
      CSRF). Otherwise respond `{ ok: true }` and set `rcf_editor_hub` to `""` with `maxAge: 0` and
      the same path/httpOnly/secure/sameSite attributes. No data access, so no limiter; say so in a
      comment. Tests: clears cookie; cross-origin refused.
- [x] **T5 — /edit resumes a live session.** `EditorSignIn.tsx`: initial step `"checking"` renders a
      centred `Loader2` (no form flash). On mount `GET /api/editor/sites`: 200 → set email, sites,
      `rememberDevice = remembered`, step `"sites"`; 401 → `"email"`; network error / 5xx →
      `"email"` with the existing destructive `Alert` ("We couldn't check your session…") — never an
      empty list. Sites step shows "Signed in as {email}" and a ghost "Use a different address"
      button that POSTs `/api/editor/sign-out` then resets to `"email"` (reset even if the POST
      fails, and surface the error). `rememberDevice` default → `false`. `submitCode` sends
      `rememberDevice`. Guard the effect against unmount (ignore late responses). Tests:
      `src/app/edit/__tests__/EditorSignIn.test.tsx` — checking → list; checking → email on 401;
      error state on 500; checkbox unticked by default; submit sends rememberDevice; sign-out resets.
- [x] **T6 — Pay for the embed bytes.** In `public/embed/recopyfast.src.js`, move every CSS comment
      that sits inside a template literal out of the string (to a JS comment directly above the
      literal, wording kept). No CSS rule may change. `npm run build:embed`, record new gz sizes.
- [x] **T7 — "All sites" in the editor bar.** In `showEditorBanner()`, before Publish: a
      `<button type="button" class="rcf-editor-banner-dismiss">All sites</button>` with
      `aria-label="Back to all your sites"`, onclick `window.location.href = new URL('/edit',
      RECOPYFAST_API).toString()` wrapped in try/catch (non-negotiable #4). Leave a why-comment
      (s39: the bar had no way back to the list). Test in `src/__tests__/embed/` alongside
      `editor-grant-edit-mode.test.ts`: banner for a grant editor contains the control; clicking it
      navigates to `<api>/edit`; no banner (so no control) without `editorAuth`.
- [x] **T8 — Ratchet the gate.** Rebuild; set `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` in
      `scripts/build-embed.mjs` to the new measurements with a dated note itemising
      "CSS comments out of strings: −N" and "All sites control: +M". `npm run build:embed -- --check`
      green; artifact committed.
- [x] **T9 — Gates.** `npm run precommit` (lint + type-check + jest) and `npm run build` green.
      Commit `feat: back to all sites for invited editors` on `feature/s39-editor-back-to-sites`.

Out of scope: Playwright spec (count contract 44; journey proven live after deploy), in-page
code-modal path, SPA route handling (separate finding).

## Execution log

2026-09-25, implementer, worktree `.omx/worktrees/s39-editor-back-to-sites`, base `0b8014f`.
"Red" is the new test run against the unchanged code; tests that passed at red are named — they
pin existing behaviour the task must not break.

- **T1** red: `src/lib/auth/__tests__/editor-hub-session.test.ts` 9 failed / 1 passed (the
  cookie-attribute guard) — `readHubSession` / `getHubSession` not functions, `maxAge` ignored its
  argument. Green 10/10.
- **T2** red: `src/__tests__/api/editor/submit-code/route.test.ts` 2 failed / 2 passed — cookie
  `maxAge` 1800 where 604800 expected; body had no `remembered`. Passing at red: non-boolean flag →
  1800, site listing. Green 4/4.
- **T3** red: `src/__tests__/api/editor/sites/route.test.ts` + `.../handoff/create/route.test.ts`
  4 failed / 7 passed — no `remembered` in the list (×2); a remembered session handed off
  `rememberDevice: false` (×2). Passing at red: 401s, forged cookie, 403 re-check, body
  back-compat, 500 is not an empty list. Green 11/11.
- **T4** red: `src/__tests__/api/editor/sign-out/route.test.ts` — suite could not run
  ("Cannot find module …/api/editor/sign-out/route"). Green 6/6: clears with the live cookie's
  attributes + `maxAge: 0`; no `Origin` clears; `https://evil.example`, `http://recopyfast.com`,
  `null` → 403 with no `Set-Cookie`; `POST` is the only export; no CORS header.
- **T5** red: `src/app/edit/__tests__/EditorSignIn.test.tsx` 10 failed / 1 passed (401 → email
  step, which the always-email start already met). Green 11/11. Mutation: deleting the three
  `if (!isActive) return;` guards turns "ignores a late answer from a check that was abandoned"
  red; restored → green.
- **T6** red: `src/__tests__/embed/style-literal-comments.test.ts` 2 failed / 2 passed — 12 CSS
  comments inside the style literals of both the source and the artifact. Green 4/4. No CSS rule
  changed: the 5 style literals, comments stripped and lines trimmed, are identical line for line
  before/after in source and artifact (812 CSS lines each), and the artifact is byte-identical
  outside those literals and the source-hash marker.
  `build:embed`: bundle 46,635 → 46,170 (−465), widget 33,860 → 33,408 (−452), transport 13,141.
- **T7** first: the three existing Done lookups in `editor-grant-edit-mode.test.ts` took "the
  first `.rcf-editor-banner-dismiss`", which All sites (same class, by design) now precedes; they
  select Done by its `aria-label` instead — green on the pre-T7 widget, so behaviour-neutral.
  Red: 5 failed / 18 passed (control present ×3 permission sets, navigates to `<api>/edit`, never
  throws; "no banner without a grant" passed as a guard). Green 23/23. Mutations: target
  `/edit?x=1` → navigation test red; `try/catch` removed → never-throws test red.
  `build:embed`: bundle 46,170 → 46,226 (+56), widget 33,408 → 33,465 (+57).
- **T8** red: `build-size-gate.test.ts` seeded ratchet lowered to 46,226 / 33,465 → "never lets a
  ceiling be raised above the size it was seeded at" failed (expected ≤ 46226, received 46681).
  Green 9/9 after `MAX_BUNDLE_GZ` 46681 → 46226, `MAX_WIDGET_GZ` 33865 → 33465 (dated, itemised
  note in `scripts/build-embed.mjs`). `npm run build:embed -- --check`: `embed artifact is up to
  date` / `gzipped bundle 46226 B (max 46226) | widget 33465 B (max 33465) | transport 13141 B`.
- **T9** gates, run with the placeholder env extracted from `.github/workflows/ci.yml` (no real
  `.env`): `npm run precommit` exit 0 — lint 0 errors (39 pre-existing warnings, none in touched
  files), type-check clean, jest 251 suites passed / 2 skipped, 3,327 tests passed / 38 skipped
  (baseline 3,313 total; +52 new). `npm run format:check` clean. `npm run build` exit 0 (prebuild
  gate at the new ceilings; `/api/editor/sign-out` listed). Without the CI env this machine's
  baseline run of `main` already failed (AI translate/suggest and content-route suites, plus DB
  harness suites flaking under full-suite load) — environment, not this branch.

Net byte movement: bundle 46,635 → 46,226 (−409), widget 33,860 → 33,465 (−395); ceilings
46,681 / 33,865 → 46,226 / 33,465.
