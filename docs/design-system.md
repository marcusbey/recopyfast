# Design System — RecopyFast

> **Captured, not designed.** Every token, component and rule below is read out of the running
> code as of 2026-08-16. Source of truth for values: `src/app/globals.css`. Source of truth for
> intent: [`design/styleguide.md`](./design/styleguide.md), which this file consumes and
> extends to the surfaces it did not cover.
>
> `/ks-design` reads this at every story. Inventing a component or token outside it is
> forbidden — compose with what exists, or report a **design system gap**.

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

Greys are **one family**: cool, hue 200. Never `gray-*`, `zinc-*`, `neutral-*`, `stone-*`.
Off-black in dark is `#0f1315`-ish, never pure black.

**Status tones — six triplets.** Colour signals *state*, never *category*.

`neutral` · `info` · `success` · `warning` · `danger` · `accent`, each with
`-surface` / `-text` / `-line`, exposed as `bg-tone-<name>-surface text-tone-<name>-text
border-tone-<name>-border`. Every status treatment in the product resolves to one of these, so
a status reads identically whether drawn as a dot, a bar or a badge.

**Marketing exception (documented, keep):** landing, demo, privacy and terms sit on the WebGL
sky and use the legacy `--sky-*` / `--slate-*` palette. Accent moments there use teal or `sky`
— never emerald, purple, or a second saturated hue.

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

| Role | Class | Spec |
|---|---|---|
| Page title | `.text-display` | `clamp(1.625rem, 1.35rem + 1.1vw, 2rem)`, 600, tracking `-0.023em` |
| Panel title | `.text-title` | `1.0625rem`, 600, tracking `-0.012em` |
| Eyebrow | `.text-eyebrow` | `0.6875rem`, 600, uppercase, tracking `+0.075em` |
| Body | `text-sm text-foreground` / `text-muted-foreground` | — |
| Metric | `.text-metric` + `.tabular` | tabular numerals — numbers must not change width as they change value |

Display sizes get negative tracking; small labels get positive tracking.

### Spacing, radius, shadow, motion

- **Radius `--radius: 0.75rem`**, scale `xs`(4px) → `2xl`(+10px). **Container softer than its
  contents**: `rounded-xl` cards, `rounded-md`/`rounded-lg` controls. Never uniform radius on
  everything; never `rounded-full` on a non-pill.
- **Rhythm in steps of 4** — `space-y-4`, `gap-6`. Marketing sections `py-24 sm:py-32`,
  container `max-w-6xl mx-auto px-6`. Auth column `max-w-md`.
- **Shadows are tinted with the surface hue**, never black-at-opacity — `--shadow-a/b` feed a
  `2xs → xl` scale. A raised card sits in the same light as everything around it.
- **Motion: one easing, two durations.** `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`,
  `--dur-fast: 160ms`, `--dur: 220ms`. Animate only `transform` / `opacity` / colour / shadow.
  Helpers `.pressable`, `.surface-interactive`. No `transition-all`, no bespoke durations, no
  entrance animation on auth or system pages.
- **Focus is a requirement:** `:focus-visible` draws a 2px `--accent-solid` outline at 2px
  offset, globally. Do not remove it per-component.

---

## Available components

`src/components/ui/` — 17 primitives. This is the floor. Compose from it.

| Component | Variants | Usage |
|---|---|---|
| `Button` | `default` `destructive` `outline` `secondary` `ghost` `link` × `default` `sm` `lg` `xl` `icon` | Every action. **Never override its background with a className gradient** |
| `Card` | `default`(shadow-sm) `elevated`(dialogs only) `outline` `ghost` `interactive` × `default` `sm` `lg` | Every panel. `interactive` when the whole card is a link |
| `Badge` | `default` `secondary` `destructive` `outline` × `default` `sm` `lg` | Static labels |
| `StatusBadge` | `neutral` `info` `success` `warning` `danger` `accent` | **Any state.** Used in 11 files — prefer it over a hand-rolled Badge for status |
| `Alert` | `default` `info` `success` `warning` `destructive` | Inline feedback. The product has no toast — see gaps |
| `Input` | — | Text entry. Icon-in-input: `absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground` + `pl-10` |
| `Label` | — | Always paired with an input |
| `Select` `Tabs` `Dialog` `DropdownMenu` `Avatar` | Radix-wrapped | Overlays and navigation |
| `Skeleton` | — | Loading. 7 files |
| `EmptyState` | icon slot | Zero-data state. 4 files |
| `PageHeader` | — | Dashboard page top — title + actions |
| `Metric` | icon slot | A number with a label. Pairs with `.text-metric .tabular` |
| `IconTile` | `neutral` `accent` `info` `success` `warning` `danger` × `sm` `default` `lg` | The brand's icon container. `bg-primary text-primary-foreground rounded-xl` for the `<>` mark |
| `ContentValue` | — | Rendering stored content safely |

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

❌ **Don't**

- No second brand colour. No blue→purple gradient anywhere — logos, buttons, icon tiles,
  favicons, OG images included.
- No `gray-*` / `zinc-*` / `neutral-*` / `stone-*`. No raw `green-100` / `red-500` /
  `emerald-*`. (Two live violations to clean when next in the file:
  `src/components/layout/Footer.tsx:144`, `src/components/editor/ElementTagBadge.tsx:35`, both
  `bg-emerald-500` — should be `tone-success` / `bg-primary`.)
- No `text-blue-600` for links. `text-primary hover:underline` or `Button variant="link"`.
- Never override a `Button` background with a className gradient.
- No `shadow-lg` / `shadow-xl` on static panels. No raw black shadow.
- Never hardcode a light colour around a token surface — that is the auth-page bug.
- No `transition-all`, no bespoke durations, no entrance animation on auth or system pages.
- Never jump weight 400 → 700 in UI.
- Never use `font-display` (Bricolage) outside marketing headlines.
- Never add a new hardcoded hex to `recopyfast.src.js`. It already has 103; the next one is
  what stops the token conversion from ever paying off.

### Scope exceptions — leave alone

- `src/components/demo/**` and anything under `[data-demo-surface]`: intentionally multi-brand
  demo content. `globals.css` even opts it out of the global border reset via `revert-layer`.
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
