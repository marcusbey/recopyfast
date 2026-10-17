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

## Docs-only retrospective follow-up — 2026-10-12

Fresh-context review of the two retrospective backfills only:

- `docs/research/s98-maintenance-cost-calculator.md`
- `docs/designs/s98-maintenance-cost-calculator.md`

The review baseline was `origin/main` at `bc6e503`. The branch head is the old s98 feature head
`05bdbca`; its staged main-integration entries compare cleanly with `origin/main` and were not
treated as new s98 work. No source, test, plan, research or design file was changed by this review.

### Checks performed

- Compared every behavioral claim with the calculator source, its direct unit/component/page tests,
  the current s98 plan and the existing review.
- Compared the UI description with `docs/design-system.md`, the merged s96 free-tools design and the
  current `/tools` implementation. The fixed colors in the exported result card are accurately
  identified as an external-host contract; the surrounding page follows the accepted pinned-light
  free-tools surface.
- Confirmed that the backfills identify themselves as retrospective and do not claim that research,
  design, plan validation or review preceded implementation.
- Confirmed the local history: `9541589` is the s98 merge commit for PR #92, and `05bdbca` contains
  the reviewed live-region, cents/rounding and empty-field fixes described by the research.
- Ran the six direct calculator/page Jest suites under the repository's Node 24 test environment:
  **6 suites passed, 99 tests passed, 0 failed**.

Mutation testing was not repeated: this follow-up changes documentation only, and the assigned write
scope permits only this review append. The original independent review already records the s98 code
fixes; this pass independently read the tests and ran the focused suites without changing source.

### Findings

1. **Minor — merge/source evidence is described as “shipped”.** Both backfills repeatedly call the
   code, page, feature or interaction “shipped” while anchoring the reconstruction only to
   `origin/main` and expressly stating that no production access occurred. In this repository,
   merge, deployment and browser observation are separate evidence lanes. Replace “shipped” with
   “merged” or “current source on `origin/main`” unless a separate deployment record is cited. The
   explicit retrospective disclaimers prevent this wording from becoming a false pre-implementation
   approval claim, but the status word is still stronger than the evidence reviewed here.
2. **Minor — assistive-technology effect is stated more strongly than the tests prove.** The DOM
   tests prove that the polite live region keeps its old text during typing and receives the final
   headline after 500 ms. They do not prove how a real screen reader queues or speaks that mutation.
   The research sentence that the debounce “does not queue” announcements and the design sentence
   that it “prevent[s] queued announcements” should be framed as intent. The research correctly
   discloses that no attended screen-reader transcript exists.
3. **Minor — part of the responsive section is implementation intent, not measured capture.** The
   existing Playwright spec measures the working 390 px flow and asserts document scroll width is at
   most 390 px. It does not capture the 1440 px layout or directly measure every wrapping, control
   width, card-capping, FAQ and CTA statement in the design. Label those remaining claims as intent
   inferred from the current Tailwind classes. The research already discloses the absence of a fresh
   390/1440 cross-browser visual capture; the design should preserve that boundary where it states
   the responsive contract.

No critical or major defect was found. The arithmetic, URL contract, inert card shape, timer values,
empty state, source ownership, design-system references, PR #92 review history and test inventory are
otherwise supported by the current repository.

### Could not verify in this pass

- Production deployment or the rendered production page; no production/provider access was used.
- Current GitHub open/closed status for PR #94. Local refs support the separate unmerged
  `s107-google-analytics` branch and its PR #94 identity, but provider state was intentionally not
  queried.
- Real screen-reader output, 1440 px rendering, cross-browser visual behavior, or CMS preservation of
  the pasted card. A human follow-up would open the production build at 390 px and 1440 px, run the
  calculator with keyboard and an attended screen reader, and paste the card into representative CMS
  editors.

Max severity: minor
Ship allowed: yes

### Resolution recheck — 2026-10-12

The author changed only the two retrospective backfills and resolved all three findings:

- “shipped” status wording now says merged code/current page source on `origin/main`;
- the 500 ms live-region benefit is explicitly intent, with tests limited to DOM timing and no
  claim of attended screen-reader behavior;
- the responsive section is explicitly a CSS-derived contract, distinguishes the existing 390 px
  flow/no-horizontal-scroll check, and discloses the lack of fresh 1440 px or cross-browser capture.

The repaired wording remains retrospective and does not create pre-implementation approval,
deployment, production-browser or assistive-technology evidence. No tests were repeated for this
prose-only correction; the focused 6-suite, 99-test passing run above remains the source-behavior
evidence.

No unresolved finding remains in the two docs-only artifacts.

Max severity: none
Ship allowed: yes
