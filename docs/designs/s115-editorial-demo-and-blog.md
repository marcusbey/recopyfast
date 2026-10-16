# s115 — editorial demo and blog

Status: agent-produced screen definition from `docs/design-system.md` and the owner-approved
`docs/design/editorial-website-guide.md`. Static layout reference:
`docs/designs/s115-editorial-demo-and-blog.html`. The HTML communicates structure and states; it is
not production code.

## Shared frame

All three routes use the existing editorial Header and Footer variants. Canvas: cream `#f7f3e9`;
text: ink `#142024`; action/focus: teal `#287f7c`; muted copy: `#4c5552`; rules: `#d9d3c6`.
Display headings use the approved serif; controls, metadata and prose use sans. Surfaces are flat,
with 1px rules and 3px marketing-control corners. No glass, gradients, decorative shadow or new
artwork.

The frame is `min(1400px, 88vw)`, with 56px mobile and 88–96px desktop section rhythm. Existing
visible focus treatment remains. At 320/390 widths content keeps at least 20px side space. Footer
retains Cookie settings whenever the existing analytics rules expose it.

## `/demo`

Order: editorial Header → left-aligned intro → real demo → three affordances → closing action →
editorial Footer.

- Intro: eyebrow `INTERACTIVE DEMO`; serif h1 “Edit a real website, right here”; one paragraph
  identifying three **sample** designs; compact line `01 Click · 02 Type · 03 Swap an image`.
- Demo: the unchanged `InteractiveHero` exactly once, in a full-width white inner surface with an
  ink rule and no shadow. It keeps its own nested scroller and controls and is never cropped to the
  prose measure.
- Affordances: three equal ruled columns for Click anything, Type over it, Swap the photographs.
- Close: serif “That is the whole product”, one factual paragraph and existing native `/signup`
  action in teal.

Below 768px the intro is one column, the numbered line wraps, and affordances stack with rules. The
document never overflows; the nested demo remains scrollable. Existing reduced-motion and
interaction-cancellation behavior remains authoritative.

States: **ready** (local demo visible), **interacting** (visitor focus/pointer/scroll stops attract
behavior), **loading** (none; no auth/token/API gate), **failure/empty** (none invented; component
safeguards remain).

## `/blog`

Order: editorial Header → masthead → category/list layout → existing signup action → editorial
Footer.

- Masthead: eyebrow `FIELD NOTES`; serif h1 “Practical notes for handing over websites”; one
  sentence on client edits, maintenance and clear responsibility. No newsletter form.
- Desktop body: 220px `Browse` category rail beside a flexible vertical list. Existing derived
  categories remain tabs. Posts become flat editorial rows with category/date, serif title,
  excerpt and `Read article →`; no elevated cards.
- Below 768px the category rail becomes a wrapping tab row above a one-column post list. Titles and
  excerpts wrap; no horizontal scroll at 320px.

States: **published list** from the existing anonymous bounded query; **filtered** with current tab
semantics; **empty** using the existing Newspaper EmptyState/install-guide action; **error** using
the existing destructive Alert; **loading** adds no client spinner because the route is server
rendered/revalidated. No fake or stale post fallback.

## `/blog/[slug]`

Order: editorial Header → 920px article masthead → 720px body → restrained action → editorial
Footer.

- Masthead: back link, category eyebrow, 56–68px desktop/34–40px mobile serif title, optional
  excerpt, then published date and read time.
- Body: 17–18px sans at 1.65 line height. Existing allowed headings, lists, blockquotes, links,
  images, pre and code get deliberate spacing and wrapping. Styling does not change how stored
  content is parsed or sanitized.
- Close: thin rule, `Try the demo` primary action and current learn-more destination secondary.
- At 320px the body retains 20px side space. Long links and code wrap or scroll inside their block;
  images stay within the measure.

States: **published** renders the composition; **missing/draft/archived** remains the framework 404;
**loading** adds no client state; **sanitization fallback** stays quiet and exposes no raw markup or
exception detail.

## Preserved interaction and content rules

- Header stays auth-aware; security-boundary navigation is unchanged.
- Demo changes stay in React memory. No reset/replay, storage or network persistence is added.
- Category controls retain `tablist`, `tab`, `aria-selected` and visible focus.
- Draft/archived posts never enter the index or article screen. No admin preview/publish UI.
- Copy says samples, never customers, and adds no unproved performance or adoption claim.

## Design-system gaps

None. Existing Header/Footer editorial variants, Button, Badge, Alert, EmptyState and
InteractiveHero cover the screens. The pre-existing Markdown/body format mismatch is a separate
content-pipeline concern, not part of this visual story.
