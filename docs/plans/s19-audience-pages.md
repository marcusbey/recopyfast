---
validated: no
---

> **Decision made, gate still held.** The SEO cluster surface is settled as **Marketing**
> ([ADR 020](../decisions/020-seo-clusters-on-marketing-surface.md), 2026-08-17) — but this
> story's design was drawn on the **App** surface and is therefore known-wrong, not merely
> provisional. It is being redrawn through `/ks-design` on Marketing: `--sky-*` / `--slate-*`,
> pinned light, no `bg-card` / `text-foreground` anywhere.
> **This gate flips to `yes` when the redrawn design lands** — nothing else blocks it.
# Plan — Story s19-audience-pages

Branch: `feature/s19-audience-pages`
Research: `docs/research/s19-audience-pages.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s19-audience-pages.md` — two templates (vertical / agency), marketing
surface, explicitly does not reuse `src/components/sections/*`. This plan does not repeat that
spec either.

## Target story

**s19-audience-pages — pages for the people who actually buy.** Complexity 2. Declared dependency:
`s17-cluster-engine` only.

**Undeclared dependency this plan records:** the CTA criterion ("leading to trial signup")
depends on `s01-trial-signup`, which does not exist in code today — `/signup` grants zero
entitlements (`SignupForm.tsx:43-49`, `permissions.ts:21-24`). This plan does not add `s01` as a
blocking dependency (the story's own content work does not need it), but it does bind the CTA
copy decision below so this story never ships a claim `s01` hasn't earned yet.

Acceptance criteria:
- [ ] `/for/<vertical>` renders for at least restaurants, dental-practices, law-firms and gyms.
- [ ] `/agencies/<use-case>` renders for at least client-content-updates and
  multi-site-management.
- [ ] Each vertical page names the content that actually changes for that business — hours,
  prices, menu, staff — not generic feature copy.
- [ ] Each page carries valid structured data and appears in the sitemap.
- [ ] Each page has one primary call to action leading to trial signup.
- [ ] No page duplicates another page's body content.

## Tasks (ordered)

1. [ ] **Typed content modules.** `src/content/for.ts` (restaurants, dental-practices, law-firms,
   gyms — each with a `checklist: string[]` of ≥5 concrete content types per the design doc's
   per-vertical lists, a before/after example, 3–4 FAQ entries) and `src/content/agencies.ts`
   (client-content-updates, multi-site-management — each with a `math` section per vertical below,
   a before/after replacement pair, FAQ). Both closed unions + a validator, same pattern as
   `s17`'s `src/content/alternatives.ts`.
   - Test: all 4 vertical + 2 agency entries exist; every entry's `checklist`/`math`/example
     fields are non-empty and no two entries share an identical checklist item or math claim
     (the within-cluster half of the thin-content guard).
2. [ ] **`/for/[vertical]/page.tsx` (Template A).** Server component, `generateStaticParams` from
   `src/content/for.ts`, `notFound()` on unresolved slug. Sections per design: breadcrumb → hero
   (one primary CTA + reassurance line) → "what you'll actually update" checklist grid → shared
   3-step "how it works" strip → before/after example → FAQ → final CTA. Compose only from
   `Header`, `Footer`, `Button`, `Card`, `Badge`, `IconTile` — never `src/components/sections/*`.
   - Test: rendering `dental-practices` asserts the checklist grid contains dental-specific items
     (e.g. "accepted insurance list") and does not contain another vertical's items.
3. [ ] **`/agencies/[useCase]/page.tsx` (Template B).** Same route/data mechanics as task 2, over
   `src/content/agencies.ts`. Sections: breadcrumb → hero → "the math" comparison card → "what
   this replaces" before/after → "how it works for you and your client" → FAQ → final CTA.
   - Test: rendering `client-content-updates` asserts the math card is present and reads
     "pricing TBD" for the RecopyFast-side figure (task 8 defines the sourced content).
4. [ ] **JSON-LD.** Import `buildBreadcrumbListLd`/`buildFAQPageLd` from `s17`'s
   `src/lib/seo/json-ld.ts` on both templates. Do not add `SoftwareApplication` (describes the
   product once, per `s17`'s single-emission convention, not per-vertical) or a
   `LocalBusiness`-adjacent schema (would misrepresent RecopyFast as being the dentist's/gym's
   business rather than the tool) — `FAQPage` + `BreadcrumbList` satisfies "valid structured data"
   as literally required.
   - Test: for one fixture from each template, the FAQ JSON-LD's question list matches the
     rendered FAQ text and count.
5. [ ] **Sitemap.** Add `/for/<vertical>` and `/agencies/<use-case>` blocks to `src/app/sitemap.ts`
   — same per-cluster convention `s17` established, no new mechanism.
   - Test: sitemap output includes all 4 `/for/*` and 2 `/agencies/*` seeded URLs.
6. [ ] **Cross-cluster duplicate-content guard.** `src/lib/content/similarity.ts` — a word-shingle
   / Jaccard similarity check over rendered body text with shared chrome (Header/Footer/CTA
   boilerplate) excluded. A test runs it pairwise across every page from `s17`'s alternatives,
   `s18`'s cms-for, and this story's `for`/`agencies` clusters, asserting every pair is below a
   stated threshold. Include a negative-control fixture (two deliberately near-identical fake
   entries) proving the check catches a real violation, not just passing vacuously.
   - Test: the negative control fails the check; the real seeded pages all pass it.
7. [ ] **CTA wiring and copy guard.** Both templates' single primary CTA points at `/signup`
   (today's real, working destination), with a reassurance line under it, per design. CTA copy is
   **"Sign up free"** / **"Get started"** — never "start your trial" or any trial-framed language,
   since no trial exists in code yet (`s01` unbuilt). A test asserts this mechanically so the copy
   can't drift back to a false claim if `s01` still hasn't shipped when someone edits this content
   later.
   - Test: exactly one primary CTA button per page, `href="/signup"`; a scan of every page's
     rendered CTA text asserts it never matches `/trial/i`.
8. [ ] **Agency "math" content.** Author real, sourced figures for `client-content-updates`
   (CloudCannon ≈ $45/site/month, 15 sites ≈ $6,480–$8,000/year, per `prd.md:38-40`) with the
   RecopyFast-side column reading "one flat plan — pricing TBD" (not fabricated — `s13` hasn't
   shipped a number). `multi-site-management` uses operational-friction framing (logins/workflows
   per client site) rather than a dollar figure, per the design doc.
   - Test: the `client-content-updates` page contains the sourced CloudCannon figure and its
     RecopyFast-side card contains no dollar-amount pattern (asserts absence of fabricated
     pricing).

## Run interdicts

- Do not fork or add props to `src/components/sections/{Hero,Benefits,ValueProposition,
  HowItWorks,Pricing,FinalCTA}.tsx` — the design doc explicitly rules this out as a thin-content
  risk; build new, purpose-built section components from `ui/` primitives instead.
- Do not ship "start your trial" or any trial-framed CTA copy — "Sign up free" / "Get started"
  only, until `s01` ships and the copy question is revisited.
- Do not fabricate a RecopyFast-side price in the agency math section — "pricing TBD" until `s13`
  ships a real number.
- Do not add `SoftwareApplication` or a `LocalBusiness`-adjacent JSON-LD type to these pages —
  `FAQPage` + `BreadcrumbList` only.
- Do not write new route-generation, JSON-LD, or sitemap-merge mechanics — reuse `s17`'s exactly.
  If this story needs anything beyond a `[slug]/page.tsx` + data module + sitemap block per
  template, stop and report that `s17`'s engine needs fixing rather than special-casing here.

## The point everything turns on

Task 6's cross-cluster similarity check is the load-bearing deliverable of this whole plan —
every other task is templated content rendering that `s17`/`s18` already prove works
mechanically. Research names this story's own vertical pages as the highest thin-content risk in
the whole cluster set (four pages sharing one product, differing only by a swapped noun unless
the checklist genuinely varies). If the similarity threshold is set too loose, that risk ships
silently; too strict, and legitimately shared boilerplate (Header/Footer/CTA) trips false
positives across unrelated pages. Tune the threshold against a real pairwise run over all seeded
pages (5 alternatives + 8+ cms-for + 4 for + 2 agencies) before trusting the number, not against a
guess.

Second, smaller point: the undeclared `s01` edge is a copy-truthfulness risk, not an engineering
one — verify at `/ks-review` that nothing on these pages implies a trial that doesn't exist yet.

## Files touched

- `src/content/for.ts`, `src/content/agencies.ts` (new)
- `src/app/for/[vertical]/page.tsx` (new)
- `src/app/agencies/[useCase]/page.tsx` (new)
- 1–2 new purpose-built section components (checklist grid, math comparison card) composed from
  `src/components/ui/` primitives — not under `src/components/sections/`
- `src/lib/content/similarity.ts` (new)
- `src/app/sitemap.ts` (edit — add for/agencies blocks)

## Test strategy

Jest + Testing Library for: data validators, route rendering per template, JSON-LD-matches-content,
sitemap merge, CTA-copy guard, sourced-figures content assertion. The cross-cluster similarity
check (task 6) runs as its own Jest test importing rendered output from all four clusters
(`alternatives`, `cms-for`, `for`, `agencies`) — the one test in this plan whose scope extends
beyond this story's own files, deliberately, since the AC it enforces is site-wide.

## Definition of Done

Repo DoD (lint, type-check, build, test green; single PR; review passed) plus:
- All 4 vertical and 2 agency pages render with distinct, vertical/use-case-specific content.
- Sitemap includes all 6 URLs; JSON-LD validates and matches rendered FAQ content.
- The cross-cluster similarity check passes for real content and demonstrably fails its negative
  control.
- No page's CTA copy implies a trial; the agency math section cites real sourced figures with no
  fabricated RecopyFast-side price.
