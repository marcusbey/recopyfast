# Design — Story s19-audience-pages

> Source: `docs/design-system.md` (binding), `docs/design/styleguide.md`, `docs/stories.md`
> (`s19`, isolated), `docs/research/s19-audience-pages.md`, `docs/prd.md` (target users,
> SEO strategy, GTM strategy). Surface: **Marketing**, per team-lead brief — same surface
> as `s17`/`s18`. No new route code; this rides `s17`'s engine (typed content + one
> template per cluster, sitemap auto-inclusion).

## Screen(s)

Two templates, one engine, two different readers. The split is structural, not cosmetic:
each template's *load-bearing* section is a different shape, because the thing that
convinces a dentist and the thing that convinces an agency owner are different objects
(a checklist vs. an invoice).

### Template A — `/for/<vertical>` — reader: the local business owner

Zero technical skill, uses this 4–10×/year, will not learn a CMS (`prd.md:78-82`). The
page must read like it already knows what's on their site. Sections, top to bottom:

1. **Breadcrumb** — `Home / For / <Vertical>` — small, muted, sets up `BreadcrumbList`.
2. **Hero** — eyebrow ("For dental practices") → `h1` naming the moment ("Update your
   practice's website before your first patient calls") → one-line subhead → **one**
   primary CTA (`Button` `default`, `size="lg"`) + a reassurance line under it. No
   secondary CTA competing for attention.
3. **"What you'll actually update"** — the anti-thin-content section. A grid of `Card`s,
   one per concrete content type for *this* vertical, not generic feature copy. This is
   the AC's own guard (`stories.md:892`) and the field that must never read the same
   between two vertical pages. Per vertical (four minimum, per AC):
   - **Dental practices:** office hours & holiday closures · new-patient intake link ·
     accepted insurance list · dentist & hygienist bios · emergency contact instructions ·
     current new-patient offer.
   - **Restaurants:** hours incl. holidays · menu items & prices · daily/seasonal
     specials · reservation link · closure announcements.
   - **Law firms:** practice areas · attorney bios & credentials · office hours &
     locations · case results / testimonials · consultation CTA copy.
   - **Gyms:** class schedule & instructor names · membership pricing & promos · trainer
     bios · holiday hours · facility/amenity updates.
4. **"How it works"** — a shared 3-step strip (paste one line of code once → get an email
   link → click text, type, done). Deliberately generic and *short* — the distinctiveness
   budget is spent in section 3, not here. Mechanism is allowed to repeat; the vertical's
   content list is not.
5. **Example** — one before/after text-edit card using that vertical's own content (e.g.
   dental hours changing from "Mon–Fri 9–5" to "Mon–Fri 8–6, Sat 9–1"). Reinforces
   section 3 concretely instead of restating it.
6. **FAQ** — 3–4 vertical-flavored questions feeding `FAQPage` JSON-LD ("Do I need to
   know code?", "Can my whole team use it?", "What if I have more than one location?").
7. **Final CTA band** — repeats the single primary CTA. No second offer.

### Template B — `/agencies/<use-case>` — reader: the agency owner (the buyer)

Not a CMS pitch (`prd.md:355-357`). The wedge is a P&L number the reader already has in
their head. Sections:

1. **Breadcrumb** — `Home / Agencies / <Use case>`.
2. **Hero** — eyebrow ("For agencies") → `h1` stating the pain directly (see wedge copy
   below) → subhead translating it into a number → **one** primary CTA + reassurance line.
3. **"The math"** — the load-bearing, non-shared section. A two-column comparison `Card`:
   competitor cost (real, sourced) vs. the unbillable-time or tooling-friction cost this
   removes. This is the section vertical pages have no equivalent of — it is what keeps
   the two templates from reading as the same page even at a glance.
   - **client-content-updates:** "CloudCannon starts at ~$45/site/month. 15 client sites
     ≈ $6,480–$8,000/year before a client logs in" (`prd.md:38-40`, exact figures — not
     invented) set against the unbilled-support-hour cost of doing those same edits by
     hand. **Content note:** the RecopyFast-side number is a placeholder slot — `s13`
     (Agency plan) has no code and no settled price yet (research: "Current state of the
     code" / `m6`). The card's right column reads "one flat plan — pricing TBD" until
     `s13` lands; do not fabricate a figure at build time.
   - **multi-site-management:** reframed around operational friction, not only price —
     "how many logins does it take to change one holiday-hours line across 12 client
     sites today?" vs. one dashboard, one workflow, regardless of stack (WordPress,
     Webflow, Next.js, hand-rolled HTML).
