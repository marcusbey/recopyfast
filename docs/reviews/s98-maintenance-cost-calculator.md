# Review — s98-maintenance-cost-calculator

Implementer's self-check, written before the independent `/ks-review`. It is evidence for the
reviewer, not the gate.

## What was built

- `src/lib/tools/maintenance-cost/`: `calculate.ts` (pure arithmetic and clamping), `params.ts`
  (URL state), `embed-snippet.ts` (copyable HTML card), `copy.ts` (pinned copy).
- `src/components/tools/maintenance-cost/`: `CostCalculator` (client), `CostResultCard`, `EmbedSnippet`.
- `src/app/tools/website-maintenance-cost/`: static `page.tsx`, `opengraph-image.tsx`, `twitter-image.tsx`.
- Shared touch points (s98 merging first, additive): `buildWebApplicationLd` in `json-ld.ts`; one
  sitemap row; one llms.txt "Free tools" section.
- Playwright +1 (93 to 94) in `playwright.config.ts`, `.github/workflows/ci.yml` and the contract test.

## Checks against the plan

| Plan item | Result |
|---|---|
| Pure calculation, no hidden multiplier | Every term is typed by the visitor; the formula sentence states them all |
| Clamp, never reject; non-finite gives default | `clampInputs`; tests for NaN, Infinity, negatives, `1e9`, junk strings |
| URL state reads six keys by name | `parseParams` uses `.get` only; `__proto__`/`constructor` test |
| Debounced `router.replace` 300 ms, no call when unchanged | Component test with fake timers |
| Card is inert HTML, escaped, origin from the server | No script/style/class/handler; hostile-string test; origin is a prop from `resolveSiteUrl()` |
| Static page under `Suspense` | Build route table shows the page as static (`○`); source test pins `Suspense` |
| `/signup` is a native anchor with the tools UTMs | Page test and the ADR 059 boundary test (file added to `MARKETING_BOUNDARY_FILES`) |
| No analytics, no API, no server surface | None added |
| Claims ledger | Forbidden-phrase test over the rendered page; numbers are labelled "Your numbers" |

## Deviations and notes for the reviewer

1. **Honesty line reworded.** The plan pinned "Your numbers, not ours. ReCopyFast doesn't publish
   averages or time-saved figures." but the same plan's claims test forbids `/time.?saved/i`, so the
   two cannot both hold. The line now reads "...averages, benchmarks or savings estimates." The
   architect may prefer the original text with the test excluding that sentence.
2. **No `docs/designs/s98-maintenance-cost-calculator.md` exists** on this branch; the layout follows
   `/compare` and `/try` and the design system's `Input`, `Label`, `NativeSelect`, `CodeBlock`.
3. **Plan test list vs repo:** the canonical is asserted through `seo-canonicals.test.ts` (node
   environment, needed for Next's metadata merge) rather than in the jsdom page test.
4. **Middleware:** `/tools/...` is not in `isSessionlessPath`, so a request still pays a session
   lookup before the static page is served, like `/compare`. Left for s96's CSP and middleware task.
5. **Local e2e:** run against `next build` + `next start` with placeholder Supabase public env (the
   browser client throws without it at build time); no `next dev`.
6. **OG image** is a local copy; s96 folds it into `renderToolOgImage`.
7. Breadcrumb JSON-LD is Home then the page; the "Free tools" crumb waits for `/tools`.

## Mutations the reviewer should try

Drop a clamp; remove `escapeHtml`; read `window.location.origin` for the snippet; remove `Suspense`
(the build turns the route dynamic); route `/signup` through `Link`.

Max severity: pending
Ship allowed: pending
