# Design — Story s17-cluster-engine

> Surface decision (binding for this document — see rationale below): **marketing**, not app.
> `/alternatives/<competitor>` (and, by the same reasoning, `/cms-for`, `/for`, `/agencies` when
> `s18`/`s19` land) render on the legacy `sky-*` / `slate-*` marketing palette used by `/`, `/demo`,
> `/privacy` and `/terms` — hardcoded Tailwind utility classes, **not** the token-driven
> `bg-card`/`text-foreground` app surface, and **not** `[data-theme]` pinning either (see below).

## Why marketing, not app

Three independent reasons converge on the same answer, so this isn't a coin flip:

1. **`docs/architecture.md:299-309` names this exact story by number**: *"Marketing → `/`, `/blog`,
   and the SEO clusters `s17`–`s19` will add."* That's the one place in the docs that speaks to
   these routes specifically, and it puts them in Marketing.
2. **These pages are functionally landing-page content** — hero, a persuasive table, a CTA, an
   FAQ — built to convert a cold search visitor, not to serve an authenticated user a task. That's
   the same job `/` and `/demo` do, not the job `/dashboard` does.
3. **Practically decisive: the story asks these pages to reuse existing marketing sections**
   (see Reused components). `Pricing.tsx`, `Benefits.tsx`, `HowItWorks.tsx` and `FinalCTA.tsx` are
   *hardcoded* to `slate-*`/`sky-*` classes — none of them read a CSS custom property. Placing them
   next to `bg-card`/`text-foreground` app markup on one page is precisely the **auth-page bug**
   `docs/design-system.md:159-164` names: light/dark tokens mixed with a pinned-light hardcode.
   Reuse and app-token compliance are mutually exclusive here; the brief already chose reuse.

**Recorded, not resolved:** `docs/research/s17-cluster-engine.md`'s "Open questions" flags that
`docs/design-system.md`'s own evidence table puts `/blog` under **App** (✅ token-driven — and the
real `blog/page.tsx` / `blog/[slug]/page.tsx` code confirms it, zero `sky-*` classes) while
`architecture.md` groups blog with Marketing. That disagreement is real and this document does not
adjudicate it — blog is prose from a database, rendered through `sanitizeHTML`, with no hero/table/
FAQ shape; it is not evidence about template pages built from typed section data. This decision is
scoped to `/alternatives` only. See **Design system gaps**, item 3.

**One more explicit call: no `[data-theme]` pin.** Grepping the actual marketing pages
(`privacy/page.tsx`, `page.tsx`) shows none of them set `data-theme` — they hardcode `sky-*`/
`slate-*` Tailwind classes directly and never touch `light-dark()` tokens at all. `/alternatives`
follows the same real pattern, not the theoretical `[data-theme="light"]` mechanism
`design-system.md` mentions as *available*.

**One more explicit call: no `SkyBackground` / no `useLenis`.** The homepage's WebGL sky and
pinned-scroll rig (`src/components/three/sky/SkyBackground.tsx`, `useLenis`) are not reused here,
on purpose. Two reasons: (a) `docs/prd.md`'s SEO section says *"our own Core Web Vitals are a sales
argument"* and `s17`'s own AC 7 requires passing a Lighthouse CWV run **in CI, across five-plus
programmatically generated pages** — shipping a raymarched shader and a smooth-scroll library on
every one of them is a self-inflicted risk against the story's own acceptance criterion; (b) there
is already a real precedent for the sky palette *without* the WebGL rig: `privacy/page.tsx` and
(by inspection) `terms/page.tsx` both use `bg-gradient-to-b from-sky-50 to-white` with a plain
`Header`/`Footer` and no `SkyBackground`/`useLenis` import anywhere in either file. `/alternatives`
follows that precedent, not the homepage's — it's the closer structural match (long-scroll,
section-heavy, content-dense) and it is a composition of existing code, not an invention.

---

## Screen(s)

### 1. `/alternatives/<competitor>` — the comparison page template

One template, rendered from typed per-competitor data (content only — no route code per
competitor, per AC 8). Section order, top to bottom:

1. **Breadcrumb** — `Home / Alternatives / {Competitor}`. New (nothing in the codebase has a
   breadcrumb today), but it's three text links and two separators, not a component — see Reused
   components. This is also the visible surface `BreadcrumbList` JSON-LD describes; a
   `BreadcrumbList` schema with nothing rendered on the page would be exactly the kind of
   structured-data-doesn't-match-content problem the honesty requirement is trying to avoid
   elsewhere on this page.
