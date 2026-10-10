# Review — s66a-app-design-tokens-and-panels

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s66a-app-design-tokens-and-panels`
(6 commits, head `4f746c8`).

## Verdict summary

All 10 plan tasks present; every run interdict holds (no diff in `public/embed`, `server`, `supabase`, `src/app/api`,
package files, marketing directories, dashboard layout/navigation; AGENTS.md untouched). Full jest 333 suites /
4,321 tests, type-check, type-check:build, eslint on changed files, coverage, build, `build:embed --check` green;
`playwright --list` shows 56 tests (11 in `app-layout.spec.ts`). The radius baseline whitelists nothing that
should have been converted (no `ui/**` file, none of the three panel files). After captures for both panels at
320/375/768/1280/1920 meet AC 1 and AC 2 and the design intent (square, flat, hairline borders, left-aligned
header, bottom sheet below 640). Every guard bites under mutation except one (minor m1).

## Findings

### Major

- M1 — `e2e/app-layout.spec.ts`, `e2e/support/owner-session.ts`: AC 1, 2, 4, 7, 8 rest on a run against an
  uncommitted in-memory Supabase stand-in (docker down). Plan task 10's `npm run test:e2e` (56) on the local
  stack is unmet, and the 45 existing flows were not re-run against the new dialog structure. CI's blocking E2E
  job is the first real run; it gates the merge, so it cannot reach production. Resolution: the PR's E2E job.

### Minor

- m1 — `src/__tests__/design/dialog-structure.test.ts:111-116`: the DialogBody check is per file, AC 5 is per
  call site (replacing `sites/page.tsx:624`'s DialogBody with a div turns 0 tests red).
- m2 — `e2e/app-layout.spec.ts:369-372`: the ring-width check can never pass (unused shadow layers serialise as
  `0px 0px 0px 0px`, so `Math.min(spreads)` is always 0); AC 7 rests only on the unlayered global
  `:focus-visible` outline (`globals.css:273`).
- m3 — `SiteRegistrationModal.tsx:369-388`: the definition list uses `font-mono text-[13px]` outside CodeBlock
  (design-system: 13px only for code inside CodeBlock; inline code is `text-xs`); the mockup's ruled rows are
  missing.
- m4 — `sites/page.tsx:572`, `SiteEditorsCard.tsx:557`, `SiteDetailView.tsx:513`: confirm dialogs render an
  empty DialogBody when there is no error (~36 px dead band).
- m5 — `ui/code-block.tsx:96-100`: "Copied"/"Copy failed" only change the button label (no live region); with
  "Show example" open, two buttons are both named "Copy".
- m6 — owner decision: CardTitle 20→16 px on the 404, `error.tsx`, blog index; AuthModal title 24→16 px.
- m7 — `home-1280.jpg` captures show a blank band below the demo (scroll-revealed sections), so the landing
  border repaint is not actually shown.
- m8 — nits: the fixture label is 59 chars (AC 2 says 60); ADR 050's numbering note is stale.

## Not verified

E2E against real Supabase (CI); AuthModal on a marketing page at 375/1280; `/blog` index; landing sections
below the demo; confirm dialogs at 375; real iOS/Android (bottom sheet `92dvh`, native picker, 32 px touch
targets); a real screen reader; a real clipboard on a denied permission.

## Orchestrator note

Owner decision 2026-10-08 on m6: "Accept 16px everywhere" (card titles); the AuthModal title follows the same
rule (dialog titles are part of the system). M1 is resolved by the PR's E2E job. m1–m5, m7, m8 go to a short fix
run before the PR.

## Verification of fix `f3ef941` (fresh reviewer, 2026-10-08)

m1–m5, m7, m8 closed; no new defect beyond one minor. Per-call-site DialogBody guard bites (swapping the
second DialogBody in `sites/page.tsx` → red); `focus-indicator.ts` handles real Chromium box-shadow strings and
the e2e assertion can now pass and fail; attribute rows conform to the design system's inline-code spec;
`empty:hidden` removes the dead band (4 tests red without it); the CodeBlock live region and distinct
`copyLabel`s are tested (5 red without `role="status"`). home-1280 captures show the scroll-revealed sections.
Full jest 334 suites / 4,343 tests, type-check green.

New minor: the Copy button's `aria-label` stays "Copy snippet" while its visible text is "Copied"/"Copy
failed" for 2 s (WCAG 2.5.3 label-in-name; the live region carries the announcement).

M1 (major) remains pending: the e2e harness's first run against real Supabase is the PR's E2E job.

## M1 resolved by CI (2026-10-08)

PR #67 CI run 37779659815, E2E job: all 11 `app-layout.spec.ts` tests ran against the real Supabase stack
(site-registered panel and Share preview link at 320/375/768/1280/1920; app CSS borders, popover, contrast,
focus) — 0 failed, 0 skipped, 0 flaky — alongside the existing 45 flows on the new dialog structure.

## PR #67 bot review (Devin) and fix `7f8e674`, verified by a fresh reviewer (2026-10-08)

- Step 2's title is platform-aware (`stepTitle` per recipe in `install-recipes.ts`; Next.js "Load it after the
  page has hydrated"; the tab resets on close).
- Tab lists never overflow: grid overrides removed from BulkOperations, login, AuthModal and
  DomainVerification; `tabs-guard.test.ts` fails on grid/inline-grid/grid-cols-*/flex-nowrap on a TabsList.
- Long site names wrap (`min-w-0 [overflow-wrap:anywhere]`).

Mutations on all three turn tests red. Full jest 350 suites / 4,460 tests, type-check green.

Remaining minors: the Copy button's label-in-name nit during its 2 s state; the new step-title and long-name
behaviours are covered by unit tests only (no e2e case).

Max severity: minor
Ship allowed: yes
