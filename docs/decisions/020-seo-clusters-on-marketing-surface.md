# ADR 020 — The SEO cluster pages render on the Marketing surface

- Status: accepted
- Date: 2026-08-17
- Scope: stories `s17-cluster-engine`, `s18-stack-recipes`, `s19-audience-pages`
- Settles: `design-system.md` § "Unresolved: which surface do the SEO cluster pages belong to?"

## Context

This codebase has **two visual surfaces, and they are not compatible on one page**:

- **App** — token-driven. `bg-card`, `text-foreground`, CSS custom properties, dark mode works.
- **Marketing** — the WebGL sky, and the legacy `--sky-*` / `--slate-*` palette, pinned light.
  `design-system.md:55-58` records this as a documented exception that stays.

`design-system.md:159-164` names the failure mode of mixing them, from a real page: the **auth-page
bug** — a token-driven panel on a hardcoded-light page is a dark card floating on a light
background in dark mode.

The SEO cluster stories (`/alternatives`, `/cms-for`, `/for`, `/agencies`) had no *agreed* surface
— the two governing documents disagree, and `s19`'s design escalated that disagreement rather than
resolving it:

- **`architecture.md:299-309`** groups these routes under Marketing, naming `s17`–`s19` by number.
- **`design-system.md`'s own evidence table** puts the one built precedent, `/blog`, under App —
  and the code agrees: `blog/page.tsx` and `blog/[slug]/page.tsx` contain zero `sky-*` classes.

All three designs were in fact drawn on **Marketing** (`s19`'s design doc, line 5: *"Surface:
Marketing, per team-lead brief"*; its mockup is pinned `data-theme="light"`, uses only
`sky-*`/`slate-*`, and contains no app tokens). But `s19` recorded the conflict as design-system
gap 2 and explicitly deferred it: *"the doc conflict is real and unresolved — flag to
`/ks-architect` to reconcile once s17/s18/s19 are all in."* It also recorded gap 1: the Marketing
exception list in `design-system.md:56-58` names only "landing, demo, privacy and terms" and has
never been extended to cover these routes.

So the surface was applied without being decided. This ADR decides it.

## Decision

**Marketing.** All cluster routes produced by `s17`, `s18` and `s19` render on the Marketing
surface, using the `--sky-*` / `--slate-*` palette, pinned light, consistent with `/` and `/demo`.

Three independent reasons converge, which is why this is not a coin flip:

1. **`architecture.md:299-309` already names these stories by number** — *"Marketing → `/`,
   `/blog`, and the SEO clusters `s17`–`s19` will add."* That is the one place in the
   documentation that speaks to these specific routes, and it puts them in Marketing.
2. **They are landing pages by function** — hero, persuasive table, CTA, FAQ, built to convert a
   cold search visitor. That is the job `/` and `/demo` do, not the job `/dashboard` does.
3. **Decisive: the stories ask these pages to reuse the existing marketing sections.**
   `Pricing.tsx`, `Benefits.tsx`, `HowItWorks.tsx` and `FinalCTA.tsx` are hardcoded to
   `slate-*` / `sky-*` and none of them reads a CSS custom property. Reuse and app-token
   compliance are mutually exclusive here, and the brief already chose reuse.

## Considered options

- **(a) App surface, token-driven.** Rejected, though it has the better precedent. `/blog` is
  token-driven and on-system, and choosing App would give these pages dark mode and put them
  inside the design system rather than beside it. It fails on cost: none of the four marketing
  sections can be reused, so `s17` and `s18` would rebuild `Pricing`, `Benefits`, `HowItWorks` and
  `FinalCTA` in token form — four components whose only current consumer is the landing page,
  forked into a second implementation that must then be kept in visual sync with the first,
  forever, by hand. That is a materially larger story than either was scoped as, and it buys dark
  mode on pages whose visitors arrive cold from a search engine and convert or leave.
- **(b) Mixed — cluster pages Marketing, `/agencies` App.** Rejected outright. This *is* the
  auth-page bug, applied at the scale of a whole route group, and `s19` renders on `s17`'s engine,
  so the mix would occur inside one engine rather than between two.
- **(c) Migrate the four marketing sections to tokens first, then build all three stories on
  App.** Rejected as sequencing, not as an idea. It is a real refactor of the highest-traffic page
  in the product, it has no story, and putting it in front of `s17` blocks the entire SEO cluster
  behind a landing-page rewrite. If the Marketing surface is ever brought on-system, it happens as
  its own story with its own visual review — and this ADR is superseded then, deliberately.

## Consequences

**No design is redrawn.** All three were already on Marketing; this ADR ratifies what they did and
removes the "provisional" qualifier from them. It closes `s19`'s design-system gaps 1 and 2 — the
conflict it escalated is now decided, in favour of the surface it had already applied.

**`design-system.md`'s Marketing exception list must be extended** — that is `s19`'s gap 1, and it
is real. `design-system.md:56-58` and `styleguide.md:33-36` scope the legacy palette to "landing,
demo, privacy and terms". `/for/*`, `/agencies/*`, `/alternatives/*` and `/cms-for/*` join it, so
the next story does not have to re-derive this call.

**These pages will not have dark mode, and that is now a stated property rather than an
oversight.** A future reader comparing `/blog` (dark mode works) against `/for/dental-practices`
(it does not) is looking at a deliberate line, drawn here.

**The `/blog` inconsistency is accepted and stays.** `/blog` is App-surfaced and is not moving.
The rule going forward is narrow and checkable: **routes that reuse `src/components/sections/*`
are Marketing; everything else is App.** That is a grep, not a judgement call.

**Watch — `s19` does not reuse `src/components/sections/*`, so reason 3 does not carry it.** Its
design deliberately excludes them: research found all six are zero-argument and single-use,
imported only by `src/app/page.tsx`, and forking one to take a vertical prop invites the
thin-content failure `s17` itself warns against. `s19` builds purpose-made sections from primitives
(`Button`, `Card`, `Badge`, `IconTile`) instead. It therefore sits on Marketing because it shares
`s17`'s engine and its reader is a cold search visitor — reasons 1 and 2 — not reason 3. That is
sufficient, but a reviewer should know which reason is load-bearing here, because the "reuses
`sections/*`" grep above will return nothing for `s19` and that is expected, not a violation.

**A third open item `s19` raised is not settled here and is not visual.** There is no marketing-
surface `not-found.tsx` / `error.tsx` — the only ones in the app are App-surfaced, so an unknown
`/for/<slug>` produces a surface switch mid-navigation. This ADR does not close that; it is a
generic gap affecting every route on the Marketing surface, and it needs its own story rather than
a per-route patch inside `s19`.
