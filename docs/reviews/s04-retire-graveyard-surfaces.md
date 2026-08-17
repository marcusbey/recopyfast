# Review — Story s04-retire-graveyard-surfaces

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s04-retire-graveyard-surfaces`
> (merge-base `87477c8`, head `6b821e4`).

## Tests
- [x] Run by the reviewer. **144 suites / 1,983 tests passed, 0 failed** (baseline `main`:
      140 / 1,954 — the delta is exactly this story's four new suites). Coverage run exits 0.
      Lint, tsc, format:check and `npm run build` all green.
- [x] **Bite proven by six neutralizations**, each restored before the next: Teams NavItem → 6
      red · full widget restore → 6/10 · Apply Style button alone → **1/10** · dropped `?notice`
      → 2/4 · notice forced off → 6/8 · graveyard import added to `settings/page.tsx` → 1/7. All
      restored, `git diff --exit-code` clean in both trees.

## The five interdicts
1. **Frozen = unexposed.** Zero diff on all of `src/app/api` and all of `src/__tests__/api`,
   verified per-path. The frozen route tests pass with their original assertions.
2. **The hidden second entry point is closed.** `grep -n "switchTab("` now returns exactly one
   call site (`:5467`, the tab bar) plus the definition and a tombstone comment. `applyStyleBtn`
   is gone, and so is every fetch it could reach: `loadStyles`, `renderStylesTab`, `applyStyle`,
   `loadThemes`, `renderThemesTab`, `toggleTheme`, both `case` arms, the `this.styles` /
   `this.themes` fields. **Zero occurrences of `edit-board/styles` or `edit-board/themes` in the
   source and in the shipped artifact.** The trap test bites alone: restoring *only* the Apply
   Style button, with `tabData` left at three tabs, turns `edit-board-tabs.test.ts` red.
3. **Scope guard held.** `src/components/editor/` is a zero diff; none of the four typography /
   colour components appears anywhere in the widget.
4. **`/dashboard/teams` redirects** — 538 lines reduced to a 25-line server component calling
   `redirect("/dashboard/sites?notice=teams-moved")`. See finding 5.
5. **Artifact rebuilt, not hand-edited.** `--check` exits 0, and the stronger check passes:
   re-running `npm run build:embed` yields a byte-identical file.

## The nav tests genuinely pin absence
Re-adding the exact `Teams` `NavItem` and the `Users` import turns **6 of 32 tests red** — four
entitlement states, the still-loading state, and an href assertion
(`expect(hrefs).not.toContain("/dashboard/teams")`) that also catches a re-add under a different
label and carries a guard so it cannot pass on a nav that rendered nothing. This is not "stopped
asserting presence".

## The gzip claim is comparable and correct
All four figures reproduce: Node zlib L9 **46,875 → 45,894 (−981)**; `gzip -9c FILE` 46,781 →
45,809; `gzip -9c < FILE` 46,767 → 45,795; raw 174,420 → 168,541. The commit names the gate's
method first and explicitly retracts an earlier −958 that had mixed a piped *before* with a
file-argument *after*. Nothing to charge.

## Findings (all minor)
1. `graveyard-components-unreachable.test.ts` scans `src/app/**` only. AC3 says "no dashboard
   route *renders*" — a resurrection one hop through `src/components/**` would pass the scan.
   Latent, not live: no file under `src/components/**` imports any of the four today.
2. The design's teal recolour of the widget tab bar was not applied. Disclosed. Worth knowing
   when closing it: **the design's premise is itself wrong** — `.rcf-eb-tab.active` uses
   `rgba(255,255,255,0.08)` / `#f1f5f9`, not `#3b82f6`; the blue is on `.rcf-eb-btn-primary` and
   `.rcf-eb-checkbox:checked`.
3. The notice names the Share panel in prose rather than linking it. Justified (no
   `/dashboard/sites/[id]` exists) and disclosed.
4. `FlaskConical` import removal is outside plan scope — already unused on `main`, a warning not
   an error. Disclosed.
5. The build emits `/dashboard/teams` as a **statically prerendered page**, not an HTTP redirect:
   `teams.meta` carries no `Location`/307, there is no `<meta refresh>`, and the redirect lives
   in the RSC payload as `NEXT_REDIRECT;replace;/dashboard/sites?notice=teams-moved;307`. AC2
   holds either way, but "the URL redirects" is doing more work in the commit message than the
   artifact demonstrably does. One browser check settles it.
6. Nit: `.rcf-eb-btn-success` is now defined and used nowhere — four dead CSS lines. `s06c` owns
   bytes.

## Not verified
Nothing was opened in a browser and no real session existed. Sign in and follow
`/dashboard/teams` to confirm the landing and whether the shell flashes first (finding 5);
render the notice at 390px and desktop in all four list states to check the dismiss button does
not collide with the text; load the widget on a staging page, open the Edit Board, confirm three
tabs, select two elements and check the sticky bar has no orphaned empty action row, with the
network tab open to confirm no `/edit-board/styles*` or `/edit-board/themes` request. Playwright
never ran — `e2e/dashboard.spec.ts:37` still visits `/dashboard/teams` but only asserts the
unauthenticated `/login` redirect, so it needs no update. The frozen API routes were exercised
only through Jest with mocked Supabase, and the AC8 invite path was never walked end to end.

## Verdict
Max severity: minor
Ship allowed: yes
