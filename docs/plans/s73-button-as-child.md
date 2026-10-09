---
validated: yes
---
# Plan — Story s73-button-as-child

> CTO decision under the owner's 2026-10-09 directive ("don't ask me questions; take CTO-level
> decisions; implement everything left; test everything"): plan validated by the orchestrator.
> Fix the primitive the canonical shadcn/Radix way — `Slottable` — so the child element receives
> the merged className, ref and props.

One primitive, one test file. No API, data, embed or migration change. No new screen, so no
design doc; the call-site look changes are listed below instead.

## Research

In `docs/research/s73-button-as-child.md` (moved out of this plan at PR review).

## Task 1 — guard: the `<button>` markup does not move

In `src/components/ui/__tests__/button.test.tsx`, a characterization test asserting the exact
`innerHTML` of a non-`asChild` Button in three states: plain, with `leftIcon`/`rightIcon`, and
`loading` (spinner + dimmed label, icons dropped). Green on `main` by design — it pins today's
output — so its sensitivity is proven by mutation instead: drop the `opacity-70` span → red.

- [x] Task 1

## Task 2 — red: `asChild` gives the child the button

Same file, before touching `button.tsx`; run and watch each fail:
1. `<Button asChild variant="outline" size="sm" className="extra"><a href="/x" className="mine">`
   → the link has the base (`inline-flex`), variant (`border`), size (`h-8`), `extra` and `mine`
   classes, and keeps `href`.
2. The same with a `next/link` child → classes and `href` on the rendered `<a>`.
3. `leftIcon` / `rightIcon` render inside the `<a>`, in order: left, label, right.
4. `loading` → `aria-busy="true"` on the `<a>`, the spinner is its first child, `rightIcon` absent,
   the label is not wrapped in a span.
5. No `console.error` call while rendering `asChild` (spy) — the Fragment warning is gone.
6. Convert the two `it.failing` tests (`:149` className, `:250` ref) to plain `it`; update their
   comment to the tombstone (what broke, why `Slottable`).

- [x] Task 2

## Task 3 — fix the primitive

`button.tsx`: import `Slottable` beside `Slot`; render `Comp`'s children as `leftIcon` (or the
spinner when loading), `<Slottable>{label}</Slottable>`, `rightIcon` (none when loading), where
`label` is the dimmed span only when loading **and** not `asChild`. Props on `Comp` unchanged.
Tombstone comment on why the children are listed flat and why `Slottable` (AGENTS.md § Comments).
Task 1 and Task 2 green; full `button.test.tsx` green.

- [x] Task 3

## Task 4 — gates and mutation

- Mutation: with the fix staged, put `main`'s `button.tsx` back in the working tree (the Fragment
  around the children, no `Slottable`) → Task 2 red; restore from the index with
  `git checkout -- src/components/ui/button.tsx` → green.
- Full jest with the CI env, `type-check`, `type-check:build`, `lint` (0 errors), `format:check`,
  `npm run build:embed -- --check` (45828 / 33062 untouched), `npx playwright test --list` count
  (unchanged: no e2e added).

- [x] Task 4
