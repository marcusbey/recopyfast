# Design System — RecopyFast

> **Captured, not designed.** Every token, component and rule below is read out of the running
> code as of 2026-08-16. Source of truth for values: `src/app/globals.css`. Source of truth for
> intent: [`design/styleguide.md`](./design/styleguide.md), which this file consumes and
> extends to the surfaces it did not cover.
>
> `/ks-design` reads this at every story. Inventing a component or token outside it is
> forbidden — compose with what exists, or report a **design system gap**.
>
> **Revised 2026-10-08 by `s66a-app-design-tokens-and-panels`** (the owner accepted the s66
> research recommendation as a whole). The revision covers:
> - app radius, borders, surfaces and elevation;
> - the popover token;
> - the control spec and the new primitives;
> - the dialog and code-block rules;
> - the shell values.
>
> Decisions: [ADR 050](./decisions/050-app-radius-is-two-semantic-tokens.md) (radius tokens) and
> [ADR 051](./decisions/051-form-selects-are-native.md) (selects). Evidence:
> [`research/s66-app-design-system.md`](./research/s66-app-design-system.md).
>
> Some values below are decided but not yet in the code. Each such value carries a **Status**
> naming the story that lands it: s66a (tokens, primitives, the two panels), s66c (site page and
> access) or s66b (page shell and per-page layout). Until that story merges, the code still shows
> the old value. Compose new work against the value in this document.

The identity is already strong and already consistent **where it is applied**. The work this
document exists to direct is not redesign — it is reach. Three surfaces ship to users and only
one of them is on-system:

| Surface | State | Evidence |
|---|---|---|
| **App** — dashboard, auth, billing, settings, blog | ✅ on-system | 2 violations across ~60 files |
| **Marketing** — landing, demo, privacy, terms | ✅ deliberately separate, documented | Legacy `sky-*`/`slate-*` on the WebGL sky, pinned light |
| **Email** — `src/lib/email/resend.ts` | ❌ **off-system** | `system-ui` stack, Tailwind slate hexes, zero brand accent |
| **Embed widget** — every customer site | ❌ **off-system** | **103 hardcoded hex colours**, 6 unlinked `<style>` blocks, 0 CSS variables |

---

## Tokens

Declared once in `src/app/globals.css` with `light-dark()`, so there is no duplicated dark
block to drift. `color-scheme: light dark` on `:root` follows the OS; `[data-theme]` pins.

### Colour

**One accent: deep teal.** There is no second brand colour anywhere in the product.

| Token | Light | Dark | Tailwind class |
|---|---|---|---|
| `--accent-solid` | `hsl(176 54% 28%)` | `hsl(174 48% 58%)` | `primary` |
| `--accent-on-solid` | `hsl(0 0% 100%)` | `hsl(200 30% 8%)` | `primary-foreground` |
| `--canvas` | `hsl(200 24% 98%)` | `hsl(200 18% 7%)` | `background` |
| `--surface-card` | `hsl(0 0% 100%)` | `hsl(200 15% 10%)` | `card` |
| `--surface-1 / 2 / 3` | `200 24% 97%` / `200 18% 94%` / `200 16% 90%` | `200 18% 8%` / `200 14% 14%` / `200 13% 18%` | `surface-1/2/3` |
| `--text-strong` | `hsl(200 22% 11%)` | `hsl(200 22% 96%)` | `foreground` |
| `--text-muted` | `hsl(200 11% 38%)` | `hsl(200 12% 68%)` | `muted-foreground` |
| `--line` | `hsl(200 15% 87%)` | `hsl(200 12% 21%)` | `border` — decorative |
| `--line-strong` | `hsl(200 13% 55%)` | `hsl(200 10% 40%)` | `input` — control boundary, clears 3:1 (SC 1.4.11) |
| `--danger-solid` | `hsl(358 60% 42%)` | `hsl(358 62% 62%)` | `destructive` |
| `--color-popover` / `--color-popover-foreground` (theme aliases) | `--surface-card` / `--text-strong` | same | `popover` / `popover-foreground`. **Added in s66a.** Before they existed, `bg-popover` resolved to nothing, so every dropdown and Select menu was transparent and overprinted the page (`designs/s66-app-design-system/current/sort-menu-1280.jpg`) |

Greys are **one family**: cool, hue 200. Never `gray-*`, `zinc-*`, `neutral-*`, `stone-*`.
Off-black in dark is `#0f1315`-ish, never pure black.

**Status tones — six triplets.** Colour signals *state*, never *category*.

`neutral` · `info` · `success` · `warning` · `danger` · `accent`, each with
`-surface` / `-text` / `-line`, exposed as `bg-tone-<name>-surface text-tone-<name>-text
border-tone-<name>-border`. Every status treatment in the product resolves to one of these, so
a status reads identically whether drawn as a dot, a bar or a badge.

**Marketing exception (documented, keep):** landing, demo, privacy and terms — plus the SEO
cluster routes `/compare` and `/compare/*`, `/cms-for/*`, `/for/*` and `/agencies/*` per
[ADR 020](./decisions/020-seo-clusters-on-marketing-surface.md) — sit on the WebGL sky and use
the legacy `--sky-*` / `--slate-*` palette. Accent moments there use teal or `sky` — never
emerald, purple, or a second saturated hue.