2. **Hero** — eyebrow `"{Competitor} alternative"`, an `h1` at the documented **Section h2** scale
   (see "On the H1 scale" below), one paragraph of intro copy, two CTAs (`Start free trial` primary,
   `See the comparison` secondary — an in-page anchor down to the table, since the table *is* the
   artefact).
3. **Honest comparison table** — see below. This is the section the whole story is built to
   produce; it gets the most detailed spec.
4. **"Where {Competitor} wins"** — a dedicated section, immediately after the table, at the same
   visual weight as a "why RecopyFast" section would get. See below for why this can't be a
   footnote.
5. **Migration note** — 3 short numbered steps, reusing `HowItWorks.tsx`'s step shape at a much
   smaller scale (3 steps, no code block, no browser-chrome visual).
6. **FAQ** — 4–5 questions as native `<details>`/`<summary>`. This section's presence is what makes
   `FAQPage` JSON-LD truthful — the schema must describe what's actually on the page.
7. **Final CTA** — `FinalCTA.tsx`'s shape, copy swapped to reference the competitor by name.
8. **Footer.**

**On the H1 scale.** The styleguide's `Hero h1` row is explicitly `"font-display font-extrabold` +
existing clamp (**Hero.tsx owns it**)" — that clamp is bespoke to the homepage's pinned-scroll,
100vh, single-headline treatment (`text-[2.05rem] ... sm:text-[3.6rem] lg:text-[5.1rem]`,
`Hero.tsx:72`) and is not documented as a general "page h1" size. `/alternatives` pages are
template pages, not the flagship hero, and inventing a second bespoke h1 size would itself
contradict the styleguide's own "no per-section drift" instruction for `h2`. Decision: the page
`h1` here takes the documented **Section h2** scale verbatim (`font-display text-4xl sm:text-5xl
font-bold tracking-tight text-slate-900`) — composition of an existing rule in a new but adjacent
context, not an invention.

**JSON-LD attach points** (not visual — noted because the story requires it and the layout has to
support it): `SoftwareApplication` describes RecopyFast once, `BreadcrumbList` mirrors section 1's
three-item trail, `FAQPage` mirrors section 6's actual question/answer pairs verbatim — Execute
should generate the FAQ schema *from* the same typed data the `<details>` blocks render from, not
maintain the copy twice.

### 2. `/alternatives/<unknown-slug>` — 404

Not the app's `not-found.tsx` (`src/app/not-found.tsx`) — that file is `bg-background` + `Card` +
`Button`, the token-driven app surface, and landing on it from a marketing page would be the same
surface-switch jolt the auth-page bug describes, just triggered by routing instead of a stray
class. This story needs a **route-segment `not-found.tsx`** at `src/app/alternatives/not-found.tsx`
(Next.js resolves the nearest one), built on the same shell as section 1: `Header`, centered icon
tile, `Footer`. See States for the exact content.

---

## The comparison table — spec

No table or comparison pattern exists anywhere in the codebase today (confirmed: `grep -rl
"<table\|comparison" src/components/` returns nothing outside this story). Built here from
existing tokens only — a real semantic `<table>`, not a `Card` grid pretending to be one, because
(a) a real `<table>` is what a screen reader and an AI crawler both parse correctly, which is the
entire point of the honesty requirement, and (b) `docs/design-system.md` has no table component to
divert to, so "compose from what exists" means composing from typographic and colour tokens, not
from a nonexistent primitive.

| Row | RecopyFast | Competitor |
|---|---|---|
| Setup | One `<script>` tag on the existing site | (per-competitor: e.g. TinaCMS — wrap the app in their components, adopt a git-backed content model) |
| Where content lives | The page you already have | (per-competitor) |
| Editing without a developer | Yes | (per-competitor, honestly stated) |
| Client edits without an account | Yes | (per-competitor) |
| Starting price | Live from `/api/pricing` — **not** hand-typed here, same rule `Pricing.tsx:14-19` already states for the homepage | (per-competitor, dated) |
| … | … | … |

Visual spec:

- Table wrapped in `overflow-x-auto rounded-2xl border border-sky-100 bg-white` — the same
  card-border language (`border-sky-100`, no drop shadow beyond `shadow-sm`) `Pricing.tsx` and
  `privacy/page.tsx` both already use for a bordered white panel.
- Header row: `bg-sky-50`, cells `text-sm font-semibold uppercase tracking-[0.075em] text-sky-700`
  — literally the Eyebrow token spec, applied to table headers rather than a section label. `Row
  label` column left-aligned, `RecopyFast` and `{Competitor}` columns centered.
  RecopyFast's column additionally gets a `bg-sky-50/50` wash on the whole column (not just the
  header) so the eye tracks it down the table — quiet, not a spotlight: no border, no shadow, just
  the existing sky-50 tint already used as a background wash elsewhere (`Pricing.tsx:102`,
  `:177`).
- Body rows: `border-b border-sky-100`, last row no border. Cell text `text-sm text-slate-700`.
- Boolean cells: `Check` icon (`lucide-react`, `w-5 h-5 text-teal-600`) for yes — the exact
  treatment `Pricing.tsx:248` already uses for included features. For "no" cells: `X` icon
  (`lucide-react`, `w-5 h-5 text-slate-400`) — muted grey, not `tone-danger` red. A competitor
  lacking a feature is a factual comparison cell, not an error state, and `design-system.md`
  reserves the `tone-*` triplets for state, never category — using `danger` here would be
  reaching for a token outside its documented meaning, which the contract forbids as much as
  inventing a new one.
- Row hover (desktop only, no motion): `hover:bg-sky-50/40` — matches `.surface-interactive`'s
  intent without importing the class, since the table row isn't a click target.

## "Where {Competitor} wins" — spec

This is the section the honesty requirement exists for, so it does not get a smaller heading, a
lighter border, or a "yes but" framing. Two-column layout on desktop, stacked on mobile, **both
columns built from the identical card shape**:

```
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  eyebrow: "Where {Competitor}│   │  eyebrow: "Where RecopyFast │
│   wins"          (sky-700)  │   │   wins"          (sky-700)  │
│  h3 (2xl, semibold, slate-  │   │  h3 (2xl, semibold, slate-  │
│   900): "Be honest about    │   │   900): "Be honest about    │
│   this"                     │   │   this"                     │
│                              │   │                              │
│  ◆ icon-tile (sky-600) +    │   │  ◆ icon-tile (teal / bg-    │
│    claim + one supporting   │   │    primary) + claim + one   │
│    line, × 3 minimum        │   │    supporting line, × 3     │
└─────────────────────────────┘   └─────────────────────────────┘
```

- Both cards: `rounded-3xl border border-white/60 bg-white/70 p-9` — `Benefits.tsx:127`'s exact
  headline-card shape, reused unmodified so the two columns read as one design language, not a
  "real" card next to an apologetic one.
  - Left card (their wins): icon tile `flex h-12 w-12 items-center justify-center rounded-2xl
    bg-sky-600` — sky, the marketing accent's second-permitted hue.
  - Right card (our wins): icon tile identical shape, `bg-primary` (the teal accent token, used
    even on the marketing surface — `design-system.md:58` explicitly allows teal on marketing
    accent moments) — so the *only* difference between the two cards is which of the two
    permitted accent hues is used, not size, weight, or border.
- Each claim inside a card: `Check`-style leading icon (`w-5 h-5`, tinted to match its card's
  accent), `font-semibold text-slate-900` claim line, `text-sm text-slate-600` supporting line —
  the same list-item shape `Pricing.tsx:245-254` already uses for plan features.
- **Minimum 3 items per side.** Fewer than 3 on the "they win" side is the thin-content trap named
  in the story's own agentic notes wearing a different hat — a comparison with one grudging
  bullet reads as decorative, not honest, and won't be what an AI Overview chooses to cite.

## Migration note — spec

