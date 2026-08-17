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

The SEO cluster stories (`/alternatives`, `/cms-for`, `/for`, `/agencies`) had no agreed surface,
and `/ks-design` produced two answers that contradict each other:

- `s17` and `s18` were drawn on **Marketing**.
- `s19` was drawn on **App**, reasoning from `/blog` — which is genuinely token-driven; the real
  `blog/page.tsx` and `blog/[slug]/page.tsx` contain zero `sky-*` classes.

They cannot both stand, because **`s19` renders on `s17`'s engine**. One template, one surface.

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
  so the mix would occur inside one template rather than between two.
- **(c) Migrate the four marketing sections to tokens first, then build all three stories on
  App.** Rejected as sequencing, not as an idea. It is a real refactor of the highest-traffic page
  in the product, it has no story, and putting it in front of `s17` blocks the entire SEO cluster
  behind a landing-page rewrite. If the Marketing surface is ever brought on-system, it happens as
  its own story with its own visual review — and this ADR is superseded then, deliberately.

## Consequences

**`s19`'s design is now known-wrong and must be redrawn.** It was produced against App tokens; it
inherits the Marketing palette, the pinned-light background, and the constraint that it may not use
`bg-card` / `text-foreground` anywhere. Its `.md` and `.html` are re-issued through `/ks-design`
before `s19` executes. `s17` and `s18` need no design change — they already assumed this answer.

**These pages will not have dark mode, and that is now a stated property rather than an
oversight.** A future reader comparing `/blog` (dark mode works) against `/for/saas` (it does not)
is looking at a deliberate line, drawn here.

**The `/blog` inconsistency is accepted and stays.** `/blog` is App-surfaced and is not moving.
The rule going forward is narrow and checkable: **routes that reuse `src/components/sections/*`
are Marketing; everything else is App.** That is a grep, not a judgement call.

**Watch.** `s19`'s design explicitly *did not* reuse `src/components/sections/*` — that was the
consequence of drawing it on App. On redraw, if it still does not reuse them, then reason 3 above
does not apply to `s19` on its own merits and it is sitting on Marketing only because it shares
`s17`'s engine. That is a sufficient reason, but a reviewer should know it is the operative one.
