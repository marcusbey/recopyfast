# Review — Story s47b-founding-20-landing

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff main...feature/s47b-founding-20-landing` — one commit `6764db9`, on
> `main` = `origin/main` = `0fdb6e0`. 22 files, +3,408 / −82.
> Judged against `docs/plans/s47b-founding-20-landing.md` (validated), the landing sections of
> `docs/research/s47a-founding-20-grant.md`, `AGENTS.md`, `docs/decisions/` (ADRs 003, 005, 014,
> 020, 039 and 041 read), `docs/design-system.md` and `docs/designs/s47b-founding-20-landing.md`.
> Reviewer environment: worktree `.omx/worktrees/s47b-founding-20-landing`, CI placeholder env,
> `RCF_TEST_SUPABASE_CONFIG` = dead config (59998/59999), `RCF_TEST_DB_URL` and
> `RCF_REQUIRE_TEST_DB` unset. The host load average stayed between 790 and 950 throughout.

## Plan compliance
- [x] The code does what the plan specifies, nothing more.
  - All six tasks are present, one for one:
    - T1: `useFoundingOffer.ts` holds the view type, the parse, the view mapping and the hook,
      in the `{data, loading, error, refetch}` shape.
    - T2: the copy module, the Hero pill slot, the line under the buttons, and the amended CTA
      comment.
    - T3: `FoundingOfferCard`, the Pricing trust lead, the additive `creditsPerPack`, and the
      prop-only edits.
    - T4: the FinalCTA lead and its teal dots, plus the page-level one-request test.
    - T5: E2E-017's three phases and E2E-016's narrowed locator.
    - T6: the stories tick and the Execution log.
  - Additions outside the plan are all declared in the plan's "Deviations" and in the commit body:
    - the `renderToString` first-paint assertion;
    - `export {}` in `pricing-credit-pack.test.ts`;
    - the local `FoundingOfferPill` and `pillLines` helpers;
    - the `hero-demo-mobile.spec.ts` approach change (the lead's option a).
  - I found nothing undeclared.
- [x] Run interdicts respected. Each was checked mechanically:
  - `public/embed/**`, `supabase/`, `src/app/api/offers/founding/route.ts` and
    `src/lib/billing/**` have empty diffs.
  - The rebuilt embed left the tree clean.
  - `grep "offers/founding" src` (excluding tests) lists only the route and `useFoundingOffer.ts`.
  - Of the eight client files, only the hook imports from `@/lib/billing`, and that is
    `import type`. None imports `@/lib/supabase`.
  - The diff adds no Context or Provider, no `localStorage`/`sessionStorage`, no timer, no
    polling and no module memo.
  - No `emerald` class and no app token (`bg-primary` etc.) appears in the touched sections. The
    word "emerald" survives only in the required tombstone.
  - Byte-identical: the Founding Agency card, s50's comment under `TRUST_POINTS`, FinalCTA's pill
    and amber spans, and `src/app/try/page.tsx`.
  - E2E-010 to E2E-015 and E2E-018 are untouched.
  - `playwright.config.ts`, `.github/`, `e2e/support/`, `AGENTS.md`, `docs/architecture.md` and
    `docs/design-system.md` have empty diffs.
  - `/api/pricing` changes only by the optional field, its type and its comment.
  - `Pricing.agency.test.tsx` and `homepage-truth.test.tsx` change only by `offer=` props.

## Anti-hallucination
- [x] No invented API, function or import. Each was opened:
  - `FoundingOfferAvailability` in `src/lib/billing/founding-offer.ts`;
  - `Rocket` and `Check` in lucide-react 0.539, which sets `aria-hidden` by default;
  - `.glass`, `.tabular` and `.pressable` in `globals.css`;
  - `catalogue.creditPack.creditsPerPack` (`plans.ts:494`);
  - `useLenis` as a named export, `Header` as a named export, and `Footer` as a default export,
    all matching the page test's mocks;
  - `aria-label="Loading pricing"` (`Pricing.tsx:219`);
  - `FOUNDING_OFFER_TERMS.founding_20.monthlyCredits`, `TRIAL_DURATION_DAYS`, and the
    migration's `NOW() + INTERVAL '90 days'`.
- [x] No plausible-but-wrong value. The copy was checked word by word against what s47a grants.
  - 20 spots: the SQL constant, returned as `spot_limit` and rendered from the count's `limit`.
    It is never a literal.
  - 90 days: the migration's `INTERVAL '90 days'`, shown as "3 months" or "90 days".
  - 100 AI credits a month: `FOUNDING_OFFER_TERMS` and ADR 039.
  - No card, and nothing charged at the end: the grant is a trial row with no Stripe customer.
  - 5 websites: Pro's `limits.websites` is 5.
  - Invited editors: Pro's `collaborators` is 5.
  - AI suggestions: `ai_features: true`.
  - After the offer, the 14-day trial: `TRIAL_DURATION_DAYS = 14`.
  - "Your site keeps serving its content either way": ADR 041 never gates public delivery.
  - "Need more AI before then?": credits need a plan (ADR 041), and an offer account holds one.
  - None of s50's retired claims is reintroduced: a grep of every added line for money-back,
    refund, guarantee, any site, priority, future, unlimited and forever returns nothing.
  - The parser is at least as strict as `getFoundingOfferAvailability`, clause for clause.
  - Production's `GET https://www.recopyfa.st/api/offers/founding` returned
    `{"limit":20,"remaining":20,"soldOut":false}` with `cache-control: no-store` (one read-only
    GET). The parser accepts it, since `remaining == limit` is in its accept table.
- [x] The code matches its claims, with one exception: a test comment overclaims (minor 1).

## Rules compliance
- [x] Repo conventions (AGENTS.md):
  - The server-state hook has ADR 005's shape. A non-ok response or unparsable body is an error
    state, never data.
  - Validation is hand-rolled; there is no zod (ADR 003).
  - `"use client"` is on line 1 of the hook.
  - Naming is correct: `FoundingOfferCard.tsx`, `useFoundingOffer.ts`, `founding-offer-copy.ts`,
    `BENEFITS`, and the `is*` booleans.
  - The tombstones follow the house style.
  - Every test change is declared in the commit body.
  - Single-page hooks already live in `src/hooks/` (useABTests, useSiteActivation, useTheme), so
    the hook's location is not ADR 005 drift.
- [x] No accepted ADR is contradicted:
  - 039: the copy states the grant's terms exactly.
  - 041: the "keeps serving" and credits sentences are true.
  - 014: the 14-day line.
  - 020: marketing surface.
- [x] Design system respected. Everything is on the Marketing surface:
  - The palette is limited to `teal-50/500/600/700/800`, `slate-600/700/800/900`, `sky-100` and
    white. All of these are already in use on the landing (design gap 1).
  - There is no emerald, no app token and no second hue.
  - The card is flat `bg-white` with no gradient or shadow, as designed.
  - Numbers are in `.tabular`.
  - Copy is in sentence case, with no exclamation marks and no scarcity theatre.
  - Reduced motion is handled: `motion-reduce:animate-none`.
  - The screen matches the design's intent:
    - one count feeds all three places;
    - Loading is an `aria-hidden` glass pill (not a link) and "Free trial";
    - Failed renders the same as Sold out;
    - the card renders only while spots remain;
    - the Hero slot has a fixed height.
  - Measured in Chromium at 320/360/390/768/1440 px, open/last/closed:
    - the pill is 38 px tall in every state;
    - its widest phone form is 286 px at 320 px, with no horizontal overflow
      (`scrollWidth == innerWidth`);
    - the full form appears from 768 px (511 px wide).
  - Accessibility:
    - The pill's accessible name is its visible text for the viewport (the hidden span is
      excluded), for example "14 days of Pro, free" at 390 px.
    - "Claim your spot" is a named link to `/signup`.
    - Card contrast, from Tailwind values on white: `slate-600` about 7.6:1, `teal-800` about
      7.6:1, white on `teal-700` about 5.5:1.
    - The global `:focus-visible` ring is not overridden.
  - The 0.8 s entrance motion on the pill slot copies the `h1` (plan decision 8). The 2 s
    `animate-pulse` is design gap 3 with a precedent. Neither is a finding.

## Tests
- [x] I ran the suite myself; it passes, with one unrelated timeout.
  - Full Jest (CI env, dead DB config): suites 306 passed, 1 failed, 2 skipped. Tests 3,976
    passed, 1 failed, 38 skipped.
  - The failure is a 5 s timeout in `src/__tests__/components/dashboard/WebhooksPanel.test.tsx`,
    under a load average of about 950. This diff doesn't touch it, and rerun alone it passes
    12/12.
  - Story suites (8, including `pricing-agency.test.ts`): 95/95.
  - `type-check`: 0 errors.
  - `lint`: 0 errors (35 existing warnings). `eslint` on the 13 story files is clean.
  - `prettier --check` on every touched file, e2e included: clean.
  - `npm run build`: green.
  - `playwright test --list`: **44**.
  - Local Playwright (`next start` on my own build of HEAD, one worker, no retries): E2E-017
    passed, which includes the `h1` staying within 1 px when the count arrives. Both
    `hero-demo-mobile` tests passed.
  - No-flash, checked on the production build's server HTML (`curl http://127.0.0.1:3000/`):
    - the Hero slot is exactly
      `<div class="mb-6 flex h-[38px] justify-center" …><div aria-hidden="true" class="glass
      h-[38px] w-[17rem] animate-pulse rounded-full motion-reduce:animate-none
      md:w-[22rem]"></div></div>`;
    - "14 days of Pro", "spots left", "3 months", "14-day free trial", "Claim your spot" and
      "Founding offer" each occur **0** times in the whole document, RSC payload included;
    - "Free trial" occurs 2 times, and "No credit card required." once.
- [ ] Assertions pin the acceptance criteria. They do, except the phone form of the Hero pill
  (major 1). There are no assertion-free tests.
- [x] Bite proven by neutralization. Each mutation was applied alone, the story suites run, then
  restored with `git checkout`. `git diff --exit-code` and `git diff --cached --exit-code` were
  clean after each one and at the end.

  | # | Neutralized | Red |
  |---|---|---|
  | M-A | `toFoundingOfferView`: loading returns `{open, 20, 20}` (the offer shown while loading) | **2**: view "is loading…", page "shows neither promise while the count loads" |
  | M-B | Module-level memo of the last good count, reused as `data` on a failed fetch (a stale number) | **9**: 5 hook "reports … never a number" and 4 page "falls back to the 14-day trial everywhere" |
  | M-C | Closed-state short (phone) pill line becomes "Pro free for 3 months" | **0**, see major 1 |
  | M-D | Drop `if (!isCurrent()) return;` before `setData(availability)` | **0**, see minor 1 |
  | M-E | Parse drops `soldOut === (remaining === 0)` | **2**: "refuses not soldOut at zero", "refuses soldOut with spots left" |

  **The declared `hero-demo-mobile` change, checked by neutralizing the production fix it guards.**
  I set `InteractiveHero.tsx:800` to `overflow-y-auto` while page-driven, which brings back the
  A-32 snap-back, and rebuilt:
  - Branch spec on the branch build: the swipe test **passed 3/3**. It does not catch the
    regression.
  - Control, main's spec on the same build: 4/4 red, but every failure was the vacuity guard
    ("Received: 0", the demo never moved). That is the layout flake this story fixed; no run
    failed on "went backwards".
  - Control, main's spec on a main-equivalent landing (main's `page`, `Hero`, `Pricing` and
    `FinalCTA` checked out temporarily) with the same regression: **passed 4/4**.

  Conclusion:
  - The rewrite is not a weakening. The assertions are byte-identical, the approach now reaches
    the pin every run (4/4), and the test caught the regression no better before.
  - The swipe test does not catch A-32 in headless Chromium, before or after this story. That is
    pre-existing (see "Outside this diff").
  - All temporary files were restored from HEAD, and HEAD was rebuilt so `.next` matches the
    commit. The server was stopped; port 3000 is free.

## Regressions
- [x] No impact found on existing code paths.
  - `/api/pricing` gains one optional field, only on `credits`. The cache, headers, CORS and
    Founding Agency availability are unchanged, and `pricing-agency.test.ts` passes.
  - `Pricing`, `Hero` and `FinalCTA` now require `offer`. Their only production caller is
    `src/app/page.tsx`: SEO pages reuse none of them with no props, and `type-check` is green.
  - In CI the real count is 20 of 20, so the card is present. I re-read every `#pricing` locator
    in `e2e/`:
    - E2E-016 is fixed.
    - E2E-012 and E2E-018 filter `h3` by exact name.
    - E2E-013's `.first()` anchor resolves to the header's `/#pricing` link; even the pill would
      land on `#pricing`.
    - E2E-015 matches "Most popular" exactly.
    - E2E-014's `toContain` checks can only gain text.
  - Deploy order is safe. My local build had no database; its route answered 503 and the page
    fell back to the trial line (E2E-017 phase 3 covers the same path).

## Findings
- **major** — `src/components/sections/__tests__/trial-claims.test.tsx:131-139` (and the same
  pattern at `:120-129`). The phone form of the Hero pill is never pinned in the sold-out/unknown
  state.
  - `expect(text).toContain("14 days of Pro, free")` is meant for the short `md:hidden` span. But
    that string is a substring of the full form ("Every new account gets 14 days of Pro, free"),
    so the assertion always passes.
  - M-C proves it: a sold-out page telling every phone "Pro free for 3 months" leaves all 90
    story tests green.
  - E2E-017's failed phase would not catch it either, by reading: it runs at desktop width, the
    link name excludes the hidden span, and its negatives ("of 20 spots left", "of 20 left",
    "3 months free") don't match.
  - The last-spot short form has the same flaw: "Pro free for 3 months · Last spot left" is a
    substring of the full line.
  - So AC 2 and AC 3 ("assert both states") hold for the `md`+ form only. The code is correct
    today; the guard is missing.
  - Fix: assert each span's exact text (query the `md:hidden` span). Or, for the closed state,
    add `expect(heroText(container)).not.toMatch(/3 months/)`.
- **minor** — `src/hooks/__tests__/useFoundingOffer.test.tsx:230-252`. "drops a response that
  lands after unmount" only ever resolves a 503.
  - Its comment says it also proves that "a 200 that still ran the success path" can't set
    state. M-D (removing the success-path `isCurrent()` guard) leaves everything green.
  - Real impact is low: an aborted `fetch` rejects before the success path, and the page makes
    one request.
  - The guard's real job is the refetch race. Add a test that calls `refetch` twice and resolves
    the first response last, or correct the comment.
- **minor** — `src/components/sections/FoundingOfferCard.tsx:18-25`. "5 websites" (and the other
  benefits) have no drift guard against Pro's catalogue row (`limits.websites` = 5 today).
  - The plan lists this as a known risk; the 90-day, 100-credit and 14-day terms are guarded.
  - A guard in the style of the 90-day one, reading Pro's `websites` from the migrations, would
    close it.
- **minor** — `docs/designs/s47b-founding-20-landing.md` and
  `docs/designs/s47-founding-20-offer-brief.md` link `s47-founding-20-offer-refs/`, which stays
  untracked (plan decision 9, declared). Once merged, those links dangle on `main` until the
  owner decides whether to commit the 7.6 MB of PNGs or drop the links.

### Outside this diff (pre-existing, not counted in the verdict)
- `e2e/hero-demo-mobile.spec.ts` "two swipes never scroll the demo backwards" does not catch the
  A-32 snap-back it documents (evidence under Tests). It passes with the fix neutralized, on
  `main` as on this branch.
  - This story's new comment ("Measuring keeps the test about the swipes") restates the original
    header's claim, which was never demonstrated ("NOT EXECUTED HERE").
  - Worth its own backlog story: make the swipe start where chaining actually happens, or assert
    the computed `overflow-y` of the page-driven scroller directly.
- `WebhooksPanel.test.tsx` has a 5 s timeout that trips under heavy host load (passes alone).

## Not verified
- **Real phones, Safari, and Firefox.** Everything ran in headless Chromium, including the iPhone
  13 emulation. Safari's missing `backdrop-filter` falls back to 82% white; I did not see it.
  Gesture: open `/` on an iPhone in Safari and on an Android phone in Chrome. Check that the pill
  reads "Pro free for 3 months · N of 20 left", fits on one line, and that tapping it lands on
  the offer card.
- **Pill contrast over the live WebGL sky.** Not instrumented (no image tooling here). Screenshots
  at 390 and 1440 show dark text on light glass, and the FinalCTA pill is the precedent.
  Gesture: check the pill with a contrast picker at dawn/noon sky positions on a real screen.
- **E2E-012 to E2E-016 and E2E-018 on a page with the card.** Not run locally, because they need
  `/api/pricing` from a database. The locators were checked by reading only. PR CI (real count
  20/20) is the first run with the card present. Watch E2E-016 and E2E-018 there.
- **The live count against a real database, and "one request" in a real browser.** Locally the
  route answered 503 (placeholder Supabase), and E2E-017 intercepts it. The one-request claim is
  proven in Jest (`offerCalls == 1`), not in a browser: dev Strict Mode sends two.
  Gesture: after deploy, open `https://www.recopyfa.st/`. DevTools Network should show one
  `GET /api/offers/founding` per load, and the pill, card and both trust rows should all say
  "20 of 20" (or the current count).
- **The sold-out state against production data.** It can only be seen with mocks until the 20th
  claim. Gesture: when `remaining` reaches 0, reload `/` on desktop **and on a phone**. Given
  major 1, the phone form is the one no test covers.
- **Screen readers.** Nothing was checked with VoiceOver or NVDA. Gesture: tab from the top of
  `/`. The loading pill must not be a focus stop, and the loaded pill must announce its full
  text as a link to the pricing section.
- **Stripe amount formatting.** `creditPack.price` renders raw (`$19`), like the section's other
  prices. A non-integer Stripe amount would render as `$19.5`. It was never exercised with a live
  Stripe price.

## Verdict
One major (a missing test guard for the phone form of the sold-out Hero line; the code itself is
correct) and three minors. No critical. Every word of offer copy matches what s47a grants, the
first paint promises nothing, and the three places read one request.

## Product owner disposition (orchestrator, 2026-09-28)

- **Major fixed at `326cfef`** (fix run, test-only): the phone Hero pill copy is pinned for the
  sold-out and last-spot states; changing either phone line turns its test red (mutation proof).
- **Minor 1 fixed:** the unmount test now covers a late 200 as well as a 503.
- **Minor 3 fixed:** design docs say "local reference screenshots (not committed)".
- **Minor 2** ("5 websites" not tied to Pro's catalogue limit) → s53 hardening.
- **Pre-existing gap noted by the reviewer:** hero-demo-mobile's swipe test does not catch the
  snap-back bug it was written for (on `main` too) → backlog story.


Max severity: major
Ship allowed: yes