> ### ✅ Resolved: the SEO cluster pages are Marketing
>
> `s17` / `s18` / `s19` (`/compare`, `/cms-for`, `/for`, `/agencies`) render on the
> **Marketing** surface — `--sky-*` / `--slate-*`, pinned light, no app tokens.
> [ADR 020](./decisions/020-seo-clusters-on-marketing-surface.md), decided 2026-08-17.
>
> **What was actually unresolved:** the two governing documents disagreed —
> `architecture.md:299-309` names `s17`–`s19` under Marketing, while this document's own
> evidence table puts the one built precedent, `/blog`, under App (and the code agrees:
> zero `sky-*` classes in `blog/[slug]/page.tsx`). All three designs were drawn on
> **Marketing**; `s19` recorded the conflict as its design-system gap 2 and deferred it
> rather than designing against it. So the surface was applied without being decided.
> An earlier revision of this block said `s19` "was designed on the App surface" — that was
> wrong, and no design needs redrawing.
>
> Marketing wins because `s17`'s value comes largely from reusing `Pricing` / `Benefits` /
> `HowItWorks` / `FinalCTA`, and those components hardcode `sky-*` / `slate-*` and read no
> custom property. Reuse and app-token compliance are mutually exclusive here; the brief
> already chose reuse.
>
> **Consequences that land on this document:**
> - **The Marketing exception list below now covers these routes** — `s19`'s gap 1, closed.
> - **These pages have no dark mode.** That is now a stated property, not an oversight.
> - **`/blog` stays App-surfaced.** The inconsistency is accepted. The forward rule is a grep,
>   not a judgement: **routes that reuse `src/components/sections/*` are Marketing; everything
>   else is App.** `s19` is the noted exception — it is Marketing by engine and reader, and
>   deliberately reuses none of them (ADR 020 § Watch).
> - **Still open, and not `s19`'s to fix:** there is no marketing-surface `not-found.tsx` /
>   `error.tsx`, so an unknown `/for/<slug>` switches surface mid-navigation. Needs its own
>   story.

### Typography

| Face | Variable | Use | Never |
|---|---|---|---|
| Instrument Sans | `--font-sans` (body default) | All UI, body, forms, dashboards | — |
| Bricolage Grotesque | `--font-display` | Marketing headlines only — landing `h1`, section `h2` | UI chrome, prose, dashboards |
| JetBrains Mono | `--font-mono` | Machine strings: tokens, ids, embed snippets | Prose |

Injected by `next/font` in `src/app/layout.tsx`. Body carries
`font-feature-settings: "rlig" 1, "calt" 1, "ss01" 1` and antialiasing.

**Weight carries hierarchy: 400 / 500 / 600.** Never jump 400 → 700 in UI. `font-bold` (700)
is marketing display only; the landing hero may reach 800.

App type scale — use the utility, not ad-hoc sizes:

| Role | Class | Spec | Status |
|---|---|---|---|
| Page title | `.text-page-title`, rendered by `PageHeader` inside `PageShell`; one `h1` per page | **24/32**, 600, tracking `-0.015em`, `--text-strong` (was `.text-display`, `clamp(1.625rem, 1.35rem + 1.1vw, 2rem)`). `.text-display` is not repurposed: it stays the `/blog` h1 ([ADR 053](./decisions/053-page-frame-is-layout-plus-page-shell.md)) | in code (s66b1) |
| Panel, card and dialog title | `CardTitle`, `DialogTitle` | **16px** (`text-base`), 600, line-height 24 | s66a |
| Section title inside a panel | `.text-title` | `1.0625rem`, 600, tracking `-0.012em`; converges on 16px | 17px in code; 16px has no story (not in s66b: `.text-title` is pinned byte-identical) |
| Eyebrow / meta label | `.text-eyebrow` | `0.6875rem`, 600, uppercase, tracking `+0.075em` | — |
| Body | `text-sm text-foreground` / `text-muted-foreground` | 14/20, 400 | — |
| Small / meta | `text-xs` | 12/16 (timestamps, badges, helper text) | — |
| Code | `font-mono` in `CodeBlock` | 13/20 (`text-[0.8125rem] leading-5`) | s66a |
| Inline code | `font-mono text-xs` | 12, `bg-surface-2`, `rounded-control`, `px-1.5 py-0.5` | s66a |
| Metric | `.text-metric` + `.tabular` | 24/600; tabular numerals, so numbers do not change width as they change value | in code (the lead metric stays 40px) |

Display sizes get negative tracking; small labels get positive tracking. **No 700 anywhere in
the app**: rule R6 of `src/__tests__/design/page-shell-guard.test.ts` keeps `font-bold`,
`font-extrabold` and `font-black` off the app surface (in code, s66b2). Its one pending file is
s66c's `SiteDetailView`.

