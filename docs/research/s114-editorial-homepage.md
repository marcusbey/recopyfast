# s114 — editorial homepage research

Baseline: origin/main a58b6fc; isolated worktree feature/s114-editorial-homepage. Main checkout is older than remote; do not implement against its stale page shape.

- `src/app/page.tsx` is a server wrapper providing canonical /, complete Open Graph metadata, 300s catalogue-based SoftwareApplication JSON-LD. Keep this wrapper and its catalogue truth.
- `src/components/landing/HomePage.tsx` is the old client composition, using Lenis, SkyBackground, Header, Hero, HeroDemo, ValueProposition, HowItWorks, Benefits, Pricing, FinalCTA, Footer. Preserve it at /product; avoid copying divergent implementations.
- `src/components/landing/InteractiveHero.tsx` is the actual working React-state demo with three sample layouts, EditableText, EditableImage, floating editor and changes bar. Reuse directly under the new hero. Its attract behavior already stops after interaction and honors reduced motion. New hero and this demo should not run competing animations while offscreen.
- `src/app/demo/page.tsx` uses the same InteractiveHero. Keep route behavior and no backend/token dependency.
- `Header.tsx` owns auth-aware navigation and mobile menu; Footer owns pricing/features anchors, product/docs/tools/legal links and cookie settings. Scope editorial variants to the new composition first; retain legacy defaults.
- `src/app/sitemap.ts` lists public indexable routes. /product needs its own canonical/title and sitemap entry. Preserve /#features and /#pricing anchors on new homepage so existing links still work.

## Route inventory and migration order

| Group | Routes | Treatment |
|---|---|---|
| First release | /, new /product | new editorial home; preserve complete old page on /product |
| Demo/onboarding | /demo, /try, /docs/install | next branded shells; preserve demo/install behavior |
| Acquisition | /compare, /compare/[competitor], /tools, /tools/website-maintenance-cost, /tools/website-spell-checker, /tools/[slug]/r/[id] | shared editorial shell; retain forms/results and report noindex |
| Reading | /blog, /blog/[slug], /privacy, /terms | article typography and shell; retain content/SEO/legal text |
| Auth | /login, /signup, /auth/error | restrained brand framing; preserve callback/redirect and noindex |
| Product | /dashboard and sites/people/install/settings/billing/changes/teams/analytics; /settings; /edit | later surface-specific adaptation, no global serif override or permission changes |
| Catch-all/internal | auth/dashboard/edit missing routes, _ab-tests | preserve intentional error/retired behavior, not public landing pages |

Prototype is a visual reference, not production code: it needs cancellation/unmount cleanup, real keyboard/IME/paste tests, bounded text handling, image optimization and stable layout validation. No new package required. Do not carry prototype debug labels or asset gallery into production.
