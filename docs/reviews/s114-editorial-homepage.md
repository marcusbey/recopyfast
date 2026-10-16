# Review — s114 editorial homepage

## Scope and verdict

Reviewed the current `feature/s114-editorial-homepage` working diff against the validated implementation plan, approved composition, editorial website guide, repository rules and relevant CSP/analytics contracts. The implementation covers the requested homepage, ephemeral editable hero, real demo placement, `/product` preservation, catalogue pricing, shared shell variants, metadata, sitemap and route analytics.

No critical, major or minor defect remains after review fixes. The implementation plan now distinguishes completed local verification from the remote PR CI/security/migration gates that remain for the shipping phase.

## Plan compliance

- `/` retains the server metadata and catalogue-backed SoftwareApplication JSON-LD wrapper while rendering the new editorial composition.
- `/product` renders the existing complete `HomePage` implementation, with its own canonical/title/Open Graph metadata and sitemap entry.
- Header and footer anchor links preserve `/product#features` and `/product#pricing` on the legacy route while the new homepage keeps the root anchors.
- The hero has three explicit editable headline lines and two editable supporting-copy lines. Edits stay in the current DOM only; tests verify no fetch or storage write.
- The automatic sequence curves to `site`, completes `site` → `website`, then `stuck` → `done`; reduced motion, real interaction, visibility loss, IME composition and unmount cleanup have regression coverage.
- The real existing `InteractiveHero` is mounted in the section immediately following the editorial hero; `/demo` is unchanged.
- Catalogue-backed `Pricing` and the founding offer keep the existing loading/error/checkout behavior. The scoped editorial variant removes glass, gradients, shadows, sky colors and large radii without altering the default/legacy branch.
- The shared design guide and route inventory describe staged migration rather than claiming the whole application was redesigned.

## Security and correctness

- Hero edits are neither persisted nor transmitted. No API, schema, migration, billing or embed contract changed.
- Native anchors at marketing-to-auth/dashboard boundaries are intentional and documented under ADR 059 so the destination receives a fresh nonce-policy document.
- `/product` was added to the existing marketing analytics allowlist so cookie controls and document-boundary behavior remain coherent.
- The approved corrected-hand illustration is the optimized hero asset. Images have explicit dimensions/responsive sizing, and decorative closing artwork has empty alt text.
- No invented customer, revenue, savings or product behavior claim was introduced.

## Regression evidence

- Reviewer-run focused suites: 9 suites, 196 tests passed for the hero, editorial page, Header, Footer, SEO canonicals/JSON-LD, sitemap-related integration, analytics routes and CSP document boundaries.
- Reviewer-run full suite with the repository's test origin forced to `http://localhost:3000`: 537 suites passed, 2 skipped; 8,021 tests passed, 38 skipped.
- A first full-suite run without that override had 14 failures only in two pre-existing comparison suites because the worktree environment supplied `https://www.recopyfa.st` while those tests intentionally assert localhost. Both affected suites passed 40/40 with the expected override.
- Reviewer-run `npm run lint`: passed with 0 errors and 33 existing warnings.
- Reviewer-run `npm run type-check`: passed.
- Reviewer-run `npm run format:check`: passed.
- Reviewer-run `git diff --check` and targeted ESLint for the final pricing/footer changes: passed.
- The executor reported `npm run type-check:build` and the production build passing. I did not rerun a concurrent build in the reviewer lane.

The tests demonstrated sensitivity during review: adding pathname-dependent Header behavior initially made 11 existing Header tests fail until its navigation mock and `/product` anchor assertions were repaired. The initially absent IME, positive animation-order, mid-animation interruption, visibility and unmount cases were added and pass. I did not perform a temporary source neutralization in the shared worktree while the executor was actively editing it.

## Browser evidence and remaining limits

The saved browser checklist and desktop/mobile screenshots record local preview checks at 1,440px, 390px and 320px: the corrected illustration, exact three-line hero, animation order, visitor editing/reload reset, real Bella Vista demo edit/save/reset, `/product` legacy page and canonical, mobile menu, pricing anchor and no document-level horizontal overflow. I reviewed those artifacts but did not personally repeat every gesture in the reviewer lane.

Not independently reverified here: production deployment, live third-party checkout completion, a real mobile IME, or screen-reader announcements. Before deployment, keep the manual ship strategy and perform the normal PR/CI review. Exclude the unrelated generated `AGENTS.md` block from the s114 story commit as directed by the integration owner.

## Findings

No open findings.

Max severity: none
Ship allowed: yes