The research proposed a 13px "small" size. It is not adopted, because Tailwind's scale has no
13px step and every meta string in the app already uses `text-xs`. The only 13px text is code,
inside `CodeBlock`.

### Radius — app surfaces (s66a, ADR 050)

Straight and clean, per the owner: "avoid rounded corner as much as possible and keep it
straight and clean. like 'supabase' website" (2026-10-07). Stricter than Supabase, which keeps
8px controls and pill badges.

| Token | Value | Utility | Use |
|---|---|---|---|
| `--radius-container` | `0px` | `rounded-container` | Card, panel, dialog, sheet, menu and Select content, alert, code block, table, tabs list, skeleton, icon tile, sidebar item |
| `--radius-control` | `2px` | `rounded-control` | Button (every size), input, textarea, select, permission toggle tile, badge and chip, menu item, inline `code`, the close X |
| — | `9999px` | `rounded-full` | **Exceptions only:** `Avatar`, a status dot no larger than 8px and its pulse ring (the Badge `dot`, activity dots), a spinner (`animate-spin`), the WebKit scrollbar thumb |

- **Nothing else on an app surface:**
  - no bare `rounded` (a literal 4px, not driven by a token);
  - no `rounded-{xs,sm,md,lg,xl,2xl,3xl,4xl}`, corner and side forms included;
  - no `rounded-[n]` above 2px;
  - no inline `borderRadius` / `border-radius`.

  `src/__tests__/design/radius-guard.test.ts` enforces this from s66a, with a shrink-only
  baseline of today's offenders. s66b emptied its share (s66b2); the entries left are s66c's
  site components, and whichever of s66b2 and s66c merges last deletes the baseline and makes
  the guard zero-tolerance.
- **Nesting reads through borders and surface steps, not radius.** This replaces the
  2026-08-16 rule "container softer than its contents" on app surfaces.
- **Not exceptions** (they become square): circles around icons (use `IconTile`), progress bars,
  empty-state step numbers, pills and filter counts.
- **Marketing keeps the legacy scale**: `--radius: 0.75rem` drives `rounded-xs` through
  `rounded-2xl`. A marketing file that composes a `ui/*` primitive gets the square primitive;
  the owner accepted that on 2026-10-08. `/try` is Marketing.
- **`cn()` knows the two tokens** (tailwind-merge extension), so a call-site radius class
  replaces the primitive's instead of both shipping.

### Borders (s66a)

- **1px everywhere.** No `border-2` on app surfaces. A selected state is an accent border plus a
  tick, never a thicker border.
- **`border-border` (`--line`)** is decorative: containers, dividers (`border-t`, or an `h-px
  bg-border` element), table rules. It measures 1.45:1 on the card in dark and 1.34:1 in light.
- **`border-input` (`--line-strong`)** is the boundary of every interactive control. It clears
  3:1 (3.09 dark, 3.27 light).
- **The global `* { border-color: var(--line) }` reset lives in `@layer base`**, so an authored
  `border-*` colour utility always wins. Until s66a it was unlayered and silently overrode them
  all, which is why inputs drew at 1.45:1 and selected toggles never showed their accent border.
  The `[data-demo-surface]` `revert-layer` opt-out existed only to work around that. s66a
  removes it, and its before/after captures of the landing demo prove the demo is unchanged.

### Surfaces and elevation (s66a)

| Role | Class (token) |
|---|---|
| Page | `bg-background` (`--canvas`) |
| Panel, dialog, sheet | `bg-card` (`--surface-card`) |
| Menu, Select content, popover | `bg-popover` (`--surface-card`) |
| Inset: code block, table header, read-only value | `bg-surface-1` |
| Hover, selected row, active toggle | `bg-surface-2` (`accent`) |

- **Flat.** Static panels cast no shadow and never move. `Card` `default`, `outline` and
  `interactive` have no shadow; `interactive` changes only its border colour on hover.
  `.surface-interactive` (lift plus `shadow-md`) has left the app (in code, s66b2); marketing
  keeps it. Rule R5 of `page-shell-guard.test.ts` keeps hover shadows, `transition-shadow` and
  hover lifts out, and allows a static shadow only on what floats.
- **`shadow-md` only on what floats**: dropdown and Select menus, popovers, dialogs, sheets.
  `Card variant="elevated"` is for those surfaces only. Buttons have no shadow.
- **Overlay**: `bg-foreground/40`, no blur. Never `bg-black/*`.
- **Shadows are tinted with the surface hue**, never black at an opacity: `--shadow-a` and
  `--shadow-b` feed the `2xs`–`xl` scale.

### Spacing (4px base)

| Element | Value | Status |
|---|---|---|
| Control height | 40 (`sm` 32, `lg` 48, `xl` 56). The 40px touch rationale in `button.tsx` stands | in code |
| Form fields | 16 apart; label to control 6 | s66a |
| Dialog header | `px-6 pt-5 pb-4` | s66a |
| Dialog body | `px-6 pb-5`; sections 20 apart, divided by a 1px rule | s66a |
| Dialog footer | `px-6 py-3`, `border-t` | s66a |
| Panel (`Card`) padding | 24 (`px-6`, header `pt-5 pb-4`) | in code; 16 below 640 has no story yet (not in s66b) |
| Panel toolbar row | 48 tall, `border-b` | no story yet (not in s66b) |
| Page header to content | 24 (16 below 640): the `PageShell` gap | in code (s66b1) |
| Section gap | 24 (16 below 640) | in code (s66b1): the `PageShell` gap |
| Table header / row | 36 / 44, `px-4` | no story yet (no `Table` primitive: gap 8) |

