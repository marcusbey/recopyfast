---
validated: yes
---
# Plan — Story s47b-founding-20-landing

Branch: `feature/s47b-founding-20-landing`, from `main` **after s47a and s50 have both merged**
(see Preconditions). Worktree: `.omx/worktrees/s47b-founding-20-landing`. Every gate runs there,
never at the repo root.
Research: `docs/research/s47a-founding-20-grant.md`, which covers s47b in its landing sections
("Landing copy", "Public count caching", "Tests pinned to today's copy", "Local gates"). Read those
sections first; this plan does not repeat them.
Design: `docs/designs/s47b-founding-20-landing.md`. The story's link to
`docs/designs/s47-founding-20-offer.md` is stale: that file does not exist, and the s47b design
replaces it. The `.html` next to the design is a reference mockup. Never copy code from it.

Line numbers below are for `main` at `a392bb1`, before s50. s50 moves some of them (see "Base and
overlap with s50"), so find each spot by its content on the post-s50 base.

## Target story

While spots remain, the landing page shows "First 20 users get ReCopyFast Pro free for 3 months"
with a live count read from s47a's `GET /api/offers/founding`. The route returns
`{limit, remaining, soldOut}`, or a 503 with no number. It shows up in three places:

- the Hero announcement pill;
- a Pricing offer card;
- the first item of both trust rows (Pricing and FinalCTA).

All three read **one** request, so they cannot disagree. At 0 spots, or when the count is unknown,
all three show the 14-day trial. The page never shows a guessed, cached or stale number. While the
count is loading, the page promises neither the offer nor the trial, so there is no trial→offer
flash. The FinalCTA dots move from `emerald-500` to `teal-600`. There is no migration, no embed
byte, no Stripe change and no production action.

| AC (docs/stories.md s47b) | Tasks | Named tests |
|---|---|---|
| 1 While spots remain: the hook plus a live "X of 20 spots left", as designed | T1–T4 | `useFoundingOffer` "reads a valid count"; trial-claims "Hero › spots left: the full and the short hook, with the count"; `Pricing.founding-offer` "shows the offer card between the subtitle and the billing toggle"; `landing-founding-offer` "asks for the count once, and the three places agree"; E2E-017 phase 2 |
| 2 At 0 or unknown: the 14-day trial line, never a stale or guessed number, no flash | T1–T5 | `parseFoundingOfferAvailability` table; "a failure and a sell-out are the same view"; `landing-founding-offer` "shows neither promise while the count loads" and "falls back to the 14-day trial everywhere (%s)"; E2E-017 phases 1 and 3 |
| 3 Every replaced "14-day free trial" claim updated consistently; `trial-claims` and the Playwright landing check assert both states | T2–T5 | trial-claims `it.each` over the four states for Hero, Pricing and FinalCTA; E2E-017 |
| 4 Gates in a worktree; one commit; no push, PR, merge or production action | T6 | gates list in T6 |

## Base and overlap with s50

s50 (`docs/plans/s50-homepage-truth.md`) edits the same files. s47b is written against the page
**as s50 leaves it**, and the design assumes that too: no money-back guarantee anywhere, and the
FinalCTA pill reads "Set up in minutes". Branching after s50 merges means git reports no merge
conflict. These are the hunks that overlap, and so they would conflict if the order ever changed.
Re-read each one on the post-s50 base before editing it:

| File | s50 does | s47b does | Expected post-s50 content |
|---|---|---|---|
| `src/components/sections/Pricing.tsx:63-74` | Deletes `:73` (the guarantee). Adds a comment directly **below** `];`. | Rewrites the tombstone `:63-68` and removes item 1, `:70`. | A three-item array: "14-day free trial", "No credit card required", "Cancel anytime". Then s50's comment. **Conflicts** (adjacent hunks). |
| `src/components/sections/__tests__/trial-claims.test.tsx:56-66` | Deletes `:63-65`. | Rewrites the `Pricing` describe (T3). | The `Pricing` test asserts three trust points. **Conflicts.** |
| `e2e/landing.spec.ts:182-204` (E2E-017) | Deletes `:203`. | Rewrites E2E-017 (T5). | E2E-017 without the guarantee line. **Conflicts.** s50's plan predicts this and resolves it by taking s47b's block. |
| `src/components/sections/__tests__/homepage-truth.test.tsx` (new in s50) | Renders `<Pricing />` and `<FinalCTA />` with no props. | Adds the required `offer` prop to those renders, and nothing else. | No textual conflict. It fails `type-check` until s47b threads the prop. |
| `src/components/sections/FinalCTA.tsx:31` | Changes the pill to "Set up in minutes". | Leaves it alone. s47b edits `:8` and `:90-116`. | No conflict. The hunks are separate. |
| `e2e/landing.spec.ts:206-233` (E2E-018) | Extends it with the retired-claims loops. | Leaves it untouched (Resolved decision 3). | No conflict. |
| `src/components/sections/Hero.tsx` | Empty diff (s50's interdict). | T2. | No conflict. |

s47a leaves the landing untouched (its plan's interdict at `:403`), so s47a overlaps nothing here.

## Resolved decisions (planner defaults, for the checkpoint)

1. **The count is fetched once, in `src/app/page.tsx`, and passed down as a required `offer` prop**
   to `Hero`, `Pricing` and `FinalCTA`. The page is already `"use client"` (`page.tsx:1`), and
   those three are its only production callers. Two alternatives were rejected:
   - A second Context. AGENTS.md allows exactly one, and "adding a second needs a reason".
   - A module-level shared promise. It would carry a stale count across client navigations, and
     s47a's route was made uncached precisely to avoid that.

   The prop is **required**, so any future caller (for example an SEO cluster page reusing
   `Pricing`) has to decide what to show. Relying on a default would not force that decision.
2. **The pack size for the fine print comes from an additive `creditsPerPack` field** on the
   `credits` entry of `/api/pricing`'s `oneTimeProducts`, read from `catalogue.creditPack`.
   - The design requires "1,000 credits for $19" to come from the pricing payload and never be
     hardcoded. Today the payload carries the price (`route.ts:220-228`) but not the pack size.
   - The price stays the entry's own `price`, which the route overlays with the live Stripe amount.
   - The alternative was to drop the sentence forever, which is what the design's own "lacks either
     value" rule would do. Rejected, because the design clearly means to show it.
3. **E2E-017 carries both states, not E2E-018.** The story names `e2e/landing.spec.ts:196`, which
   is E2E-017. Its "14-day free trial in #pricing" assertion also turns state-dependent in CI, so it
   has to change anyway. E2E-018 stays as s50 leaves it: the retired-claims guard, run on the real,
   unmocked count. It therefore scans whichever state CI serves, which is the offer state, since CI
   applies every migration. **The team lead's brief said E2E-018; overrule here if that was
   deliberate.** Either way the total stays 44.
4. **E2E-016's locator is narrowed.** In CI the real count is "20 of 20", so the offer card renders
   above the plan grid. `pricing.locator('a[href="/signup"]').first()` then resolves to "Claim your
   spot", and the Starter check passes without looking at Starter. The fix is one line; the PR says
   so.
5. **The offer card is its own component, `FoundingOfferCard.tsx`.** `Pricing.tsx` is already 416
   lines. `Pricing` decides whether the card renders; the card decides how it looks.
6. **The shared strings live in `src/components/sections/founding-offer-copy.ts`.** That covers the
   headline and the trust-row lead, both used in more than one section. Keeping them under
   `src/components` puts them inside s50's `retired-promises` scan roots; `src/lib/billing` is not
   scanned.
7. **No polling and no client cache.** The count is read once per page load. The design's fine
   print ("If all 20 are taken when you sign up, you get the 14-day Pro trial instead") covers a
   count that goes stale while the page stays open.
8. **The pill slot shares the `h1`'s entrance motion.** It is a `motion.div` with the same
   `initial`/`animate`/`transition` as `Hero.tsx:65-68`. Its contents swap with no animation of
   their own. The design specifies no motion, so none is added.
9. **Committed docs.** The commit includes the design (`.md`, `.html`) and the parent brief,
   `docs/designs/s47-founding-20-offer-brief.md`. Both s47a's and s47b's designs link to the brief,
   and s47a's commit didn't bring it. The PNG refs (`s47-founding-20-offer-refs/`, 7.6 MB) stay
   untracked: no binaries are committed under `docs/designs/`. The owner decides whether to change
   that.

## Copy (every user-visible string this story adds or changes)

`{limit}` and `{remaining}` come from the response. **20 is never a literal.** "·" is U+00B7 with a
space on each side. "—" is U+2014.

| Where | Loading | Spots left (`remaining` ≥ 2) | Last spot (`remaining` = 1) | Sold out / Failed |
|---|---|---|---|---|
| Hero pill, `md` and up | *(empty pill, no text)* | `First {limit} users get ReCopyFast Pro free for 3 months · {remaining} of {limit} spots left` | `First {limit} users get ReCopyFast Pro free for 3 months · Last spot left` | `Every new account gets 14 days of Pro, free` |
| Hero pill, below `md` | *(same)* | `Pro free for 3 months · {remaining} of {limit} left` | `Pro free for 3 months · Last spot left` | `14 days of Pro, free` |
| Line under the Hero buttons | `No credit card required.` | same | same | same |
| Trust rows, first item (Pricing and FinalCTA) | `Free trial` | `3 months free for the first {limit}` | same as spots left | `14-day free trial` |
| Pricing offer card | not rendered | rendered, count `{remaining} of {limit} spots left` | rendered, count `Last spot left — 1 of {limit}` | not rendered |

Offer card strings:
- tag `Founding offer`;
- `h3`: the pill headline, `First {limit} users get ReCopyFast Pro free for 3 months`;
- description: `Every Pro feature for 90 days, with 100 AI credits a month. No credit card, and nothing is charged when it ends.`;
- benefits: `5 websites` · `Invited editors` · `All sites view` · `AI suggestions` · `100 AI credits a month` · `No credit card required`;
- price: `$0` and `for 3 months`;
- CTA: `Claim your spot` (→ `/signup`).

The fine print is two paragraphs:
1. `After 90 days, choose a plan to keep editing. Your site keeps serving its content either way.`,
   followed by ` Need more AI before then? {creditsPerPack as en-US} credits for ${price}.`. The
   second sentence appears only when both values are finite positive numbers.
2. `Spots go in sign-up order. If all {limit} are taken when you sign up, you get the 14-day Pro trial instead.`

Classes, sizes and layout are the design's §1a–1c. They are not restated here.

## Preconditions (before Task 1; fail closed)

1. `main` contains s47a and s50. Check the content, not a SHA: branch commits squash at merge.
   - `git show main:src/app/api/offers/founding/route.ts` exists.
   - `git show main:src/components/sections/Pricing.tsx | grep -c money-back` → `0`.
   - `git show main:src/components/sections/FinalCTA.tsx | grep -c "Set up in minutes"` → `1`.
   - `git show main:src/components/sections/__tests__/homepage-truth.test.tsx` exists.

   If any check fails, **stop and report**. Do not branch from a partial base.
2. Create the worktree: `git worktree add .omx/worktrees/s47b-founding-20-landing -b
   feature/s47b-founding-20-landing main`. Then run `npm run setup` (root and `server/`).
3. Copy in the untracked docs from the root checkout. Copy nothing else, and never `.env*`:
   - this plan;
   - `docs/designs/s47b-founding-20-landing.md`;
   - `docs/designs/s47b-founding-20-landing.html`;
   - `docs/designs/s47-founding-20-offer-brief.md`.
4. **Keep the DB suites off the shared local database.** Write a TOML file **outside the worktree**,
   for example `"${TMPDIR:-/tmp}/s47b-no-db.toml"`, containing exactly
   `[api]\nport = 59998\n\n[db]\nport = 59999\n`.
   - Every Jest run in this story, including the one the pre-commit hook makes, uses
     `RCF_TEST_SUPABASE_CONFIG=<that path>`.
   - `RCF_TEST_DB_URL` and `RCF_REQUIRE_TEST_DB` are **unset**. `RCF_TEST_DB_URL` takes precedence
     over the config (`db-harness.ts:140-156`), and `RCF_REQUIRE_TEST_DB` turns "unreachable" into a
     failure.
   - Check this once: run
     `RCF_TEST_SUPABASE_CONFIG=… npx jest src/__tests__/db/founding-offer-cap.test.ts`. It reports
     gated or skipped, never a connection to `54322`.

## Tasks (ordered)

Tests come first in every task. Each task threads `offer` into `page.tsx` for the section it
changes, so `npm run type-check` is green at the end of every task.

1. [x] **The count: parse, view, hook.** Create `src/hooks/useFoundingOffer.ts` (`"use client"`),
   test-first in `src/hooks/__tests__/useFoundingOffer.test.tsx`. Follow the shape of
   `useSiteActivation.ts:31-100`: an AbortController, a request counter, and no identity.

   The module exports:
   - `FoundingOfferView`:
     `{status:"loading"} | {status:"open"; remaining; limit} | {status:"closed"}`. `closed` means
     sold out **or** unknown. They are one state on purpose, so no component can render them
     differently.
   - `parseFoundingOfferAvailability(body: unknown): FoundingOfferAvailability | null`. The type is
     `import type` from `@/lib/billing/founding-offer`; never a value import.
   - `toFoundingOfferView({data, loading, error})`.
   - `useFoundingOffer()`, which returns `{data, loading, error, refetch}` (AGENTS.md "Server
     state"). Its initial state is `{data:null, loading:true, error:null}`. It requests
     `fetch("/api/offers/founding", {cache:"no-store", signal})`. A non-ok status, a body that won't
     parse, or a thrown fetch or `json()` sets `error` and leaves `data` null. It logs with
     `console.error`, as the reference hook does. Aborted requests are ignored.

   `parseFoundingOfferAvailability` accepts only these bodies. It is at least as strict as s47a's
   `getFoundingOfferAvailability`:
   - `limit` is an integer ≥ 1;
   - `remaining` is an integer from 0 to `limit`;
   - `soldOut` is a boolean equal to `remaining === 0`.

   `toFoundingOfferView` maps as follows:
   - `data` present and not sold out → `open`;
   - otherwise, `loading` with no `error` → `loading`;
   - otherwise → `closed`.

   Tests:
   - `describe("parseFoundingOfferAvailability")`:
     - `it.each` valid: `{20,17,false}`, `{20,1,false}`, `{20,0,true}`, `{30,30,false}`.
     - `it.each` → `null`: `remaining` 21, −1, 1.5 or `"17"`; `limit` 0 or 2.5; `soldOut:true`
       with `remaining` 3; `soldOut:false` with `remaining` 0; `soldOut:"false"`; a missing key;
       `null`; `[]`; `"x"`; `{error:"…"}`.
   - `describe("toFoundingOfferView")`:
     - loading → `loading`;
     - 17 → `open`;
     - 1 → `open` with `remaining` 1;
     - sold out → `closed`;
     - error → `closed`;
     - "a failure and a sell-out are the same view": `toEqual` between the two.
   - `describe("useFoundingOffer")`:
     - "is loading, with no data, on its first render": fetch stays pending.
     - "requests the count once, uncached": one call with `"/api/offers/founding"` and
       `objectContaining({cache:"no-store"})`.
     - "reads a valid count".
     - `it.each` "reports %s as an error, never a number": 503 `{error}`; 429; 200 with
       `{limit:20, remaining:21, soldOut:false}`; `json()` rejects; `fetch` rejects.
     - "drops a response that lands after unmount": the signal is aborted and no state update
       follows.

   **Red:** the module does not exist. **Green:** write it. No other file changes in this task.

2. [x] **Hero: the pill and the line.** Create `src/components/sections/founding-offer-copy.ts`
   (no directive). It holds `foundingOfferHeadline(limit)` and `foundingOfferTrustLead(offer)`, with
   exactly the Copy-table strings.

   Tests: rewrite `describe("Hero")` in `trial-claims.test.tsx`. Keep the file's header comment and
   add one paragraph to it: the trial claims now follow the founding-offer count (s47b). Fixtures:
   `LOADING`, `OPEN` (17/20), `LAST` (1/20), `CLOSED`.
   - `it.each(all)` "invites a visitor to start free in every state": link "Start your free trial"
     → `/signup`.
   - `it.each(all)` "says only 'No credit card required.' under the buttons": the exact text is
     present, and "14 days of Pro. No credit card required." is absent.
   - "loading: the pill is an unlabelled placeholder that promises nothing":
     `querySelector('.glass.animate-pulse[aria-hidden="true"]')` exists. The caret at
     `Hero.tsx:88-91` is also `animate-pulse`, hence `.glass`. No `a[href="#pricing"]` exists.
     `#hero` text matches none of `/14 days|3 months|spot/`.
   - "spots left: the full and the short hook, with the count": the `a[href="#pricing"]`
     textContent contains both the `md` and the short forms (jsdom applies no CSS, so both spans
     are present).
   - "last spot: 'Last spot left' in both forms, and no '1 of 20'".
   - "sold out or unknown: the 14-day trial, and no number": both closed forms are present, and
     nothing matches `/\d+ of \d+/`.
   - "the 20 is the count's limit, never a literal": with `{remaining:17, limit:30}`, the text
     reads "First 30 users" and "17 of 30 spots left", and nothing contains "20".

   **Red, then green,** in `Hero.tsx`:
   - The signature becomes `Hero({ offer }: { offer: FoundingOfferView })`. Add `Rocket` to the
     `lucide-react` import (`:5`).
   - Insert the pill slot between the wash `div` (`:60-63`) and `<motion.h1>` (`:65`). It is a
     `motion.div` (decision 8) with `mb-6 flex h-[38px] justify-center`. It contains one of:
     - **loading:** `<div aria-hidden="true">`, `.glass rounded-full h-[38px] w-[17rem]
       md:w-[22rem] animate-pulse motion-reduce:animate-none`;
     - **otherwise:** `<a href="#pricing">`, `.glass inline-flex items-center gap-2
       whitespace-nowrap rounded-full px-4 py-2 text-sm text-slate-800`, with Rocket `h-4 w-4
       text-teal-700`, then a `hidden md:inline` span (full form) and an `md:hidden` span (short
       form). The count part is `tabular font-semibold text-teal-800`.
   - `:154` becomes "No credit card required.". Add a tombstone above `:148`: the line used to name
     the 14 days. The pill now carries the part that varies with the count (s47b). This line says
     only what is true under both grants.
   - `:115-128`: amend the sentence about the trial so it stays true. The first `{limit}` accounts
     get 90 days instead of 14 (s47a); either way it is a free trial, so "Start your free trial"
     still holds. The CTA itself does not change.
   - `page.tsx`: `const offer = toFoundingOfferView(useFoundingOffer());` at the top of `Home`, and
     `<Hero offer={offer} />`.

3. [x] **Pricing: the offer card, the trust lead, and the pack size.**

   Tests:
   - **New `src/components/sections/__tests__/Pricing.founding-offer.test.tsx`.** Mock `fetch` by
     URL, in the shape of `Pricing.agency.test.tsx:63-82`. Mock `@/lib/supabase/service` and
     `@/lib/billing/effective-plan` as `trial.test.ts:34-42` does, for the terms guard.
     - "shows the offer card between the subtitle and the billing toggle while spots remain":
       heading `First 20 users get ReCopyFast Pro free for 3 months`, "Founding offer", "$0",
       "for 3 months", "17 of 20 spots left", link "Claim your spot" → `/signup`, and all six
       benefits. `compareDocumentPosition` shows the order subtitle → card → "Monthly" button.
     - "last spot: 'Last spot left — 1 of 20', and nothing else changes".
     - `it.each([LOADING, CLOSED])` "renders no card, no placeholder and no number (%s)": no
       "Founding offer", no "Claim your spot", no `/of 20/`.
     - "names the pack from the pricing payload": `credits {price:19, creditsPerPack:1000}` gives
       "Need more AI before then? 1,000 credits for $19.". `{price:9, creditsPerPack:500}` gives
       "500 credits for $9." and no "1,000".
     - `it.each(["the pricing request failed", "there is no credits product", "the credits product
       has no creditsPerPack"])` "drops only the pack sentence when %s": "After 90 days, choose a
       plan to keep editing. Your site keeps serving its content either way." and the second
       paragraph are present; "Need more AI" is absent.
     - "promises the grant's own terms". This is the drift guard:
       - "100 AI credits a month" equals `FOUNDING_OFFER_TERMS.founding_20.monthlyCredits`;
       - "90 days" matches `NOW() + INTERVAL '90 days'` in
         `supabase/migrations/20260928120000_founding_offer.sql`;
       - "14-day" equals `TRIAL_DURATION_DAYS`.
   - **`trial-claims.test.tsx` `describe("Pricing")`**, rewritten on the post-s50 three-item row:
     `it.each(all)` "leads the trust row with %s": the first item follows the Copy table, and "No
     credit card required" and "Cancel anytime" are always present.
   - **New `src/__tests__/api/pricing-credit-pack.test.ts`,** mocks as in
     `pricing-agency.test.ts:1-80`, with a `credits` product in the catalogue:
     - "carries the pack size on the credits product, and only there": `creditsPerPack: 1000` is
       taken from `catalogue.creditPack`, and `lifetime_agency` has no such key;
     - "prices the pack at the Stripe amount when Stripe answers".

   **Red, then green:**
   - New `src/components/sections/FoundingOfferCard.tsx`. It takes
     `{remaining, limit, creditPack: {credits, price} | null}` and has no directive. Its markup
     follows design §1b and the Founding Agency structure (`Pricing.tsx:334-390`), with a flat
     `bg-white`, no gradient and no shadow.
   - In `Pricing.tsx`:
     - Add `creditsPerPack?: number` to `PricingOneTimeProduct` (`:34-41`).
     - TRUST_POINTS becomes `["No credit card required", "Cancel anytime"]`. Rewrite the tombstone
       at `:63-68`: the first item is now `foundingOfferTrustLead(offer)`, and both remaining claims
       hold under the 14-day trial and under the offer (neither takes a card). **s50's comment
       below `];` stays byte-identical.**
     - The signature takes `{ offer }`.
     - Insert `{offer.status === "open" && <FoundingOfferCard … />}` between the subtitle `<p>`
       (`:138-140`) and the toggle (`:142`).
     - The trust render (`:405`) maps `[foundingOfferTrustLead(offer), ...TRUST_POINTS]`.
   - In `src/app/api/pricing/route.ts`: add `creditsPerPack?: number` to `OneTimeProductPayload`
     (`:47-55`). In the mapping (`:220-228`), spread
     `...(product.id === "credits" ? { creditsPerPack: catalogue.creditPack.creditsPerPack } : {})`.
     Add a one-line comment saying why: the landing's fine print names the pack from this payload
     (s47b).
   - `page.tsx`: `<Pricing offer={offer} />`.
   - `Pricing.agency.test.tsx` (6 renders) and s50's `homepage-truth.test.tsx` (its `Pricing`
     render) get `offer={{ status: "closed" }}`. That is the prop only; no assertion changes.

4. [x] **FinalCTA, and the proof that there is one request.**

   Tests:
   - **`trial-claims.test.tsx` `describe("FinalCTA")`:**
     - `it.each(all)` "leads the trust row with %s": exactly three items, the first per the Copy
       table, then "No credit card required" and "Cancel anytime".
     - "marks the row in the landing's teal, not emerald": three `.bg-teal-600` dots and zero
       `.bg-emerald-500`.
   - **New `src/__tests__/app/landing-founding-offer.test.tsx`.** Render `Home` from
     `src/app/page.tsx`, with these mocked to null components: `@/lib/hooks/useLenis`,
     `next/dynamic`, `@/components/layout/Header` (named `Header`), `Footer`, `HeroDemo`,
     `ValueProposition`, `HowItWorks` and `Benefits`. `Hero`, `Pricing` and `FinalCTA` stay real.
     `fetch` routes by URL: `/api/pricing` → `{plans:[], oneTimeProducts:[]}`.
     - "asks for the count once, and the three places agree": 17/20. `/api/offers/founding` is
       called exactly once. The Hero link and the card both read "17 of 20 spots left".
       `getAllByText("3 months free for the first 20")` has length 2.
     - "shows neither promise while the count loads": the offer fetch never resolves.
       `getAllByText("Free trial")` has length 2. Nothing in the document matches
       `/14 days of Pro|14-day free trial|3 months|spots left/`. "Claim your spot" is absent.
     - `it.each(["503", "429", "a network error", "an out-of-bounds body", "sold out"])` "falls back
       to the 14-day trial everywhere (%s)": the Hero reads "Every new account gets 14 days of Pro,
       free"; "14-day free trial" appears twice; there is no "Claim your spot"; nothing matches
       `/\d+ of \d+/`.

   **Red, then green,** in `FinalCTA.tsx`:
   - The signature takes `{ offer }`.
   - `:106` becomes `{foundingOfferTrustLead(offer)}`.
   - At `:105`, `:109` and `:113`, `bg-emerald-500` becomes `bg-teal-600`.
   - Rewrite the tombstone at `:96-103`. It records three things:
     - the first item follows the count (s47b);
     - the other two hold under both grants;
     - the dots were `emerald-500`, a hue the design system forbids on the marketing surface. They
       are now `teal-600`, matching the Pricing trust-row checks. They are not `bg-primary`: app
       tokens are `light-dark()` and would follow OS dark mode on a page pinned light (design gap
       2).
   - `page.tsx`: `<FinalCTA offer={offer} />`. s50's `homepage-truth.test.tsx` FinalCTA render gets
     `offer={{ status: "closed" }}`.

5. [x] **Playwright: both states in E2E-017, and E2E-016 made honest.** Edit `e2e/landing.spec.ts`
   only. There is no new test: the total stays **44**.

   **E2E-017**, retitled "E2E-017: Trust indicators follow the founding offer count", runs three
   phases on one page:
   - **Loading (held route).**
     - `page.route("**/api/offers/founding", …)` awaits a `held` promise before fulfilling
       `{json:{limit:20, remaining:17, soldOut:false}}`. Wrap every `route.fulfill` in
       `.catch(() => {})`: locally, `next dev` runs React Strict Mode, whose first request is
       aborted by the hook. CI serves the production build, which does not do this.
     - `goto("/")`. `main.getByText("Free trial", {exact:true})` has count 2.
     - The `#hero` text matches none of `/14 days of Pro|spots left|3 months/`.
     - "Claim your spot" has count 0.
     - Wait 1 s for the entrance motion, then record the `#hero h1` box.
   - **Open.**
     - `release()`. `#hero` has a visible link named `/17 of 20 spots left/`.
     - The `h1` box `y` is unchanged, within 1 px: the slot holds its height.
     - "3 months free for the first 20" has count 2 in `main`.
     - Scroll `#pricing` into view with a plain `scrollIntoView` (see the note on E2E-012). "Claim
       your spot" is visible, with `href` `/signup`.
     - `#pricing` text contains "17 of 20 spots left", "No credit card required" and "Cancel
       anytime", and does not contain "14-day free trial".
   - **Failed.**
     - `unroute`, then route to `{status:503, json:{error:"Founding offer availability is
       unavailable"}}`, then `reload`.
     - `#hero` has a visible link named "Every new account gets 14 days of Pro, free".
     - "14-day free trial" has count 2 in `main`.
     - "Claim your spot" has count 0.
     - `main` text contains neither "of 20 spots left", "of 20 left" nor "3 months free".
     - Negatives use "of 20", never bare "spots left": the Founding Agency card says "N of 50
       founding spots left".

   **E2E-016:** `:177` becomes
   `pricing.locator('a[href="/signup"]').filter({ hasNotText: "Claim your spot" }).first()`,
   with a one-line comment giving the reason (decision 4).

   **Checks:**
   - `npx playwright test --list` still shows 44.
   - Run `npx playwright test e2e/landing.spec.ts e2e/hero-demo-mobile.spec.ts` locally. The pill
     adds 62 px above the headline, and the mobile demo spec is where that would show.
   - Use a dev server started from this worktree, with env from `npx supabase status -o env` in the
     shape of `ci.yml:176-178,246` (s50 T10's method). Both specs only read the database.
   - First check port 3000: `lsof -nP -iTCP:3000 -sTCP:LISTEN` and the owning process's cwd.
     `reuseExistingServer: true` would otherwise test another checkout.
   - If the stack is unavailable, say so. The spec then runs in PR CI.

6. [x] **Gates, mutations, evidence, one commit.** Everything runs in the worktree, with the
   Precondition 4 environment. `npm run build` also uses the CI placeholder env (`ci.yml:35-66`).

   Gates:
   - `npm run precommit`. Record the count of gated DB suites.
   - `npm run format:check`, plus `npx prettier --check e2e/landing.spec.ts` (`format:check` covers
     `src/` only).
   - `npm run type-check:build`, `npm run build`, and `npx playwright test --list` (44).

   Mutations: apply each alone, restore it, and verify the restore with sha256.
   - M1: the hook starts with `loading:false` → hook "is loading…" and page "shows neither
     promise…" fail.
   - M2: `parseFoundingOfferAvailability` drops `remaining <= limit` → the 21-of-20 rows fail.
   - M3: `toFoundingOfferView` maps an error to `loading` → "a failure and a sell-out are the same
     view" and the page's 503 case fail.
   - M4: `foundingOfferHeadline` hardcodes "First 20 users" → the limit-30 tests fail.
   - M5: `Pricing` also calls `useFoundingOffer()` → page "asks for the count once…" fails.
   - M6: `Pricing` renders the card whenever `offer.status !== "closed"` → the card's LOADING case
     and the page's loading test fail.
   - M7: one FinalCTA dot goes back to `bg-emerald-500` → the dots test fails.

   Evidence:
   - With the dev server up, save `curl -s http://127.0.0.1:3000/`. The server-rendered `#hero`
     contains the `aria-hidden` pill and neither "14 days of Pro, free" nor "spots left". This is
     the no-flash proof at first paint.
   - Optional: screenshots at 1440 and 390 of the three E2E-017 phases, saved **outside** the
     worktree and listed, not committed.

   Then:
   - Tick s47b in `docs/stories.md`.
   - Append `## Execution log` to this plan: the gates and their results, red-before-green per
     task, M1–M7, the curl evidence, and the local Playwright result or the declared deviation.
   - Commit once, with the hook's Jest run on the same `RCF_TEST_SUPABASE_CONFIG`:
     `feat: the landing page shows the founding offer and the spots left`. The body names the
     test changes the PR must declare: trial-claims and E2E-017 rewritten, E2E-016's locator, and
     the prop-only edits to `Pricing.agency` and `homepage-truth`.

## Run interdicts

- `public/embed/**`: empty diff (0-byte allocation). `supabase/`: empty diff (no migration).
- s47a's contract is unchanged:
  - `src/app/api/offers/founding/route.ts` and `src/lib/billing/founding-offer.ts` have empty
    diffs;
  - no cache, no field and no second route for the count.
- `/api/pricing`: the diff is the optional `creditsPerPack` on the type and the `credits` entry,
  plus its comment. The cache, headers, CORS and Founding Agency availability are byte-identical.
- **One request.** `grep -rn "offers/founding" src --include='*.ts' --include='*.tsx'`, excluding
  `__tests__`, lists only the route and `useFoundingOffer.ts`. No second Context or provider. No
  `localStorage`, `sessionStorage` or module-level memo of the count. No polling, and no timer that
  shows either promise before the response arrives.
- **No server code in the client bundle.** In the hook, the copy module, `FoundingOfferCard`, the
  three sections and `page.tsx`, the only import from `@/lib/billing/*` is `import type`. None of
  them imports `@/lib/supabase/service` or `@/lib/billing/trial`.
- These are byte-identical:
  - the Founding Agency card (`Pricing.tsx:327-393`; design gap 5 is observed, not fixed);
  - s50's comment under `TRUST_POINTS`;
  - FinalCTA's pill, amber `Zap` and amber heading span (design gap 6);
  - the Hero headline, subtitle and both CTAs;
  - `src/app/try/page.tsx`.
- No app tokens (`bg-primary` or the like) on the landing. No `emerald` left in `FinalCTA.tsx`.
- In `e2e/landing.spec.ts`, E2E-010 to E2E-015 and E2E-018 are byte-identical, and E2E-016 changes
  in one line. `playwright.config.ts`, `ci.yml`, `playwright-ci-contract.test.ts` and
  `e2e/support/**` have empty diffs.
- In `Pricing.agency.test.tsx` and `homepage-truth.test.tsx`, only `offer=` props are added. No
  assertion changes.
- No copy beyond the Copy table. No ADR (no structural choice here beyond an additive payload
  field). AGENTS.md, `docs/architecture.md` and `docs/design-system.md` are untouched.
- Gates never run at the repo root, and `.env*` is never copied.
  - `RCF_TEST_SUPABASE_CONFIG` is set for every Jest run. `RCF_TEST_DB_URL` and
    `RCF_REQUIRE_TEST_DB` are never set.
  - No `supabase db reset` or `db push`. No migration applied to the shared stack.
  - Locally, Playwright runs only `landing.spec.ts` and `hero-demo-mobile.spec.ts`, and never
    against production.
- No push, PR, merge or production action. Never `--no-verify`.

## The point everything turns on

**The count is fetched once, in `page.tsx`, and reduced to a three-valued view.** In that view,
"loading" promises nothing, and "unknown" cannot be told apart from "sold out". Every AC rests on
this reduction. Three places where it could be wrong:

- **First paint.** `page.tsx` is a client component, but it is still server-rendered. If the hook's
  first render is anything but `loading`, the served HTML promises one thing and hydration swaps it
  for another. That is the flash the story forbids, plus a hydration mismatch. Examples: an initial
  state read from a cache, or a `typeof window` branch.
  - Compare the curl evidence in T6 (the served `#hero` holds the `aria-hidden` pill and no promise)
    with E2E-017's held-route phase in a real browser.
- **Client doubt vs server doubt.** s47a's `getFoundingOfferAvailability` already refuses
  out-of-bounds rows before the route answers. The client has to be at least as strict. Anything
  between the two could otherwise put a number on screen: a 200 error page from a proxy, a truncated
  body, a CDN oddity.
  - Compare `parseFoundingOfferAvailability`, clause by clause, with the checks in
    `founding-offer.ts` on s47a's branch (`limit` ≥ 1, `remaining` from 0 to `limit`, `soldOut ===
    (remaining === 0)`).
- **The real count in CI.** CI's E2E job applies every migration, so every unmocked landing test
  sees "20 of 20" and the offer card. Any locator that assumed the pricing section opens with the
  plan grid now reads the card instead, and still passes.
  - Compare every `pricingSection(page)` locator in `landing.spec.ts` against a page with the card
    present. E2E-016 is the known case; E2E-012's exact-name `h3` filters are safe.

## Files touched

- New:
  - `src/hooks/useFoundingOffer.ts`
  - `src/components/sections/founding-offer-copy.ts`
  - `src/components/sections/FoundingOfferCard.tsx`
- Edited:
  - `src/app/page.tsx`
  - `src/components/sections/{Hero,Pricing,FinalCTA}.tsx`
  - `src/app/api/pricing/route.ts` (additive field)
- Tests, new:
  - `src/hooks/__tests__/useFoundingOffer.test.tsx`
  - `src/components/sections/__tests__/Pricing.founding-offer.test.tsx`
  - `src/__tests__/app/landing-founding-offer.test.tsx`
  - `src/__tests__/api/pricing-credit-pack.test.ts`
- Tests, edited:
  - `trial-claims.test.tsx` (three describes rewritten)
  - `e2e/landing.spec.ts` (E2E-017 rewritten, E2E-016 one line)
  - `Pricing.agency.test.tsx` and s50's `homepage-truth.test.tsx` (prop only)
- Docs:
  - this plan
  - `docs/designs/s47b-founding-20-landing.{md,html}`
  - `docs/designs/s47-founding-20-offer-brief.md`
  - `docs/stories.md` (tick)

## Test strategy

Four levels. Each asserts both states, and loading on its own:

1. **Parse and view** (pure). The parse is a table of valid and invalid bodies. The view mapping
   proves that failure ≡ sold out.
2. **Hook.** First render is loading. One uncached request. Every failure mode becomes an error,
   never a number. Unmount is safe.
3. **Sections and page** (jsdom).
   - Each section renders all four states from the Copy table.
   - The page renders the three real sections on one mocked fetch. They agree, loading promises
     nothing, and five failure modes all land on the 14-day trial.
   - The terms guard ties "100", "90 days" and "14-day" to s47a's constant, the migration and
     `TRIAL_DURATION_DAYS`.
4. **Browser.** E2E-017 holds the real route to see loading, then serves the open state, then a
   503. It checks that the headline does not move when the count arrives.

Mutations M1–M7 show the guards are not vacuous. E2E-018 (s50) scans the offer-state page in CI
for retired claims.

## Definition of Done

- All six tasks ticked, with red observed before each green.
- In the worktree: `lint`, `type-check`, `format:check` (including the e2e file), full Jest (DB
  suites gated by the unreachable config), `type-check:build` and `build` are green. `--list`
  shows 44. `landing.spec.ts` and `hero-demo-mobile.spec.ts` pass locally, or the deviation is
  declared and left to PR CI.
- One commit on `feature/s47b-founding-20-landing`, with the Execution log in this plan.
- **Deploy order is safe either way.** Without s47a's migration in production, the route answers
  503 and the landing shows the 14-day trial. After merge the operator deploys, then checks
  `https://www.recopyfa.st/api/offers/founding` and the Hero pill agree. `/api/pricing` carries
  `creditsPerPack` within its 5-minute cache plus CDN window. Until then, the pack sentence is
  simply dropped.
- **Risks:**
  - The Hero slot adds 62 px above the headline. It is checked on mobile by
    `hero-demo-mobile.spec.ts`, but not on every viewport.
  - Dev Strict Mode sends two requests locally. That is why the one-request proof is in Jest and
    not in Playwright.
  - The card's "5 websites" is copy, not derived from Pro's limits. It is not guarded against
    drift.
  - The E2E-017 vs E2E-018 choice (decision 3) needs the lead's confirmation.

## Execution log

Run 2026-09-28 in `.omx/worktrees/s47b-founding-20-landing`, branched from `main` at `50f0a3c`
(s47a and s50 merged). `main` later moved to `bae700c` (s51). s51 touches none of this story's
files. Every Jest run and the hook used the CI placeholder env plus
`RCF_TEST_SUPABASE_CONFIG=<dead config>` (`[api] 59998`, `[db] 59999`). `RCF_TEST_DB_URL` and
`RCF_REQUIRE_TEST_DB` were unset.

**Preconditions.**
- The route exists. `homepage-truth.test.tsx` exists. FinalCTA shows "Set up in minutes" ×1.
- `grep -c money-back` on `Pricing.tsx` returns **1, not 0**. The match is s50's own tombstone
  comment under `TRUST_POINTS`; the claim itself is gone. The content check holds, so the run
  proceeded.
- `founding-offer-cap.test.ts` reports `[gated]` and never reaches 54322.

**Red before green, per task.**
- T1: the suite failed to run (module not found). Green: 33/33.
- T2: 9 failed and 6 passed. The six are the four "invites" CTA guards, which are unchanged by
  design, plus the old FinalCTA and Pricing describes. Green: 58 across trial-claims and the hook.
- T3: 12 failed and 17 passed. The passes are the closed and loading states, which today's code
  already satisfies. Green: 94. `pricing-credit-pack.test.ts` needed `export {}`: as a script it
  redeclared `pricing-agency.test.ts`'s mock names (TS2451).
- T4: 6 failed and 23 passed. The five fallback cases passed before the change, because FinalCTA
  hardcoded the trial line. Green: 157.
- T5: spec only. `--list` shows 44. `prettier --check e2e/landing.spec.ts` is clean.

**Gates.**

| Gate | Result |
|---|---|
| `npm run precommit` | Exit 0. Lint: 0 errors; the 38 warnings are pre-existing and none is in a story file. Type-check: 0 errors. Jest: 295 suites passed, 2 skipped; 3,759 tests passed, 38 skipped. |
| DB suites | 13 in total: 12 gated, 1 skipped, none connected to 54322. |
| Formatting | `format:check` and `prettier --check e2e/landing.spec.ts` are green. |
| Build | `type-check:build` green. `npm run build` exit 0 with the CI placeholder env. |
| Playwright | `npx playwright test --list`: 44. |

**Mutations.** Each was applied alone and restored, and every restore was verified by sha256.

| Mutation | Tests that failed |
|---|---|
| M1 | hook "is loading, with no data, on its first render"; page "shows neither promise while the count loads" |
| M2 | parse "refuses remaining above the limit"; hook "reports an out-of-bounds 200…"; page "(an out-of-bounds body)" |
| M3 | "is closed when the count could not be read"; "a failure and a sell-out are the same view"; page 503, 429, network error and out-of-bounds |
| M4 | Hero "the 20 is the count's limit, never a literal" |
| M5 | page "asks for the count once, and the three places agree" |
| M6 | card "renders no card, no placeholder and no number (loading)"; page "shows neither promise…" |
| M7 | FinalCTA "marks the row in the landing's teal, not emerald" |

**No-flash evidence.** `curl -s http://127.0.0.1:3000/` against `next start` on this worktree's
production build, with the lead's instruction and the CI placeholder env.
- The served `#hero` contains `<div class="mb-6 flex h-[38px] justify-center" …><div
  aria-hidden="true" class="glass h-[38px] w-[17rem] animate-pulse …"></div></div>`, then "No
  credit card required.".
- It contains no "14 days of Pro, free", no "spots left" and no "3 months".
- The served `main` has "Free trial" ×2 and no "14-day free trial".

**Local Playwright.** It ran without the Supabase stack, against the same local production build.
The count route is intercepted, and the rest needs no database.
- E2E-017 passes. It took 52.6 s on its own, with tracing on. In one run of E2E-010, E2E-011,
  E2E-017 and the mobile spec on one worker, all passed except the swipe test.
  - Its first run, three workers in parallel, hit the 90 s budget at the `h1` measurement.
  - The trace shows every action costing 1–5 s: the landing's continuous WebGL animation
    saturates the page's main thread in headless Chromium. CI runs one worker.
- E2E-012 to E2E-016 and E2E-018 were **not run locally**. They need `/api/pricing` data, which
  needs the database. They are left to PR CI.
- `hero-demo-mobile.spec.ts`:
  - "the demo has its own scrolling viewport" passes.
  - "two swipes never scroll the demo backwards" is **flaky with the pill**: 4 failures in 10 runs,
    each "Received: 0" at spec line 137.
  - The same build with only the pill slot removed passed 5/5.
  - On the iPhone 13 profile, the hero grows from 727 to 789 px and the demo's sticky track moves
    from 514 to 576 px. That is the slot's 62 px. `APPROACH_PX = 400` already stops short of the
    track, and the swipes sometimes no longer carry the page into it.
  - The strict contract fails CI on any flaky test (`strict-run-contract.ts:52`). Reported to the
    lead as a blocker; the plan specifies no fix.
  - **Lead's decision, option (a): a deliberate test change, outside the plan. The PR must declare
    it.** `openPinnedDemo` no longer wheels a fixed `APPROACH_PX = 400`: that offset encoded the
    old hero height. It now scrolls to the measured top of the demo's sticky track. The design is
    unchanged, the assertions ("two swipes never scroll the demo backwards", including its
    non-vacuity check) are unchanged, and the total stays 44.
  - Three facts shaped the change, each found by probing the local build:
    - Wheel deltas are device pixels. On the 3x profile, a 576 wheel moved the page 192 CSS px, so
      the old 400 only ever moved it about 133 px. The wheel is scaled by `devicePixelRatio`.
    - The track's offset drifts while the page scrolls (576 grows to about 645). One measured wheel
      lands short, so the approach loops: re-measure, wheel, at most 6 rounds. Two suffice.
    - The scroller node is keyed by site, and the attract loop replaces it every 6 s until the demo
      scroll engages (`SCROLL_ENGAGED_AT`, 0.01 of the track). The first version measured through
      the scroller and stopped exactly at the pin. It failed 20 of 20: every run hit "no sticky
      track" or a scroller with no layout box, mid-swap. The final version measures the track from
      the stable "Interactive demo" section, stops 24 px past the pin (just over the engagement
      threshold, which is what a visitor scrolling in does), then waits for a single scroller.
  - **Proof.** `hero-demo-mobile.spec.ts --repeat-each=10 --workers=1 --retries=0`, iPhone 13
    profile, against the pill build: **20/20 passed**, with 10 consecutive runs of each test and 0
    failures. The host's load average was above 900 throughout. `--list` shows 44.

**Deviations from the plan, declared.**
1. **The `money-back` precondition returns 1, not 0.** The match is s50's own tombstone comment;
   the claim itself is gone. The run proceeded (see Preconditions).
2. **The page test "shows neither promise while the count loads" also asserts the
   `renderToString` first paint.** RTL's `render` flushes effects inside `act()`, so without that
   assertion M1 (`loading: false` initially) passes the page test.
3. **`pricing-credit-pack.test.ts` carries `export {}`.** As a script, it redeclared
   `pricing-agency.test.ts`'s mock names (TS2451). Its second test uses a 500-credit pack, so the
   pair proves the value comes from `catalogue.creditPack`, not from a literal.
4. **Design details the plan leaves open, taken from the mockup:**
   - "Claim your spot" is `text-center`.
   - The tag carries `mb-3`.
   - The fine print's two paragraphs sit in `space-y-2`.
   - The pill is a local `FoundingOfferPill` plus a `pillLines` helper inside `Hero.tsx`.
5. **E2E-016 is one statement, but Prettier wraps it to 4 lines, under a one-line comment.**
6. **`FinalCTA.tsx` still contains the word "emerald".** It sits in the tombstone T4 requires ("the
   dots were emerald-500"). No emerald class remains.
7. **Curl evidence and local Playwright ran against `next start` on this worktree's production
   build, with the CI placeholder env and no Supabase stack.** This follows the lead's
   instruction; the plan named a dev server with `supabase status` env. E2E-012 to E2E-016 and
   E2E-018 were not run locally.
8. **`hero-demo-mobile.spec.ts` changed (lead's decision, option a; see above).** This test
   change is outside the plan's file list, and the PR must declare it.

## Fix run (review `docs/reviews/s47b-founding-20-landing.md`)

Test and docs only. No production file changed.

**Major 1: the phone line of the Hero pill was never pinned.** It is now pinned.
- The old assertion, `toContain("14 days of Pro, free")`, could not fail: the desktop line
  contains that string too.
- `trial-claims.test.tsx` gains `pillForms`. It reads the `md:inline` and `md:hidden` spans
  separately; the markup is unchanged.
- The sold-out and last-spot tests now assert each line's exact text. Sold out also asserts that
  no "3 months" appears in the hero.
- Proof, each change applied alone to `Hero.tsx`, then restored and checked by sha256:

  | Mutation | Result |
  |---|---|
  | Sold-out phone line becomes "Pro free for 3 months" (the review's M-C) | Red: "sold out or unknown: the 14-day trial, and no number" |
  | Last-spot phone line becomes "Pro free for 3 months" | Red: "last spot: 'Last spot left' in both forms, and no '1 of 20'" |

  Before this fix, M-C turned no test red.

**Minor: the unmount test only ever sent a 503.** It now runs twice, once with a late 503 and once
with a valid late 200. Its comment now claims only what the test observes: neither answer throws,
logs or re-renders.
- React ignores a state set on an unmounted tree, so no unmount test can catch the loss of the
  success-path `isCurrent()` guard (the review's M-D). That guard protects the refetch race.

**Minor: the design docs linked the uncommitted PNG folder.** The design and the brief now say
"local reference screenshots (not committed)" instead of pointing at the folder.
