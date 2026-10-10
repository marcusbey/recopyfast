# Review — s66b2-app-page-passes

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s66b2-app-page-passes`
(one commit `a3dbe5d`, 52 files).

## Verdict summary

Tasks 1–5 in the diff; task 6 on its "baseline not empty" branch (14 s66c entries left). The 28 s66b2 files
are at zero radius offences. Run interdicts hold (no s66c file, no API/DB/embed/server, no `globals.css` or
dependency change, no copy or route change; AGENTS.md clean). Every new reference resolves; "8 vs 9
font-bold" is true; reading `translate` for the hover check and the relaxed `drawsShadow` are correct for
Tailwind 4. Full jest 358 suites / 4,633 tests, type-check, lint (0 errors), format green; `--list` 64.
R5/R6 bite (14 and 7 red), the pending list is exact, shrink-only works. The `app pages @w` extensions are
expected to pass in CI by reading (clip, shadow, hover stillness, metric grid edge, tabs at 375) — never run.

## Findings

### Major

1. AC 6's contrast clause has no test: `docs/stories.md:2862`, `:2795-2799`; `e2e/app-layout.spec.ts:1536`
   (standalone pages dark only, no contrast). Unmeasured new pairs: ThemePicker's selected label on
   `bg-tone-accent-surface`, Overview rows on `hover:bg-surface-2`, standalone h1/description in light.
2. `ThemePicker.tsx:53`: the unselected option keeps `border-border` (`--line`, 1.45:1, a research defect);
   the option-toggle spec (`design-system.md:261`, `:186`) says `border-input`.

### Minor

3. `page-shell-guard.test.ts:588`: the R3 self-test fixture changed `font-bold` → `font-semibold` — say so in
   the PR (AGENTS.md:233).
4. R5 gaps: `STATIC_SHADOW` misses bare `shadow`, `shadow-2xs`, `shadow-[…]`, `shadow-(…)`, `inset-shadow-*`,
   at-rest `ring-*`; the motion check misses `group-hover:-translate-y-*`, `hover:scale-*`,
   `hover:translate-y-*`; `card.tsx` is exempt as a whole file.
5. Dropping `border-2` (`UpgradeDialog.tsx:250`, `ThemePicker.tsx:51`) has no automated proof though
   `docs/stories.md:2843` claims the radius guard proves it.
6. `design-system.md:224,225,228`: three rows relabelled "no story yet" with no backlog entry.
7. s66c hand-off: no s66c AC obliges emptying the R5/R6 PENDING entries; deleting/renaming a pending file trips
   an anonymous existence assertion (`:428`) — the hand-off note should say "delete the PENDING entry with the
   file" and the assertion should name the file.
8. AC 5 says every standalone page has a square logo tile; `/auth/error` and `/edit` have none — "where
   present".
9. App-page captures required by the DoD are missing (need a Supabase stack).
10. (process) `next dev` was run once despite the interdict; no committed trace.
11. (nit) `page-shell-guard.test.ts:35-36` comment overclaims ("the last 700s a signed-in owner could see").

## Not verified

`app pages @w` never run (CI's E2E job is its first run; AC 2, 4, 5, 6 tick only on that run); standalone
capture provenance; app-page visuals; keyboard focus on full-bleed Overview rows; marketing `UserMenu` hover;
light-theme contrast of `bg-tone-accent-surface`.

## Orchestrator note

Owner standing rule: fix majors and cheap minors before shipping. Findings 1–8 and 11 go to a fix run; 9 is
CI's (no captures uploaded) — recorded as a known gap; 10 is noted.

## Verification of fix `567b77b` (fresh reviewer, 2026-10-08)

Both majors closed. Contrast checks on the changed surfaces read correctly against the code (hovered Overview
row text over the composited `hover:bg-surface-2`, selected theme label ≥ 4.5, unselected option border ≥ 3 —
computed 3.09 dark / 3.27 light — and standalone h1/description in both themes); they run inside the existing
1280 blocks (count stays 64 before the s67 merge, 69 after). ThemePicker `border-input` pinned (revert → 2 red).
R5 widening and R7 bite (Card `interactive` shadow, Metric arrow hover, `border-2` probes all red); no false
positives. Minors 5–8, 11 done. Full jest 362 suites / 4,732 tests, type-check green; `--list` 69.

New minors: R7 ignores every single-side border (`border-b-2`, `border-l-2`, …) anywhere, broader than the docs'
"tab underline and quote stripe"; the hover contrast measures the row's `p` lines, not its status badge.

Max severity: minor
Ship allowed: yes