Marketing keeps its own rhythm: sections `py-24 sm:py-32`, container `max-w-6xl mx-auto px-6`.
The auth column stays `max-w-md`.

### Shell (owner-approved 2026-10-08; in code (s66b1))

Two owners, one concern each ([ADR 053](./decisions/053-page-frame-is-layout-plus-page-shell.md)):
`src/app/dashboard/layout.tsx` owns width and gutters, and `PageShell` owns the page inside them.

- **Frame.** Sidebar 256px (unchanged). Header **56px** (from 64), opaque `bg-card`, no blur;
  the sidebar's brand row is 56px too, so their bottom rules meet in one line.
- **Content.** `max-w-[1180px] mx-auto`, gutters **16 / 24 / 32** at <640 / ≥640 / ≥1024. No page
  nests a second container (Billing's `container mx-auto px-4` goes).
- **Page header.** One `PageShell` per page, which renders the page's one `PageHeader`: the h1 on
  the left; actions **centred on the title row** at ≥640, and in their own row after the
  description below 640 (DOM order stays title → description → actions). An optional `nav`
  (underline tabs) sits below it, with `border-b`. Centred, not bottom-aligned: at 768 a
  two-line description pushed bottom-aligned actions away from the title they act on.
- **Sections.** The direct children of `[data-page-shell]`, 24px apart (16 below 640), each on
  the content's left edge. Never wrap them in one extra div.
- **Filter row.** Starts at the same left edge: `flex flex-wrap gap-2`, search
  `flex-1 min-w-[12rem]`. A filter never hides options behind a hidden scrollbar.
- **Alignment.** Headings, filters, panels and tables share one left edge.

### Controls (s66a)

| Control | Spec |
|---|---|
| Button | `rounded-control`, no shadow. Heights 40 / 32 / 48 / 56; icon 40 / 32 / 48 square |
| Input, Textarea | 40 (textarea `min-h-20`), `rounded-control`, `border-input`, `bg-card`, `px-3`, hover `border-foreground/40`, disabled `bg-surface-2` at 60% |
| NativeSelect | Input's box, plus `appearance-none pl-3 pr-9`. Chevron: 16px `ChevronDown`, its right edge **12px** inside the border (`right-3`), vertically centred, `text-muted-foreground`, `pointer-events-none`. Option text never runs under it |
| Select (Radix) trigger | Identical to NativeSelect when closed. The chevron is a flex item inside `px-3`, which also puts it 12px from the edge |
| Permission / option toggle | 40 tall, `rounded-control`, 1px `border-input`. Selected: `border-primary`, `bg-tone-accent-surface`, a tick |
| Tabs | Underline style: list `border-b`, triggers 40 tall, active trigger a 2px `primary` bottom border with `text-foreground`. The list wraps when narrow; it never clips behind a hidden scrollbar |
| Badge | `rounded-control`, 1px tone border, 12px text. The dot stays round |

### Motion and focus

- **Motion: one easing, two durations.** `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`,
  `--dur-fast: 160ms`, `--dur: 220ms`. Animate only `transform` / `opacity` / colour / shadow.
  Helper: `.pressable`. No `transition-all`, no bespoke durations, no entrance animation on auth
  or system pages.
- **Focus is a requirement:** `:focus-visible` draws a 2px `--accent-solid` outline at 2px
  offset, globally. Components add `ring-2 ring-ring ring-offset-2 ring-offset-background`.
  Because radius is 0 or 2px, **every focus indicator is square**. On app surfaces use
  `focus-visible:`, never `focus:`. Do not remove the indicator per component.

---

## Available components

`src/components/ui/`: 18 primitives today, and s66a adds `NativeSelect`, `Textarea` and
`CodeBlock`. This is the floor. Compose from it.

> **Correction (2026-08-16).** An earlier revision of this table listed `Select` among the
> Radix-wrapped primitives. **`src/components/ui/select.tsx` does not exist** —
> `@radix-ui/react-select` is a declared dependency imported by zero files. Three story designs
> and one plan were written against the phantom component before the error was caught; each has
> been repointed. It is recorded as gap 6 below. Verify a primitive exists before composing
> with it; this table is evidence, not memory. (Gap 6 has since closed: s16 shipped
> `select.tsx`.)

The s66a shape of each primitive is below. Status "s66a" means the primitive changes, or is
created, in that story.

| Component | Variants | Usage | Status |
|---|---|---|---|
| `Button` | `default` `destructive` `outline` `secondary` `ghost` `link` × `default` `sm` `lg` `xl` `icon` `icon-sm` `icon-lg` | Every action. `rounded-control` at every size, no shadow. **Never override its background with a className gradient** | s66a |
| `Card` | `default` `elevated` `outline` `ghost` `interactive` × padding `default` `sm` `lg` | Every panel. `rounded-container`, 1px `border`, flat. `default` has no shadow. `elevated` (`shadow-md`) is for floating surfaces only. `interactive` (the whole card is a link) changes its border colour on hover and never lifts. `CardTitle` is 16/600 | s66a |
| `Badge` | `default` `secondary` `destructive` `outline` `tone-*` × `default` `sm` `lg` | Static labels. `rounded-control`; the `dot` stays round | s66a |
| `StatusBadge` | `neutral` `info` `success` `warning` `danger` `accent` | **Any state.** Used in 11 files; prefer it over a hand-rolled Badge for status. Inherits Badge's square shape | s66a (via Badge) |
| `Alert` | `default` `info` `success` `warning` `destructive` | Inline feedback, `rounded-container`. The product has no toast (gap 1) | s66a |
| `Input` | — | Text entry, spec in "Controls". Icon-in-input: `absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground` + `pl-10` | s66a |
| `Textarea` | — | **New.** Multi-line entry, Input's spec, `min-h-20`, `resize-y`. No reachable app consumer yet; it exists so the next form does not hand-roll one | s66a |
| `NativeSelect` | — | **New.** Every form select ([ADR 051](./decisions/051-form-selects-are-native.md)). Native `<select>` inside a wrapper that draws the chevron 12px inside the border. Keeps OS pickers and `selectOptions`. Props pass to the `<select>`, so `<Label htmlFor>` works | s66a |
| `Select` | Radix: trigger, value, content, item | Only when an option needs custom rendering. The trigger matches NativeSelect closed. Content is `bg-popover`, `rounded-container`, `shadow-md`; items are `rounded-control` | s66a |
| `DropdownMenu` | Radix | Row actions, sort. Content is opaque `bg-popover`, `rounded-container`, 1px border, `shadow-md`; items are `rounded-control` | s66a |
| `Tabs` | Radix | Underline style, spec in "Controls" | s66a |
| `Dialog` | `DialogContent` `DialogHeader` `DialogBody` `DialogFooter` `DialogTitle` `DialogDescription`, `showClose` | Every modal. `DialogBody` is **new**. Layout rules under "Dialogs and sheets" | s66a |
| `CodeBlock` | `value`, `label`, `wrap` (default `true`) | **New.** Every machine string a person must copy: snippets, tokens, examples. Rules under "Code blocks" | s66a |
| `Label` | — | Always paired with an input | — |
| `Avatar` | Radix | Circle, the radius exception | — |
| `Skeleton` | — | Loading, shaped like the content. Square: `.skeleton` and `skeleton.tsx` | s66a |
| `EmptyState` | icon slot | Zero-data state. Its step numbers are square | s66a |
| `PageShell` | `title` `eyebrow` `meta` `description` `actions` `nav` | **New.** The page inside the dashboard frame ([ADR 053](./decisions/053-page-frame-is-layout-plus-page-shell.md)). Renders `PageHeader`, then `nav`, then the page's sections as direct children of `[data-page-shell]`, 24px apart (16 below 640). Never sets width or gutters: the layout owns them. Every routed dashboard page renders exactly one, itself or through a listed delegate; `page-shell-guard.test.ts` enforces it. No new slot without an ADR 053 amendment | s66b1 |
| `PageHeader` | — | Rendered by `PageShell` only (the guard forbids it elsewhere). The page's one `h1` in `.text-page-title`, an eyebrow, `meta` inline after the title, a `description` node, and actions centred on the title row (after the description below 640). `SectionHeader` (h2) lives in the same file | s66b1 |
| `Metric` | icon slot | A number with a label, `.text-metric .tabular`. Square from s66a. Flat from s66b2: no `.surface-interactive`; a linked metric changes its border colour only (`hover:border-primary/40`, as Card `interactive`) | s66a / s66b2 |
| `IconTile` | `neutral` `accent` `info` `success` `warning` `danger` × `sm` `default` `lg` | The brand's icon container, square. Use it instead of a circle around an icon. `bg-primary text-primary-foreground` for the `<>` mark | s66a |
| `ContentValue` | — | Rendering stored content safely. Square | s66a |

**Brand mark:** the `<>` glyph on a solid `primary` tile. No gradient, ever — including logos,
favicons and OG images.

---

## UI patterns

### Forms

`Label` + `Input` + `Button`, in a `Card` with the `default` variant — flat, quiet, no
decorative shadow on auth panels. Errors render as `<Alert variant="destructive">` above the
form (`src/components/auth/LoginForm.tsx:119-122`). Auth error copy is centralised in
`src/components/auth/auth-errors.ts` — never inline a raw Supabase error string.

### States

Every data view needs all four, and they are distinct components, not conditional text:

| State | Pattern |
|---|---|
| Loading | `Skeleton` in the shape of the content, not a spinner |
| Empty | `EmptyState` — icon, one line of what this is, one action |
| Error | `Alert variant="destructive"` with what failed and what to do |
| Success | `StatusBadge` or an inline `Alert variant="success"` |

**Empty is never how an error renders.** `useSites.ts` carries this rule: a failed fetch
falling through to an empty list renders "No sites found", which reads to a customer as *your
account is empty* rather than *we failed*.

### Feedback

Inline only, via `Alert`, positioned next to what it concerns. There is **no toast primitive**
in the codebase — do not add one inside a story; report it as a design system gap.

### Dialogs and sheets (s66a)

The rules below exist because of one bug. `DialogContent` was a grid, and a grid item keeps
`min-width: auto`. One unwrapped 300-character `<pre>` therefore set the column to 2,524px inside
a 588px panel. That centred the header off-screen (the "tall empty band") and pushed the Copy
button out of view, on all 12 dialog call sites (s66 research fact 1).

- **Anatomy.** `DialogContent` (the frame) holds, in order, `DialogHeader`, `DialogBody` and an
  optional `DialogFooter`.
- **`DialogContent`**:
  - a flex column, `max-h-[90dvh]`, `rounded-container`, 1px `border`, `bg-card`, `shadow-md`;
  - `overflow: hidden`: **it never scrolls**;
  - widths 448 / **512** (default) / 640 / 768 via `max-w-*`, inside `w-[calc(100%-2rem)]`.
- **`DialogBody`** is the **only scroll container**: `flex-1 min-h-0 overflow-y-auto
  overscroll-contain px-6 pb-5`. Every direct child has `min-width: 0`.
- **Header**: title 16/600 and description 14 muted, **left-aligned at every width**, never
  centred. The close X sits top right, 16px in (`showClose`).
- **Footer**: `border-t`, buttons right-aligned, primary last.
- **A `<form>` that spans body and footer** must itself be the flex region:
  `className="flex min-h-0 flex-1 flex-col"`. Otherwise `DialogBody` is no longer a direct flex
  child, `flex-1 min-h-0` stops working, and the whole form overflows the frame.
- **Below 640px the dialog is a bottom sheet.** It runs full width, anchored to the bottom edge,
  `max-h-[92dvh]`, with a top border only. Header, body and footer paddings drop to 16px
  (`px-4`), matching the page gutter. Footer buttons stretch full width, primary on top.
- **Nothing inside a dialog is wider than its body.** Long strings wrap
  (`overflow-wrap: anywhere`) or scroll inside their own block (`CodeBlock wrap={false}`), never
  the panel. The rule recurses: any nested grid holding a string that cannot wrap (a truncated
  label, an email, an id) uses a `minmax(0,1fr)` track, and any flex row gives that child
  `min-w-0`. Otherwise the same `min-width: auto` bug comes back one level down. The s66a mockup
  reproduced it in its own link-card list before the fix.
- **Call sites pass no layout classes to `DialogContent`**: no `overflow-*`, `max-h-*`,
  `rounded-*`, padding or `grid`. Width (`max-w-*`) is the only override. A source-scan test
  enforces it.
- **Side sheet.** `VersionHistoryPanel` is still hand-rolled (right side, full height, header
  with `border-b`, one scrolling list). s66a aligns its overlay (`bg-foreground/40`), border and
  shadow (`shadow-md`). A side-sheet variant of the primitive is gap 12.

### Code blocks and machine strings (s66a)

- **`CodeBlock`**: `rounded-container`, 1px `border`, `bg-surface-1`.
- **Label bar**: 40px tall with a `border-b`, so a 32px `sm` button sits 4px from its edges.
  The label sits on the left (`text-eyebrow`, e.g. "HTML"). A **visible** `sm` outline "Copy"
  button sits on the right, never hover-only, because touch has no hover. After a successful write the button reads "Copied" for 2s. On a failed
  write it says so and never shows "Copied".
- **Body**: `font-mono` 13/20, `px-4 py-3`, `white-space: pre-wrap; overflow-wrap: anywhere` by
  default, so a snippet can be read in full at 320px. `wrap={false}` switches to
  `overflow-x: auto` inside the block only; the panel never scrolls sideways.
- **What is copied**: the exact source string. Display may differ from it only by wrapping.
- **Screenshots, mockups and docs never show a real site token.** Write
  `data-site-token="•••"`.

### Theme discipline (the auth-page bug)

Surfaces follow `color-scheme` via `light-dark()`. Therefore a screen is either **fully
token-driven** (auto light/dark — required for every app screen) or **pinned** with
`data-theme` (marketing pages matching the sky). Mixing them is the bug: `bg-gray-50` page +
`bg-card` panel = a dark card floating on a light page in dark mode.

### Copy

Sentence case for headings and buttons — "Send magic link", not Title Case On Everything. No
exclamation marks in success states, no "Oops!". Active voice, plain language.

This matters more here than in most products: the PRD's angle 5 requires the invited-editor
surface to be re-learnable from zero by someone who uses it four times a year. That constraint
disqualifies sidebars, modes and settings from that surface entirely.

---

## Surface reach — where the system does not yet go

The identity is not the problem. Its reach is. These are captured as **gaps with evidence**,
not as new design work.

### Email — off-system

`src/lib/email/resend.ts` sends two templates (staging access code, editor verification code).
Both hand-roll their markup and use:

- `font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif` — not Instrument Sans
- `#0f172a`, `#475569`, `#94a3b8`, `#f1f5f9` — Tailwind **slate**, not the cool hue-200 family
- **no teal anywhere** — a customer's first contact with the brand carries none of it
- duplicated markup across both templates, so they will drift

What on-system means here, since email cannot use CSS variables or webfonts reliably:

- One shared shell — header with the `<>` mark on a `#218078`-equivalent teal tile, body, footer
  — parameterised by content, so two templates cannot diverge.
- Literal hex values **derived from the light-theme tokens**, written once as constants in the
  email module: canvas `hsl(200 24% 98%)`, card `#ffffff`, text `hsl(200 22% 11%)`, muted
  `hsl(200 11% 38%)`, line `hsl(200 15% 87%)`, accent `hsl(176 54% 28%)`.
- Font stack `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` — Instrument
  Sans will not load in most clients, so **do not fake it**; match weight and spacing instead.
- The verification code keeps `--font-mono` semantics: monospace, tabular, wide letter-spacing.
  It is a machine string.
- Light only. Do not attempt `prefers-color-scheme` in email.
- Every email keeps a plain-text part. `s15-agency-digest` already makes "renders correctly as
  plain text" an acceptance criterion — that applies to all of them.

### Embed widget — off-system, and structurally unable to be on-system today

`public/embed/recopyfast.src.js` renders the Edit Board and the editing chrome on **every
customer site** — the surface most users of this product will actually see. Measured:

- **103 hardcoded hex colour occurrences**, ~25 distinct values.
- The palette is stock Tailwind: `#94a3b8` ×21, `#e2e8f0` ×12, `#f1f5f9` ×11, `#64748b` ×8.
- It includes hues the styleguide **forbids outright**: `#3b82f6` (blue-500), `#8b5cf6`
  (violet-500), `#6366f1` (indigo-500), `#10b981` (emerald-500).
- **Zero teal.** The brand accent does not appear on the product's most-seen surface.
- Fonts: `ui-sans-serif, system-ui` — not the brand face.
- **Six separate `<style>` injection sites** (`:1069`, `:1695`, `:2179`, `:3450`, `:3915`,
  `:5194`) and **no CSS custom properties at all**. There is no single place a colour can be
  changed, which is why it drifted and why it will drift again.
- No shadow DOM (`attachShadow` count: 0), so the widget's CSS and the host page's CSS share a
  cascade. Class names are namespaced `rcf-*`, which is what currently prevents collisions.

`styleguide.md:110-112` is right that the widget cannot rely on app tokens — `globals.css` does
not exist on a customer's page. It does not follow that it cannot be on-brand. The fix is a
**widget-local token block**: one `--rcf-*` custom-property set injected once, with the six
style blocks referencing it.

Two things make this cheap rather than speculative:

1. It is **byte-negative**. 103 repeated hex literals collapse to ~20 variable declarations
   plus short `var(--rcf-*)` references — which serves `s06-embed-budget-gate`, currently
   34,063 gz against a 24,000 target. Do this *inside* `s06`, not as separate work.
2. Widget-local tokens are also what makes a **dark Edit Board** or an agency's branded accent
   possible later without touching six style blocks.

Constraint that stays: the widget must never inherit the host page's fonts or colours
unintentionally, and must never restyle the host page. `font-family: inherit` appears
deliberately in places where editing UI must match the customer's text — verify the render
context before converting any given value.

---

## Do / Don't

✅ **Do**

- Compose from `src/components/ui/`. Report a gap; never invent a primitive beside it.
- Use `StatusBadge` and the `tone-*` triplets for every state. Colour signals state.
- Use `.text-display` / `.text-title` / `.text-eyebrow` / `.text-metric` for app type.
- Keep app screens fully token-driven so light/dark works with no per-screen thought.
- Put numbers in `.tabular`.
- Give every data view all four states: skeleton, empty, error, success.
- Sentence case. Plain language. Active voice.
- Derive email and widget colours **from these token values**, written as literals with a
  comment naming the token they came from.
- Square containers (`rounded-container`) and 2px controls (`rounded-control`) on every app
  surface.
- Keep shadows for what floats (menus, popovers, dialogs, sheets).
- Give every dialog exactly one scroll container, `DialogBody`.
- Keep copy buttons and row actions visible at rest. A touch screen has no hover.
- Use `NativeSelect` for form choices.
- Use `CodeBlock` for anything a person must copy.

❌ **Don't**

- No second brand colour. No blue→purple gradient anywhere — logos, buttons, icon tiles,
  favicons, OG images included.
- No `gray-*` / `zinc-*` / `neutral-*` / `stone-*`. No raw `green-100` / `red-500` /
  `emerald-*`. (Two live violations to clean when next in the file:
  `src/components/layout/Footer.tsx:144`, `src/components/editor/ElementTagBadge.tsx:35`, both
  `bg-emerald-500` — should be `tone-success` / `bg-primary`.)
- No `text-blue-600` for links. `text-primary hover:underline` or `Button variant="link"`.
- Never override a `Button` background with a className gradient.
- No shadow on static panels, and no hover lift. No raw black shadow (`bg-black/*` overlays
  included).
- On an app surface: no legacy radius (bare `rounded`, `rounded-{xs…4xl}`, `rounded-[n>2px]`),
  and no `rounded-full` outside the listed exceptions.
- No `border-2`. No `focus:` rings where `focus-visible:` is meant.
- No `overflow-*`, `max-h-*`, padding or radius classes on `DialogContent`. No centred dialog
  headers.
- No raw `<select>` on app surfaces. No `appearance`-default chevron jammed against a border.
- No hover-only action (`opacity-0 group-hover:…`) for anything a touch user needs; this is how
  Delete became unreachable on phones (s66c).
- Never hardcode a light colour around a token surface — that is the auth-page bug.
- No `transition-all`, no bespoke durations, no entrance animation on auth or system pages.
- Never jump weight 400 → 700 in UI.
- Never use `font-display` (Bricolage) outside marketing headlines.
- Never add a new hardcoded hex to `recopyfast.src.js`. It already has 103; the next one is
  what stops the token conversion from ever paying off.

### Scope exceptions — leave alone

- `src/components/demo/**` and anything under `[data-demo-surface]`: intentionally multi-brand
  demo content. `globals.css` opted it out of the unlayered border reset via `revert-layer`.
  Once s66a moves the reset into `@layer base`, the opt-out is redundant; it is removed only
  after before/after captures show the demo unchanged.
- Landing / demo / privacy / terms on the legacy `sky-*` / `slate-*` palette over the WebGL sky.

---

## Open design system gaps

Report-only. None of these gets filled freestyle inside a story.

1. **No toast/transient feedback primitive.** Everything is inline `Alert`. A story needing
   non-blocking confirmation has nowhere to put it.
2. **Form fields carry no `aria-invalid` / `aria-describedby`.** Errors render in a sibling
   `Alert` with no programmatic association, so a screen reader does not tie the message to the
   field. Affects every form in the product.
3. **Email has no shared shell** — two templates, duplicated markup, off-palette.
4. **Widget has no token layer** — see above. Fold into `s06`.
5. **No documented dark-mode treatment for the widget or email.** App handles it; these two
   have no answer, and the widget sits on customer pages that may be either.
6. ~~**No `Select` primitive**~~ — **closed by `s16`**, which shipped
   `src/components/ui/select.tsx` as a genuine Radix wrapper. It was the first of the four
   stories wanting one to reach execution, as this gap asked.
   **Inherited caveat, found at review:** it drifts from `Input` — `select.tsx:32` uses
   `bg-transparent` where `input.tsx:18` uses `bg-card`, and it omits `focus-visible:border-ring`
   and `focus-visible:ring-offset-background`. Inside a `Card` the two render identically, so
   `s16`'s own form is fine — but **`s05` (format), `s10` (range) and `s14c` (three filters) will
   inherit it on other surfaces**, where the difference shows. Align it with `Input` before the
   second consumer lands, not after. `SelectContent`/`SelectItem` match `dropdown-menu.tsx`
   correctly and need no change.
   **Caveat closed by s66a.** The trigger moves to `bg-card`, `rounded-control` and Input's
   focus treatment. Both menus become opaque once `--color-popover` exists. Form selects use
   `NativeSelect` (ADR 051).
7. **No chart or timeline primitive.** `s03` (funnel), `s10` (impression timeline) and `s12`
   (progress toward sample) each compose one from tokens directly. `s10`'s inline SVG documents
   which tokens it uses so a primitive can be extracted from it rather than invented.
8. **No `Table` primitive.** `s05`'s per-row outcome report and `s16`'s delivery history both
   compose semantic `<table>`/`<ul>` from tokens. Promote if a third screen needs it.
9. **No "gated feature" pattern.** `s09` composes Lock icon + outline Badge + upgrade banner;
   `s11b` and `s13` need the same answer. Codify once one ships.
10. ~~**`DialogContent` hardcodes the close-X**~~. **Closed:** `showClose` exists
    (`dialog.tsx`) and the s16 show-once secret dialog uses it.
11. **No irreversible-action confirmation pattern.** `s20`'s subdomain claim uses type-to-confirm;
    site deletion presumably has its own. Reconcile them.
12. **No side-sheet primitive.** `VersionHistoryPanel` hand-rolls a right-side sheet with its
    own focus and Escape handling. s66a only aligns its tokens. Whether it becomes a
    `DialogContent` variant (Radix focus trap) is decided where version history lands in the
    site page (s66c).
13. **The open state of a `NativeSelect` belongs to the OS.** It cannot be styled or
    screenshotted (CDP captures omit it). Designs show the closed control only. If an option
    ever needs an icon or a description, that is the case for Radix `Select` (ADR 051).
