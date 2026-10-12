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

## Independent review findings and fixes

The independent review allowed ship at max severity minor, on condition that three minors were
fixed first. Each was fixed test-first on the same branch.

| # | Finding (minor) | Fix | Tests |
|---|---|---|---|
| 1 | `role="status"` wrapped the whole result, which changes on every keystroke, so typing "1200" queued several long announcements | The only live region is now a screen-reader-only line holding the headline figure, updated 500 ms after typing stops. The visible result panel is no longer live | Live text is unchanged mid-burst and equals the final figure after 500 ms; it carries no formula; the panel has no `aria-live` ancestor |
| 2 | Values were snapped to each field's step with no hint (59.50 became 60, 2.3 sites became 2, 0.2 changes became 0) | The hourly rate keeps cents (step 0.01, shown as "$59.50" only when it has cents). A new `describeFieldRounding` shows a neutral "Rounded to N" note under any in-range value that is off its step; range errors keep `aria-invalid`, the rounding note does not | `calculate.test.ts` for cents and `describeFieldRounding`; component tests for "Rounded to 2", "0", "2.5", "59.56" and for 59.5 passing silently |
| 3 | An emptied field fell back to the default, so the result read $4,800 over an empty box | While any field is empty the panel shows "Fill in all fields to see your number"; the card, its HTML and the URL update are suppressed until the form is complete | Placeholder text with no money in the panel; card and copy button hidden then restored; no `router.replace` while incomplete |

Local re-check after the fixes: Jest for the touched areas, a fresh `npm run build` (route still
static) and the Playwright spec against `next start` all pass.

Max severity: minor
Ship allowed: yes