Reuses `HowItWorks.tsx`'s step anatomy (`text-5xl font-bold text-sky-700` numeral + `rounded-2xl
bg-sky-600` icon tile + `text-2xl font-semibold text-slate-900` heading + body), condensed to 3
steps with no code block and no side-by-side visual — this is a reassurance strip, not the
product's core "how it works" story, so it takes a fraction of the vertical space HowItWorks
does. Sits inside a `solid-sheet` band (`Benefits.tsx:97`'s wrapper) to keep the page's alternating
glass/solid section rhythm the homepage already establishes.

## FAQ — spec

No accordion primitive exists in `src/components/ui/` (confirmed — 17 files, no `Accordion`,
`Collapsible`, or `Disclosure`). Built from the native `<details>`/`<summary>` element:

```html
<details class="group border-b border-sky-100 py-6">
  <summary class="flex cursor-pointer items-center justify-between
                   text-lg font-semibold text-slate-900 list-none">
    Is RecopyFast a real alternative to {Competitor}?
    <ChevronDown class="h-5 w-5 text-sky-600 transition-transform
                         group-open:rotate-180" />
  </summary>
  <p class="mt-4 text-slate-600 leading-relaxed">
    {answer}
  </p>
</details>
```

Zero new dependency, keyboard- and screen-reader-native, and it composes only documented type/colour
tokens (`text-slate-900`, `text-sky-600`, `--dur`/`--ease-out` for the chevron rotation). Not
registered as a design-system gap because nothing here is invented outside the token set — see
Design system gaps for the softer note about whether it should be promoted later.

---

## Mockup

**REFERENCE only** — see `docs/designs/s17-cluster-engine.html`. It renders a full
`/alternatives/tinacms` page: breadcrumb, hero, the comparison table with real TinaCMS rows, the
two-column "where they win / where we win" section, the migration-note band, the FAQ, and the
final CTA, all in the marketing palette described above. It is static HTML with inline CSS
variables naming their Tailwind-class equivalents in comments — not React, not Tailwind, and not
something Execute copies verbatim. Execute builds the real page with the boilerplate's actual
components (`Header`, `Footer`, the reused section shapes) and Tailwind classes, using this file
only to see the layout and the states.

---

## Reused components

Inventoried first, per instruction — `src/components/landing/` and `src/components/sections/`:

**`src/components/landing/`** (2 files + a `demo/` subfolder):
- `HeroDemo.tsx`, `InteractiveHero.tsx` — the homepage's pinned-scroll browser-window demo, tied to
  `useLenis`/scroll-progress mechanics. **Not reused.** Same reasoning as the WebGL sky above: this
  is bespoke homepage machinery, heavy, and irrelevant to a comparison page's job (the comparison
  table is this page's "demo").

**`src/components/sections/`** (6 files):
- `Header.tsx` (`layout/`) and `Footer.tsx` (`layout/`) — reused **unmodified**. Every marketing
  page already shares these; no reason for cluster pages to diverge.
- `Pricing.tsx` — reused for: the bordered-white-card shape (`border border-sky-100`, no heavy
  shadow), the `Check` icon convention (`text-teal-600`) for included/yes, and the "fetch from
  `/api/pricing`, never hand-type a price" rule extended to the comparison table's price row.
- `Benefits.tsx` — reused for: the section header block pattern (eyebrow → `h2` → intro, centered,
  `mb-16`), and the headline-card shape (`rounded-3xl border border-white/60 bg-white/70 p-9` +
  `rounded-2xl` icon tile) for the "where they win / where we win" section.
- `HowItWorks.tsx` — reused for: the numbered-step anatomy, condensed, for the migration note.
- `FinalCTA.tsx` — reused **verbatim in shape**, copy only swapped to name the competitor, for the
  page's closing CTA.
- `ValueProposition.tsx` — inventoried, not reused. It's a scroll-pinned two-panel comparison of
  "with RecopyFast / without it," mechanically tied to the homepage's overlap-scroll staging
  (`page.tsx:49-59`'s comment on the negative-margin trick) — not portable to a standalone page
  without dragging that staging logic along.

**Also reused, outside those two folders:**
- `privacy/page.tsx` / `terms/page.tsx` — the "sky palette, no WebGL" page shell this whole
  document's surface decision rests on: `bg-gradient-to-b from-sky-50 to-white` canvas, centered
  icon-tile hero, `Header`/`Footer`, bordered white content cards. `/alternatives` widens their
  `max-w-4xl` prose container to the marketing standard `max-w-6xl` (this is a section-based page,
  not a prose document).
- `src/app/not-found.tsx` — **not** reused directly (wrong surface — see 404 above), but its
  three-part shape (icon circle → heading → two CTA buttons) is the layout precedent the new
  `alternatives/not-found.tsx` follows, rebuilt in the marketing palette.
- `src/app/blog/[slug]/page.tsx:44-48` — the `notFound()` call-site precedent (mechanism: call
  `notFound()` when the slug doesn't resolve against the typed competitor data; not a visual
  precedent, since that page's rendered 404 is the app one).

---

## States

These pages are statically rendered from typed, validated data at build/request time — no client
fetch, no loading spinner, no empty list. The four app-standard states (`Skeleton`/`EmptyState`/
`Alert`/`StatusBadge`) mostly don't apply here, and forcing them on would be inventing UI the page
doesn't need. What does apply:

| State | Behaviour |
|---|---|
| **Loading** | **N/A.** Server-rendered from static typed data (AC 8); there is no async gap on the client to cover with a `Skeleton`. Stated explicitly so Execute doesn't add one out of habit. |
| **Empty** | **N/A as a UI state** — this isn't a list view. The real analogue is a **content gate**: a competitor entry with fewer than 3 "where they win" items or a table missing rows fails the thin-content requirement and should not ship, not render with a sparse UI. That's a data-validation concern (AC 8's "validated"), not a rendered empty state. |
| **Error** | **N/A at runtime.** Typed + validated data (AC 8) means a malformed competitor entry is a build-time / type-check failure, not something a visitor can trigger. There is no `Alert variant="destructive"` on this page because there is nothing here that fails after deploy. |
| **Success** | The only real state — the fully rendered page. This is what the Mockup shows. |
| **404 — unknown competitor slug** | `src/app/alternatives/not-found.tsx`. Same shell as every `/alternatives/*` page (`Header`, `bg-gradient-to-b from-sky-50 to-white` canvas, `Footer`), **not** the app's `not-found.tsx`. Content: icon tile (`w-16 h-16 rounded-2xl bg-sky-100`, `Compass` icon `text-sky-600` — matching the app 404's icon-in-circle idea, recoloured to the marketing palette), `h1` "Comparison not found" at the Section h2 scale, one line of body copy ("We don't have a comparison for that yet — here's what we do have:"), then the known competitor list rendered as plain text links (`text-sky-700 hover:underline`) rather than a second index route, since no index page is in this story's scope. Primary CTA `Get started` → `/signup`, secondary `Back to home` → `/`. |

---

## Design system gaps

Report-only, per the contract. None of these was filled freestyle — each is either an existing
token/pattern composed into a new shape, or an open item for `/ks-plan` or a future pass.

1. **No comparison-table pattern exists anywhere in the design system.** Built here from existing
   primitives only (semantic `<table>`, the `Check`/`X` icon convention already used for plan
   features, existing border/tint tokens). If `s18` (`/cms-for`) or `s19` (`/for`, `/agencies`)
   turn out to need tabular comparisons too, this shape is worth promoting to a documented pattern
   in `docs/design-system.md` rather than being re-derived a third time.
2. **No FAQ/accordion primitive exists in `src/components/ui/`.** Built here with the native
   `<details>`/`<summary>` element — zero new dependency, but also zero design-system precedent to
   point at. Same promotion note as above if FAQs recur across the other three clusters.
3. **`architecture.md` and `design-system.md` disagree about which surface `/blog` (and by
   extension future cluster pages generally) belongs to** — `architecture.md:299-309` groups blog
   with Marketing; `design-system.md`'s evidence-based table puts it under App, and the real blog
   code confirms zero `sky-*`/WebGL usage. This document resolves the question **only for
   `/alternatives`**, on the reasoning above (functional shape + forced reuse of hardcoded-palette
   sections). It does not reclassify blog, and a future story touching `/blog` should not cite this
   document as having settled that question.
4. **No numeric Core Web Vitals thresholds exist anywhere** (`prd.md`, `architecture.md`,
   `stories.md`) — `docs/research/s17-cluster-engine.md`'s own "Open questions" already flags this
   for AC 7. Recorded again here because this document's choice to exclude `SkyBackground`/
   `useLenis` from these pages is partly a hedge against that unset budget; `/ks-plan` should
   either supply the number or send the question back up before task breakdown, same as the
   research doc recommends.
5. **No route-segment `not-found.tsx` exists yet anywhere in the app** — only the root
   `src/app/not-found.tsx` (app-token surface). This story is the first to need a marketing-surface
   404; the file is new, not a gap in tokens, just a routing artefact that didn't need to exist
   before this story.
