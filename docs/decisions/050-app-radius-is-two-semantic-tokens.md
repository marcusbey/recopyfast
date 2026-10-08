# ADR 050 — App surfaces use two semantic radius tokens; the legacy scale stays with marketing

- Status: accepted
- Date: 2026-10-08
- Scope: s66a-app-design-tokens-and-panels
- Supersedes, for app surfaces only: the `docs/design-system.md` rule "Radius
  `--radius: 0.75rem` … container softer than its contents", and the comment that states it at
  `src/components/ui/card.tsx:7-15`. Marketing keeps both the rule and the scale.
- Numbering: 047 and 048 are taken on the unmerged `feature/s68-security-hardening` branch and
  049 on `feature/s67-embed-spa-support`. 050 is the next number free on every branch, following ADR 046's precedent. Renumber at merge
  if another ADR lands first.

## Context

The owner decided on 2026-10-08 that app containers have 0 radius and controls 2 px, with
badges square. The marketing files that compose `src/components/ui/*` square up as an accepted
side effect, but the marketing surface as a whole does not.

Today `--radius: 0.75rem` drives `--radius-xs` through `--radius-2xl` in `@theme inline`
(`src/app/globals.css:195-200`). Every primitive uses that scale:

| Primitive | Radius |
|---|---|
| Card | 16 px |
| Dialog | 16–22 px |
| Button, Input | 9 px |
| Badge | pill |

The research (`docs/research/s66-app-design-system.md`, "Proposed design spec") proposed
remapping that scale (`xs`/`sm`/`md` to 2 px, `lg` through `4xl` to 0) and keeping the class
names, so that `card.test.tsx`'s `rounded-xl` assertion would still pass.

The remap cannot be scoped. `@theme inline` inlines the values into the utilities, so a value
holds everywhere, and overriding `--radius-*` on a subtree does nothing (research, "Traps").
Marketing uses the same utilities directly: 138 times outside `rounded-full`, counted on this
branch:

| Location | Count | Notably |
|---|---|---|
| `src/app/terms` | 34 | |
| `src/components/sections` | 27 | `rounded-xl` ×9, `rounded-2xl` ×9, `rounded-3xl` ×6 |
| `src/app/privacy` | 25 | |
| compare (components and pages) | 13 | |
| landing | 12 | |
| docs (components and pages) | 10 | |
| try, blog, layout, demo | 17 | |

A remap would square the whole marketing surface, which the owner did not accept.

The radius guard (s66a AC 3) adds a second force. It has to recognise "this class is the old
scale" in an app file. After a remap, `rounded-xl` would mean 0 and `rounded-md` would mean
2 px. The names would lie, and neither the guard nor a reader could tell what an author meant.

## Decision

Add two semantic tokens to `@theme inline`:

| Token | Value | Utility |
|---|---|---|
| `--radius-container` | `0px` | `rounded-container` |
| `--radius-control` | `2px` | `rounded-control` |

- **App surfaces.** App primitives and app-surface code use only these two tokens, plus
  `rounded-none` and the listed `rounded-full` exceptions (avatars, status dots up to 8 px,
  spinners).
- **Legacy scale.** `--radius` and `--radius-xs` through `--radius-2xl` stay exactly as they are,
  for marketing.
- **`cn()`.** It is extended with `extendTailwindMerge` (theme `radius: ["control",
  "container"]`), so a call-site `rounded-*` override replaces the primitive's radius instead of
  both classes shipping.
- **Guard.** `src/__tests__/design/radius-guard.test.ts` fails on the legacy scale in app-surface
  files, against a shrink-only baseline that s66b empties.

Marketing files that compose `ui/*` primitives get the square primitives (accepted side effect).
Their own classes keep the legacy scale.

## Considered options

- **Remap the legacy scale in `@theme inline`** (the research proposal). Rejected:
  - the change is global, so it squares 138 marketing occurrences the owner did not accept;
  - it makes class names lie (`rounded-xl` = 0), so a guard cannot tell intent.
- **Runtime-scoped remap.** Make radius a non-inline `@theme` value and override `--radius-*`
  under `html[data-surface="app"]`. Rejected:
  - the surface has to be stamped on `<html>`, because Radix portals render under `<body>`;
  - the shared root layout cannot know the surface without per-route-group layouts or a client
    effect (which flashes on first paint);
  - it keeps the lying names;
  - it leaves the marketing files that share primitives rounded, the opposite of the accepted
    side effect.
- **Literal per-component classes** (`rounded-none`, `rounded-[2px]`) with no tokens. Rejected:
  - no single place holds the scale, so "one radius scale" (AC 3) becomes a convention rather
    than a value the guard can read;
  - every arbitrary spelling needs its own guard rule.

## Consequences

- **Easier.**
  - The guard reads two token values.
  - Class names say what they mean.
  - Marketing changes only through the primitives it composes.
- **Harder.**
  - The legacy scale in app-surface files is rewritten by hand, not by one token edit. At
    research time there were 196 `rounded*` occurrences in 67 reachable app files, 38 of them
    `rounded-full`. s66a does the primitives and the two panels, s66b the rest.
  - The radius assertions in `card.test.tsx` and `badge.test.tsx` change, and the PR names them.
- **Watch.**
  - tailwind-merge v3 only recognises T-shirt sizes as radius values. Without the extension,
    `cn("rounded-container", "rounded-lg")` keeps both classes and CSS order picks the winner.
    A `cn` test pins the merge.
  - A marketing page that mixes square primitives with its own rounded cards can look mixed.
    s66a AC 9's before/after captures are where that is judged.
  - `--radius` still feeds the legacy scale. After s66b nothing on an app surface may reference
    it; `.skeleton` moves to the container token in s66a.
