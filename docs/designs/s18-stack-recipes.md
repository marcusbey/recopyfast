# Design — Story s18-stack-recipes

> Surface: **Marketing** — same legacy `sky-*`/`slate-*` palette as the rest of landing/demo/
> privacy/terms, pinned light. `font-display` (Bricolage) permitted for headings. Accent
> moments are teal or sky only — no third hue anywhere on this cluster, including the
> documented-unsupported variant. This design does not touch the App token surface.
>
> Rides `s17-cluster-engine`'s route/sitemap generator (not yet designed — no
> `docs/designs/s17-cluster-engine.md` existed at the time this was written). Nothing below
> invents route-generation mechanics; it assumes one typed-data-file-plus-template engine per
> `s17`'s stated contract (`stories.md`: *"This builds the engine; s18 and s19 are clusters
> riding on it."*) and designs only the template's rendered output.

## Screen(s)

1. **`/cms-for`** — index/chooser. Grid of every stack the install-recipe module lists,
   supported and unsupported both shown (never silently omitted — same principle AC6 states
   for the detail page applies to the index). Reachable from `s17`'s comparison cluster and
   from the dashboard's `awaiting-install` state (`s02`) as "browse all install guides."
2. **`/cms-for/<stack>`, supported variant** — the recipe page proper: exact snippet, exact
   paste location, verification evidence. This is the story's core deliverable and the only
   screen built as an HTML mockup below (`wordpress`).
3. **`/cms-for/<stack>`, documented-unsupported variant** — same route, same template, a
   different render branch driven by `recipe.unsupported`. Not a separate route, not a 404,
   not an error page — a distinct, honest content state for a stack whose install genuinely
   does not work today.
4. **Unknown `/cms-for/<slug>`** — not a designed screen. Falls through to Next.js `notFound()`
   exactly as `src/app/blog/[slug]/page.tsx` already does for an unknown blog slug. No custom
   "stack not found" page is designed; inventing one here would be a second 404 pattern next to
   an existing one.

## Mockup (REFERENCE only)

`docs/designs/s18-stack-recipes.html` — `/cms-for/wordpress`, supported variant, full page
(Header → breadcrumb/hero → snippet → location → evidence → footer CTA → Footer), plus a scroll
section at the bottom of the same file sketching the unsupported variant's replacement content
block, and a small sketch of the `/cms-for` index card. Low fidelity; layout and states only —
see the mockup-status rule in the skill contract, this is not production code.

**How the mockup shows "renders from `s02`'s data, not hand-written":** every region sourced
from the install-recipe module carries a `data-recipe-field="…"` attribute in the mockup markup
(e.g. `data-recipe-field="snippet"`, `data-recipe-field="locationSteps"`,
`data-recipe-field="evidence"`, `data-recipe-field="unsupportedReason"`), and a visible amber
annotation ribbon at the top of the file lists the field names and states, in plain language:
*"Everything tagged `data-recipe-field` below is one prop read from `getInstallRecipe(stack)` —
the same call `s02`'s `awaiting-install` dashboard state makes. There is exactly one template
(`app/cms-for/[stack]/page.tsx`) for all eight-plus stacks; a new stack is a new entry in the
recipe module, never a new page file or new JSX."* This is a mockup annotation only — it is not
proposing the prop name or module path as fact beyond what `s02`'s research already names as a
candidate (`src/lib/sites/install-recipes.ts`); `/ks-plan` settles the real shape.

## Reused components

Inventoried `src/components/landing/` and `src/components/sections/` first, per instruction.

| Source | Pattern reused | Where in this design |
|---|---|---|
| `src/components/layout/Header.tsx`, `Footer.tsx` | Full components, unchanged | Page chrome, both variants |
| `src/components/sections/HowItWorks.tsx:141-162,172-194` | Dark code panel (window-control dots, `font-mono`, `bg-slate-900`) + `Copy`/`Check` toggle button, "Copied to clipboard" transient text | The snippet block — same visual treatment, now driven by `recipe.snippet` instead of a literal string |
| `src/components/sections/HowItWorks.tsx:92-104`, `Benefits.tsx:106-115` | Section header block: eyebrow (`text-sm font-semibold uppercase tracking-[0.075em] text-sky-700`) → `h2`/`h1` (`font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900`) → intro (`text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl`), centered | Page hero |
| `src/components/sections/Benefits.tsx:127-141` | Headline card: `surface-interactive rounded-3xl border border-white/60 bg-white/70 p-9`, icon tile (`bg-sky-600`, `rounded-2xl`), eyebrow, `h3`, body | "Where it goes" card and "Verified live" evidence card |
| `src/components/sections/HowItWorks.tsx:207-220` | Pill badge: `inline-flex items-center gap-3 px-6 py-3 bg-sky-50 rounded-full border border-sky-100`, teal/sky text | "Verified live on …" badge and "~5 min install" meta pill — reused instead of `ui/Badge`, which is token-driven for the App surface (see gap 1) |
| `src/components/sections/FinalCTA.tsx` | Structure only (not read line-by-line this pass) — bottom conversion block | "Not your stack? Try the 5-minute setup" footer CTA |
| `src/app/blog/[slug]/page.tsx` | `notFound()` on an unresolvable slug | Unknown-stack behavior (screen 4, not mocked) |
| `src/app/privacy/page.tsx:16` | `bg-gradient-to-b from-sky-50 to-white` page canvas, no WebGL `SkyBackground` | Page background — a content page, not the animated hero; matches the existing lighter-weight marketing pattern already used for privacy/terms rather than re-mounting Three.js eight-plus times |
| lucide-react `Copy`, `Check` | Already used in `HowItWorks.tsx` | Snippet copy control |

