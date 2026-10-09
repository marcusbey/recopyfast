# Review — s73-button-as-child

Reviewer: fresh-context `reviewer` subagent, 2026-10-09. Diff: `git diff origin/main...feature/s73-button-as-child`
(72f4cff → 57149a4; a68e1fc story + plan, validated by CTO decision under the owner's 2026-10-09 directive).

## Verdict summary

`Slottable` (`@radix-ui/react-slot` 1.2.3, the only installed copy) is the right fix and matches the plan line for
line. Without asChild nothing changes: a probe rendering main's and the branch's `button.tsx` side by side with
the real `cn` gives identical DOM and SSR output for 18 shapes, and main's server markup hydrates under the
branch with no mismatch. With asChild the child gets base, variant, size and call-site classes (twMerge resolves
call-site overrides), keeps its own props, composes click handlers (child first), and both refs reach the `<a>`;
a `next/link` child with icons hydrates cleanly. Only Button uses Slot in `src`; Radix triggers wrap a non-asChild
Button and are unaffected. The ten call sites read; no new overflow expected at 320–1920 (reasoned from CSS).

Gates: jest 381 suites / 4,950; `src/components/ui` 203; type-check (both) 0; lint 0 errors; `format:check` clean;
`build:embed -- --check` 45828 / 33062; Playwright `--list` 80. Mutations: main's `button.tsx` → 7 red; Fragment
re-wrap → 7; dimmed span dropped / misapplied, rightIcon while loading, aria-busy removed → red. Main's test file
on main logs the Fragment warning 3×; on the branch exactly the two `it.failing` tests go red — they encoded the
bug.

## Findings

**minor 1** — with asChild, `disabled` reached the `<a>` as `disabled=""` (invalid, stops no navigation, no
`aria-disabled`); a non-element child now renders nothing silently. No call site does either.
**minor 2** — "Open site page" is now a visible primary button drawn under "Close" below 640px
(`SiteRegistrationModal.tsx:437`, `flex-col`), against `design-system.md:375` "primary on top"; the docs claimed
all ten call sites pass a variant (this one takes the default).

## Fix pass `2ceb20a` — minors 1 and 2 (orchestrator)

With asChild `disabled` is not forwarded and development logs why; a child that is not exactly one element is
reported the same way (tests red first: no `disabled` attribute on the link, both warnings). The registration
footer is `flex-col-reverse` below 640px (primary on top; DOM and tab order unchanged). Docs corrected. jest
4,952 passed; `src/components/ui` 205. Reviewed by the orchestrator: behaviour without asChild untouched (the
markup guards still pass), the warning is development-only.

## Not verified

No browser render of the ten call sites (CI runs `app-layout` and `site-pages` e2e; check the
`site-registered-*` captures). Next's server-to-client path on `/docs/install` from a real build. `npm run build`
(CI).

## Devin Review on PR #78 — fixed in the follow-up commit

🟡 **Disabled slotted buttons remain clickable** (valid): withholding `disabled` from every asChild
child left `<Button asChild loading><button type="submit">` clickable. Button now forwards
`disabled`/`loading` to a native form-control child (`button`, `input`, `select`, `textarea`,
`fieldset`) and never to a link or component; the development warning fires only when `disabled`
cannot apply. Tests red first: a native button child is disabled when `disabled` and when
`loading`, with no warning; the link test still has no `disabled` attribute. `src/components/ui`
207 passed. Flag "Story research lacks its required file": research moved to
`docs/research/s73-button-as-child.md`. Reviewed by the orchestrator.

Max severity: minor
Ship allowed: yes
