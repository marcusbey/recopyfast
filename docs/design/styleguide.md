# ReCopyFast Style Guide

The single source of truth for visual decisions. Tokens live in `src/app/globals.css`;
fonts are injected in `src/app/layout.tsx`. If a value is not derivable from this
guide, it does not belong in the codebase.

## 1. Fonts

| Face | Variable | Use | Never |
|---|---|---|---|
| Instrument Sans | `--font-sans` (default on `body`) | All UI, body copy, forms, dashboards | — |
| Bricolage Grotesque | `--font-display` (`font-display` utility) | Marketing headlines only: landing `h1` and section `h2` | UI chrome, prose, dashboards |
| JetBrains Mono | `--font-mono` | Machine strings: tokens, IDs, embed snippets | Prose |

Weight carries hierarchy: **400 / 500 / 600**. `font-bold` (700) is reserved for
marketing display text; the landing hero may go up to 800. Never jump 400 → 700 in UI.

## 2. Color

**One accent: deep teal** (`--accent-solid`, exposed as `primary`). There is no
second brand color. No blue→purple gradients anywhere — including logos, buttons,
icon tiles, favicons, and OG images. The brand mark is the `<>` glyph on a solid
`primary` tile (`bg-primary text-primary-foreground rounded-xl`).

- **Greys:** always the cool hue-200 family via tokens — `text-foreground`,
  `text-muted-foreground`, `bg-background`, `bg-card`, `bg-surface-1/2/3`,
  `border-border`. Never Tailwind `gray-*`, `zinc-*`, `neutral-*`, `stone-*`.
- **Links / interactive text:** `text-primary hover:underline` (or Button
  `variant="link"`). Never `text-blue-600`.
- **Status:** the `tone-*` triplets (`bg-tone-success-surface text-tone-success-text
  border-tone-success-border`, same for info/warning/danger/neutral/accent).
  Color signals state, never category. Never raw `green-100`, `red-500`, `emerald-*`.
- **Marketing exception:** the landing, demo, privacy, and terms pages sit on the
  WebGL sky and may use the legacy `sky-*` / `slate-*` palette for text and washes.
  Accent moments on marketing still use teal or `sky` — never emerald, purple, or a
  second saturated hue.

## 3. Type scale

### Marketing (landing sections)

| Role | Classes |
|---|---|
| Hero h1 | `font-display font-extrabold` + existing clamp (Hero.tsx owns it) |
| Section h2 | `font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900` |
| Section intro | `text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl` |
| Card/step h3 | `text-2xl font-semibold text-slate-900` |
| Eyebrow | `text-sm font-semibold uppercase tracking-[0.075em] text-sky-700` |

Every section h2 uses the **same** scale — no per-section `md:text-6xl` / `lg:text-7xl`
drift. Section header block: eyebrow → h2 (`mb-6`) → intro, centered, then content.

### App (auth, dashboard, billing, settings, blog, system pages)

| Role | Classes |
|---|---|
| Page title | `.text-display` |
| Panel/card title | `.text-title` (or CardTitle default) |
| Eyebrow/label | `.text-eyebrow` |
| Body | `text-sm text-foreground` / `text-sm text-muted-foreground` |
| Metrics | `.text-metric` + `.tabular` |

## 4. Spacing, alignment, radius

- Marketing sections: `py-24 sm:py-32`, container `max-w-6xl mx-auto px-6`
  (wider `max-w-7xl` only for full-bleed demos). Header block centered; body
  content left-aligned inside cards.
- App pages: content column `max-w-md` (auth) or dashboard shell; vertical rhythm
  in steps of 4 (`space-y-4`, `gap-6`).
- Radius: container softer than contents — `rounded-xl` cards, `rounded-md`/`rounded-lg`
  controls. Never uniform radius on everything, never `rounded-full` on non-pills.

## 5. Surfaces & shadows

- Cards use the `Card` component variants: `default` (shadow-sm), `outline`
  (structure without weight), `elevated` (dialogs only), `interactive` (whole card
  is a link). **No `shadow-lg`/`shadow-xl` on static panels.**
- Auth panels: `Card` with default variant — flat, quiet, no decorative shadow.
- Shadows come only from the tinted `--shadow-*` scale. Never a raw black shadow.
- Glass (`.glass`, `.glass-sheet`, `.solid-sheet`) is marketing-only, over the sky.

## 6. Buttons & controls

Only the six `Button` variants: `default` (teal), `destructive`, `outline`,
`secondary`, `ghost`, `link`. **Never override a Button's background with
className gradients.** Icon-in-input: `absolute left-3 top-1/2 -translate-y-1/2
size-4 text-muted-foreground` with `pl-10` on the Input.

## 7. Theme discipline (the auth-page bug)

Surfaces follow `color-scheme` via `light-dark()` tokens. Therefore:

- **Never hardcode light colors around token surfaces.** `bg-gray-50` page +
  `bg-card` panel = dark card floating on a light page in dark mode.
- A screen is either **fully token-driven** (auto light/dark — required for all
  app screens) or **pinned** with `data-theme` (marketing pages that must match
  the sky can pin light).
- Page canvas: `bg-background`. Never a hardcoded grey gradient.

## 8. Motion

One easing (`--ease-out`), two durations (`--dur-fast` 160ms, `--dur` 220ms).
Animate only `transform` / `opacity` / color / shadow. Use `.pressable` and
`.surface-interactive` helpers. No `transition-all`, no bespoke durations,
no entrance animations on auth/system pages.

## 9. Scope exceptions

- `src/components/demo/**` and anything under `[data-demo-surface]`:
  intentionally multi-brand demo content — leave untouched.
- Editor UI injected into **customer pages** (embed script context) cannot rely on
  app tokens; verify render context before converting hardcoded colors.

## 10. Copy

Sentence case for headings and buttons ("Send magic link", not Title Case On
Everything). No exclamation marks in success states, no "Oops!". Active voice,
plain language.