New icons used, from the already-installed `lucide-react` (no new dependency): `MapPin` or
`FolderOpen` (location card), `ImageIcon`/`Camera` (evidence frame), `Info` (unsupported
explainer — deliberately not `AlertTriangle`/`XCircle`; see States).

## States

| State | Design |
|---|---|
| **Success** (default, supported stack) | The full page as mocked: snippet → exact location → verified-live evidence. |
| **Loading (copy interaction)** | Copy button: `Copy` icon + "Copy the snippet" → on click, `Check` icon (teal, not `tone-success` green — see gap 3) + "Copied to clipboard" for 2s, then reverts. Same timing/pattern as `HowItWorks.tsx:70-74`. |
| **Loading (evidence image)** | Screenshot frame renders a flat `bg-slate-100` placeholder with a centered `ImageIcon` at 40% opacity until the asset loads — no spinner, matches the product's no-spinner convention (skeleton-shaped, not a loader glyph) adapted to the marketing palette since `Skeleton` itself is an App-token component (see gap 2). |
| **Empty (index page only)** | If `getAllInstallRecipes()` ever returns zero entries (recipe module not yet seeded), the `/cms-for` index shows a single centered message — one line, one action ("Recipes are being verified — check back soon" + link to `/dashboard` to install manually via the standard flow) — not a broken empty grid. Not built as a full mock; a one-line variant of the index sketch. |
| **Error (unknown stack)** | Not an inline `Alert`. `notFound()` → the app's existing 404, matching `blog/[slug]`'s precedent. No second 404 page designed. |
| **Documented-unsupported** | Full alternate content branch, sketched at the bottom of the HTML mockup. Replaces the snippet + location + evidence sections with one explanatory card: `Info` icon tile (sky, not a warning/danger tone — see gap 3), a plain-language reason (`recipe.unsupportedReason`, e.g. *"This platform's page editor strips injected `<script>` tags on save, so the snippet cannot survive being pasted here."*), and a "what to do instead" line (contact support, or a link back to `/cms-for` for a stack that does work). Same Header, breadcrumb, hero and Footer as the supported variant — the page is never hidden or thin, it is honest. Explicitly **not** styled as an error (no red, no `tone-danger`): this is a known, stated limitation, not a failure. |

## Design system gaps

Report-only, per instruction — nothing below was invented into the mockup beyond composing
existing tokens/patterns.

1. **No shared `CodeBlock`/`CopySnippet` component.** The dark-panel + copy-button pattern this
   design reuses from `HowItWorks.tsx` is hand-rolled there, once, for one literal string. This
   story needs the identical visual pattern driven by data across 8+ pages plus the dashboard's
   `awaiting-install` state (`s02`). Two independent hand-rolled copies of this pattern is the
   same drift shape `docs/design-system.md` already flags for `HowItWorks.tsx`'s snippet text
   itself. Recommend extracting a real component at `/ks-plan` or `/ks-execute` time — not
   invented here.
2. **No marketing-surface equivalent of `Skeleton`/`EmptyState`.** Both exist in `ui/` but are
   documented as App-token components. This design reuses their *shape* (skeleton-form
   placeholder, one-line-plus-one-action empty state) rendered in the sky/slate palette instead,
   since no marketing-surface loading/empty pattern is documented anywhere in the design system.
3. **Marketing has no "honest limitation" status pattern.** The `tone-*` triplets
   (`tone-warning`, `tone-neutral`, etc.) are App-token, CSS-variable-driven, and not documented
   as available on the pinned-light marketing surface — using them here would risk introducing a
   status hue the marketing exception doesn't cover ("teal or sky only — never … a second
   saturated hue"). Every marketing section shipped today (`HowItWorks`, `Benefits`,
   `ValueProposition`) is purely positive; this story is the first marketing screen that must
   say "this doesn't work yet" without inventing a new color. Resolved here by staying entirely
   inside sky/slate/teal (an `Info` icon in sky, slate body text, no red/amber) — but the
   product has no documented pattern for this, and will need one again for any future marketing
   "not available" content.
4. **No platform/brand logo assets in the repo.** Checked `public/` — no WordPress, Shopify,
   Webflow, Squarespace, Framer, Astro, or Next.js marks exist, and no icon library beyond
   `lucide-react` is installed (`react-icons`/`simple-icons` absent from `package.json`). The
   index/chooser and each detail page's hero therefore use a generic sky icon tile (the same
   `bg-sky-600` tile pattern from `HowItWorks`/`Benefits`) plus the stack name in text, never an
   invented or approximated brand mark. Sourcing real per-platform logos (with licensing
   clearance) is out of this design's scope — flagged, not solved.