4. **"What this replaces"** — a before/after pair distinct per use-case:
   - client-content-updates: email/Slack request → dev opens the file → pushes a change
     → bills nothing, *replaced by* client clicks a link, edits it themselves.
   - multi-site-management: N separate CMS logins and mental models per stack, *replaced
     by* one dashboard across every client site regardless of stack.
5. **"How it works for you and your client"** — two-column: agency side (invite a client
   to one site, scoped, revocable) / client side (click the link, no login, no CMS to
   learn). Same mechanism family as Template A's step 4, framed dual-sided — shared
   pattern, distinct content, same rule as above.
6. **FAQ** — agency-flavored ("Can I control exactly what a client can edit?", "What if a
   client breaks something?", "Can I bill this separately from my retainer?").
7. **Final CTA band** — repeats the single primary CTA.

### What keeps them from reading as the same page

| | Template A (vertical) | Template B (agency) |
|---|---|---|
| Reader address | "your site", "your patients" | "your clients", "your margin" |
| Load-bearing section | concrete content checklist (nouns) | cost/friction comparison (arithmetic) |
| Tone | reassuring, simple, low-stakes | business case, quantitative |
| CTA framing | ease ("no password to remember") | control/margin ("stop billing $0") |
| Wedge source | `prd.md:312-315` (SEO cluster 3) | `prd.md:355-357` (GTM wedge message) |

### Content note — CTA copy (carried from research, not a design decision)

Research (`research/s19-audience-pages.md`, "CTA copy risk") confirms today's `/signup`
grants zero entitlements — no trial exists in code (`s01` unbuilt). Both templates'
CTAs must say **"Sign up free"** / **"Get started"**, never "start your 14-day trial" —
that copy would be false the moment a real visitor hits `permissions.ts:21-24`. If `s01`
ships first, the CTA copy can change; the *shape* (one button, one destination) does not.

## Mockup

`docs/designs/s19-audience-pages.html` — reference only, not production code. Renders
both templates full-length, stacked with a jump nav, so the section-by-section contrast
is visible without cropping either page to fit a column:

- `/for/dental-practices` — full Template A.
- `/agencies/client-content-updates` — full Template B.

Both pinned `data-theme="light"`, legacy `sky-*`/`slate-*` palette, `font-display` on
`h1`/`h2` only, marketing type scale and rhythm exactly as specified in
`design/styleguide.md` section 3 (Marketing) — no new sizes invented.

## Reused components

Inventoried before writing anything new — all four below are the same primitives the
existing content-driven route (`blog/[slug]/page.tsx`) already draws from, dressed in the
marketing type scale per the team-lead brief:

- `Header`, `Footer` (`src/components/layout/`) — used as-is, unmodified.
- `Button` (`default` for the primary CTA, `outline` for the pricing-card's secondary
  link if any — never a second competing primary).
- `Card` (`outline` for the content-checklist grid and the FAQ list; `default` for the
  "the math" comparison card).
- `Badge` (`secondary`) — vertical/use-case label near the breadcrumb, same usage as
  `blog/[slug]/page.tsx:70`'s category badge.
- `IconTile` (`accent`, `sm`) — one per checklist item and per "how it works" step.

**Explicitly not reused:** `src/components/sections/*` (`Hero`, `Benefits`,
`ValueProposition`, `HowItWorks`, `Pricing`, `FinalCTA`) and
`src/components/landing/demo/*`. Research confirms all six `sections/*` components are
zero-argument, single-use, imported only by `src/app/page.tsx` — forking them to accept a
vertical prop risks exactly the thin-content failure mode `s17` itself warns against
(`stories.md:840-841`). New, purpose-built sections instead, composed from the primitives
above.

## States

These are server-rendered content pages from typed data (the `blog/[slug]` pattern,
generalized by `s17`) — not a data view with a client fetch, so the standard
skeleton/empty/error/success set doesn't map 1:1. What applies:

| State | Behaviour |
|---|---|
| **Success** (default) | Full page renders from `s17`'s typed content module for a known slug. |
| **Unknown slug** | `notFound()`, same as `blog/[slug]/page.tsx:47` — renders the existing global `src/app/not-found.tsx` unmodified. **Flagged below**: that component is on the App-token surface, not this page's marketing palette. |
| **Loading** | None. No client fetch, no skeleton — content resolves server-side before paint, same as blog. |
| **Error** (content module read fails) | Falls through to the existing global `src/app/error.tsx`, unmodified — same reasoning as above. |
| **Empty** | Not applicable — a slug either resolves to typed content or is a 404. There is no "site with no content" state on a marketing page. |

## Design system gaps

1. ~~**Marketing exception list doesn't name these routes yet.**~~ — **CLOSED 2026-08-17 by
   [ADR 020](../decisions/020-seo-clusters-on-marketing-surface.md).** `design-system.md`'s
   Marketing exception now names `/for/*`, `/agencies/*`, `/alternatives/*` and `/cms-for/*`
   explicitly. Original text kept below for the record.

   `design-system.md:56-58`
   and `styleguide.md:33-36` scope the legacy `sky-*`/`slate-*` exception to "landing,
   demo, privacy and terms." This design extends it to `/for/*` and `/agencies/*` per the
   team-lead's explicit brief ("same surface as s17/s18"). Recording it here rather than
   silently assuming it — `/ks-design-system` should add `/for/*`, `/agencies/*`,
   `/alternatives/*`, `/cms-for/*` to that list once `s17`/`s18`/`s19` ship, so the next
   story doesn't have to re-derive the same call.
2. ~~**`architecture.md` vs. `design-system.md` disagree on which surface content-driven SEO
   routes belong to**~~ — **CLOSED 2026-08-17 by
   [ADR 020](../decisions/020-seo-clusters-on-marketing-surface.md): Marketing.** This design's
   choice stands, and it is no longer provisional on a team-lead brief — it is a recorded
   decision. `/blog` stays App-surfaced and the inconsistency is accepted deliberately. Original
   text below.

   (research fact 5): `architecture.md:307` groups
   `s17`–`s19` under the WebGL Marketing surface; `design-system.md:17` places the one
   built precedent, `blog`, on the token-driven App surface, and the actual code
   (`blog/[slug]/page.tsx`) uses `bg-background`/`text-display`, no WebGL, no
   `framer-motion`. This design follows the team-lead's brief (Marketing surface, legacy
   palette) because that instruction is explicit and scoped to this pipeline run, but the
   doc conflict is real and unresolved — flag to `/ks-architect` to reconcile once
   `s17`/`s18`/`s19` are all in.
3. **No marketing-surface 404/error component exists.** The only `not-found.tsx` /
   `error.tsx` in the app are App-surface (`bg-background`, `Card`, `tone-accent`
   iconography) — see States, above. A visitor hitting an unknown `/for/<vertical>` slug
   sees a jarring surface switch mid-navigation. Not invented here; report only. A
   marketing-pinned variant of both would close this, generically, for every route on this
   surface — not just `s19`'s.
4. **No JSON-LD component/pattern exists anywhere in the codebase** (research fact 4,
   confirmed: zero `application/ld+json` hits). Both templates need `FAQPage` +
   `BreadcrumbList` at minimum; whether vertical pages also want a `LocalBusiness`-adjacent
   schema (they describe a business category, not the product — `SoftwareApplication`
   doesn't obviously fit) is an open question research raised and this design doesn't
   resolve, since it's a data/schema decision, not a visual one. Flag to `/ks-plan`.
