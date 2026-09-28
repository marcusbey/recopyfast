---
validated: yes
---
# Plan — Story s50-homepage-truth

Branch: `feature/s50-homepage-truth`, from `main` (`f4cef65` or later).
Worktree: `.omx/worktrees/s50-homepage-truth`. Every gate runs there, never at the repo root:
the root's untracked `.env` points at production and breaks the `NEXT_PUBLIC_APP_URL` tests.
Research: `docs/research/s50-homepage-truth.md` — read it first; this plan does not repeat it.
Claim IDs below (P4, B2, C12, T5…) are the research inventory's.

## Target story

Every claim on the homepage, and the contact addresses on `/terms` and `/privacy`, is true on
production today, or it goes. Two kinds of copy change:

- **Code.** The landing sections, the demo image modal, the footer, the legal pages' addresses and
  the site metadata.
- **Data.** Plan descriptions and bullets live in `plans` and render on the pricing cards and the
  billing screens, so one forward migration fixes them. The operator syncs the Stripe product
  descriptions after deploy.

No price, limit, grant or layout changes. No design phase: s50 edits copy inside existing layouts.
Every layout-adjacent effect is listed in Resolved question 12.

Acceptance criteria → tasks (every AC has a named test):

| AC (docs/stories.md s50) | Tasks | Named tests |
|---|---|---|
| 1 Money-back guarantee removed everywhere | T1, T3 | `retired-promises` "no public page says money-back"; `homepage-truth` "Pricing › makes no money-back promise"; E2E-018 |
| 2 Graveyard features not advertised | T4 | `homepage-truth` "Benefits › lists only shipped capabilities"; E2E-018 |
| 3 Every FALSE/UNVERIFIABLE claim reworded or removed; evidence per claim for the review | T2, T4–T7, T9, T10 | the per-surface tests below; the claim table in the Execution log (T10) |
| 4 "Email support" on every plan; no "Priority support", no "onboarding call" | T1, T2 | `catalogue-copy-truth` "says Email support on every subscription plan"; `retired-promises` (source and catalogue) |
| 5 Lifetime Pro: no "all future Pro features" | T1, T2 | `catalogue-copy-truth` "drops the future-features promise from Lifetime Pro"; `retired-promises` |
| 6 Contact addresses on `recopyfa.st` only | T1, T7, T8 | `retired-promises` "no public page says recopyfast.com"; `homepage-truth` "Footer › sends email to support@recopyfa.st"; `legal-contacts` |
| 7 Plans copy: one idempotent forward migration, no price/limit change | T1, T2 | `catalogue-copy-truth` (all); `retired-promises` "plans catalogue, as the last migration leaves it" |
| 8 Copy tests and Playwright landing pass; gates; one commit; no production action | T1, T3, T10 | `trial-claims`, E2E-017, E2E-018, gates |

## Resolved open questions

Owner decisions are marked **(owner)**; the rest are planner defaults, stated so the owner sees
them at the checkpoint.

1. **Catalogue copy is in s50 (owner).** One migration, `20260928130000_catalogue_copy_truth.sql`.
   It sorts after s48's `20260928110000` and s47a's `20260928120000`. Neither of those touches a
   `plans` row, so this file is the last writer of plans copy.
2. **Support (owner).** Starter, Pro and Agency each list "Email support". Agency's description
   says "email support". The lifetime rows inherit it through "Everything in Pro/Agency".
3. **Addresses (owner: two mailboxes; the mapping is a default).**
   - The footer's email link goes to `support@recopyfa.st`.
   - On `/terms` and `/privacy`, "General Support" goes to `support@recopyfa.st`. Every other
     address goes to `privacy@recopyfa.st`: privacy, security, legal, DPO and EU representative.
   - The `/terms` bullet "Real-time status monitoring is available at status.recopyfast.com" is
     deleted. No status page exists, and the bullet names the dead domain.
   - The "Last Updated" dates on both pages are left as they are. The owner can bump them.
   - No other legal text changes (see 13).
4. **Headline cards → Invite and AI Rewrite.** Research Q4 copy, with one correction. "Untick
   Publish" becomes "Publish stays off unless you grant it", because the invite form defaults to
   View and Edit (`InviteEditorForm.tsx:46`).
   - The supporting grid keeps six items, so it stays two full rows of three. B5 and B7 move up
     into the cards.
   - Two capabilities the research verified fill their slots: image replacement (D1/D3) and
     draft-then-publish (D2, W6, and the content route serving `published_content`,
     `src/app/api/content/[siteId]/route.ts:416-436`).
5. **The five-minute claims are dropped.** HowItWorks gets "Three steps. / A few minutes." Its
   badge and FinalCTA's badge both get "Set up in minutes".
6. **SEO (proposed):**
   - Title: **"ReCopyFast - Edit your website copy in place"**.
   - Description: **"Make the copy on the site you already built editable, with one script
     tag."**
   - Both are also used in the manifest and in the social card's text and alt. The "headless CMS"
     keyword is dropped.
7. **Lifetime Pro (owner).** "Includes all future Pro features" is removed. The description
   keeps "every Pro feature forever", which means the features Pro has today.
8. **"Role-based permissions" (B6)** is not advertised. The shipped per-editor View, Edit,
   Publish and Admin levels are described in the Invite card instead (research Q8).
9. **Design-system fixes are out.** The FinalCTA emerald dots go to s47b. The Founding Agency
   gradient (`Pricing.tsx:332`) stays.
10. **C1: "Draft, then publish", not the research's "Draft, preview, then publish".** The
    widget's Preview Live only reopens the current URL in a new tab
    (`recopyfast.src.js:2257-2259`). Nobody checked that the new tab shows the draft, so the
    plan does not claim a preview.
11. **C10 "Works on any plan" stays, as the research recommends.** Credits spend on any plan.
    Buying them from the lapsed and no-plan screens arrives with s49 (see Risks in DoD).
12. **Layout-adjacent effects.** Each one is a removal inside an existing layout; none adds a
    screen or a component, so no `/ks-design` pass is needed.
    - The footer's bottom bar loses its right-hand status and version block, leaving the
      copyright block alone.
    - The demo image modal loses its prompt and its primary button. "Use the next photo" keeps
      its current secondary style.
    - `/terms` loses one bullet.
    - The Benefits grids keep their item counts.
13. **Follow-ups, not s50:**
    - The `/terms` and `/privacy` body claims: audit logs, RBAC, SIEM, notifications and the EU
      representative. They need owner and legal review.
    - The blog's "any site" and "any website" (`blog/page.tsx:71`, `blog/[slug]/page.tsx:112`).
    - In-app billing copy that still mentions translations and A/B: `BillingDashboard.tsx:172`,
      `PurchaseCreditsDialog.tsx:60,107`, `TrialStatusCard.tsx:150`.
    - `src/lib/config/production.ts:177-179,261-262` lists `recopyfast.com` CORS origins. It is
      dead config today: no source imports the `withCors` in `src/lib/middleware/monitoring.ts`.
    - The root-level `e2e-billing-tests.spec.ts:131` and `e2e-run-tests.mjs:120` still look for
      the guarantee. Neither is in Playwright's `testDir`.
    - Register or park `recopyfast.com`.

## Tasks (ordered)

Tests before code in every task. The implementer never writes copy of their own: every
user-visible string that changes is quoted below.

1. [x] **Guard: the five retired promises never come back.** Write the new file
   `src/__tests__/marketing/retired-promises.test.ts` and extend E2E-018.

   **Phrases.** `RETIRED = ["recopyfast.com", "money-back", "priority support",
   "onboarding call", "future pro features"]`, matched case-insensitively.

   **Scanner.** `copyStrings(text, fileName)` uses `import * as ts from "typescript"`, with
   `ts.createSourceFile` and a ScriptKind taken from the file extension.
   - It collects the text of `StringLiteral`, `NoSubstitutionTemplateLiteral`,
     `TemplateHead/Middle/Tail` and `JsxText` nodes. JSX attribute values are `StringLiteral`s.
   - It never reads comments. This is required: the tombstones this story writes name the
     retired claims, and so does `HowItWorks.tsx:11`.

   **Scan roots.** `src/app` (except `src/app/api`), `src/components` and `src/lib/compare`, in
   `.ts` and `.tsx` files. Skip `__tests__` directories and `*.test.*` / `*.spec.*` files.
   - This is a superset of the public pages. It is simpler to state and check than a per-route
     import graph.
   - `public/` is out: `public/demo-site` is a fictional customer's page and says "Priority
     support".

   `describe("copy-string scanner")`:
   - "reads string literals, template text, JSX text and attributes, never comments". Use an
     inline TSX sample with a phrase in each kind of node, and one in `//` and `/* */` comments.
   - "reaches the real public source". More than 100 files are scanned, and `Footer.tsx` yields
     "Privacy Policy".

   `describe("public page source")`, `it.each(RETIRED)("no public page says %s")`. Each test
   asserts `filesSaying(phrase)` equals `[]`.

   `describe("plans catalogue, as the last migration leaves it")`. Migration statements have
   `--` comments stripped, as in `plan-seed.test.ts:229`.
   - "the retired phrases survive only in the applied seeds". The files whose statements contain
     a phrase are exactly `20260802000000_plans_catalog.sql` and
     `20260924065000_agency_plan_and_founding_capacity.sql`. Their VALUES tuples, anchored on
     `\(\s*'<id>', '(subscription|one_time)'`, carry them in rows `pro`, `lifetime_pro` and
     `agency`.
   - "20260928130000 rewrites the features of every row that carries one". For `pro`,
     `lifetime_pro` and `agency`, the new migration has an `UPDATE public.plans … WHERE id =
     '<id>'` that sets `features` with no retired phrase. Its filename sorts after both seeds.

   **E2E-018** (`e2e/landing.spec.ts:206-233`). Do not add a new Playwright test: CI pins exactly
   44 (`playwright.config.ts`, `ci.yml`, `playwright-ci-contract.test.ts:33-47`).
   - After the existing `toBeAttached` on the pricing section, wait for
     `pricingSection(page).locator("h3").filter({ hasText: /^Starter$/ })` to be attached, so the
     catalogue cards have loaded and their bullets are really read.
   - Keep the `fabricated` loop. Add a second loop, commented "s50: claims retired because the
     product does not back them", asserting `pageText` does not contain each of:
     "money-back", "Priority support", "onboarding call", "future Pro features", "A/B",
     "Every string on the site, in another language", "Find out which words actually win",
     "Role-based permissions", "audit log", "Works everywhere", "Full version history",
     "unlimited translations", "Comprehensive docs", "All systems operational", "v1.0.0",
     "Five minutes", "five minutes", "5 minutes".
   - Then `expect((await page.content()).toLowerCase()).not.toContain("recopyfast.com")`, since
     an `href` never reaches `textContent`. Also assert `await page.title()` does not contain
     "Universal CMS".
   - Case-sensitive phrases are deliberate: `body` text includes inline RSC payloads, where
     Tailwind class names such as `translate-y` live.

   **Red.**
   - "no public page says recopyfast.com" fails on `Footer.tsx`, `terms/page.tsx` and
     `privacy/page.tsx`.
   - "…money-back" fails on `Pricing.tsx`.
   - The `20260928130000` test fails with ENOENT.
   - E2E-018 fails, if the local stack is up (see T10).

   **Declared guards, green from the start:** the scanner tests, the three catalogue-only
   phrases in source, and "survive only in the applied seeds".

2. [x] **The catalogue migration, test-first.** New
   `src/__tests__/lib/stripe/catalogue-copy-truth.test.ts`, shaped like
   `plan-seed.test.ts:218-297`: statements only, and one parsed `UPDATE` per id.
   - "updates starter, pro, agency, credits and lifetime_pro, and nothing else". Exactly five
     `UPDATE public.plans … WHERE id = '<id>';`, no `INSERT`, `DELETE`, `ALTER` or `FUNCTION`,
     and `'free'` and `'lifetime_agency'` are never named.
   - "sets each row's copy exactly". The values are in the table below.
   - "says Email support on every subscription plan". Starter, Pro and Agency features include
     "Email support". No value matches `/priority|onboarding|community support/i`.
   - "drops the future-features promise from Lifetime Pro".
   - "never touches price, limits, grant, listing, Stripe ids, name or kind". Reuse the regex at
     `plan-seed.test.ts:274-276`, plus `limits`.
   - "leaves the applied seeds as they were". `20260802000000` still seeds Pro with "Priority
     support".

   **Red:** ENOENT. **Green:** write
   `supabase/migrations/20260928130000_catalogue_copy_truth.sql`, one `UPDATE` per row, each also
   setting `updated_at = NOW()`:

   | id | `description` (set) | `features` (set, exact order) |
   |---|---|---|
   | `starter` | `1 website, click-to-edit, draft and publish` | `["1 website", "Draft, then publish", "Click-to-edit interface", "Version snapshots and restore", "Email support"]` |
   | `pro` | not written (C8 stays) | `["Up to 5 websites", "+$5 per additional website", "Draft, then publish", "Click-to-edit interface", "Version snapshots and restore", "Email support", "AI rewrite suggestions, 500 credits a month"]` |
   | `agency` | `10 client websites, unlimited invited editors, email support` | `["10 client websites", "+$4 per additional website", "Unlimited invited editors", "Everything in Pro", "1,000 AI credits / month", "Email support"]` |
   | `credits` | `1,000 AI credits for AI rewrite suggestions` | not written (C10, C11 stay) |
   | `lifetime_pro` | `Pay once, keep every Pro feature forever — 5 websites and AI features. No recurring billing.` (em dash U+2014) | `["Everything in Pro", "One payment, no renewal"]` |

   **Header**, in house style (precedent `20260926120000_lifetime_agency_monthly_credits.sql:1-42`):
   - The s50 operator decision of 2026-09-28, and which research IDs each row fixes (C1, C3–C6,
     C9, C12, C13).
   - `limits` still carries `ab_testing` and `translations` flags. They are left alone: s50
     forbids limit changes, and they are not copy.
   - KEEP THESE ROWS ACTIVE.
   - STRIPE: the operator runs `check:stripe:live`, then `sync:stripe:live`. Four product
     descriptions change: starter, agency, credits and lifetime_pro.
   - `/api/pricing` serves the new copy within 5 minutes (its in-memory cache).
   - Deploy order does not matter, since this changes copy only.
   - Idempotent: fixed values.

   **Then**, against the local dev database only (container `supabase_db_recopyfast`, or
   `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), inside one `BEGIN … ROLLBACK`:
   1. Apply the file twice.
   2. Read back the six rows.
   3. Record that price, limits, `grants_plan_id`, `is_active` and `sort_order` are unchanged,
      and that `lifetime_agency` is untouched.

   Never apply it to production.

3. [x] **Pricing: the guarantee goes (P4).** New
   `src/components/sections/__tests__/homepage-truth.test.tsx`. Mock `fetch` as in
   `trial-claims.test.tsx:18-24`.
   - `describe("Pricing")` "makes no money-back promise": no text matches `/money-back/i`, and
     "Cancel anytime" is present, so the list did render.
   - Do not assert "14-day free trial" here: s47b swaps that item.

   **Red, then green:**
   - In `Pricing.tsx`, delete line 73 (`"30-day money-back guarantee",`) and nothing else in
     `:63-74`.
   - Add a new comment directly below the array's `];`. It records that the item was removed in
     s50 on the owner's decision of 2026-09-28, because `/terms` has no refund clause and refunds
     are handled case by case. Do not restore it without a refund clause in `/terms`.
   - The comment goes below the array, not in `:63-68`, so s47b's edit of item 1 stays a
     separate hunk.
   - Delete `trial-claims.test.tsx:63-65` and `landing.spec.ts:203`. Deletions only; titles are
     unchanged.

4. [x] **Benefits (B1–B12).** Add to `homepage-truth.test.tsx`, `describe("Benefits")`:
   - "leads with inviting editors and AI rewrite, not translation or A/B tests". The four
     headline strings below are present. "Translate", "Test", "Every string on the site, in
     another language" and "Find out which words actually win" are absent.
   - "lists only shipped capabilities". The six supporting titles below are present. "Role-based
     permissions", "audit log", "Works everywhere", "Full version history", "Roll back at any
     point", "Your whole team", "Knowing which words to use" and "ReCopyFast does both" are
     absent.
   - "keeps the #features anchor".

   **Red, then green,** in `src/components/sections/Benefits.tsx`:
   - `h2` → "Changing the words should be the easy part".
   - Paragraph → "With ReCopyFast it is: the people who own the copy change it on the live page,
     and you decide who can publish."
   - `headline[0]`: icon `UserPlus`; eyebrow "Invite"; title "Hand a client the words, not the
     site"; description "Invite someone by email. They sign in with a one-time code, no account
     and no password, and change the words on the page, never the layout or the code. Publish
     stays off unless you grant it, so their edits wait as drafts for you."
   - `headline[1]`: icon `Wand2`; eyebrow "Rewrite"; title "AI rewrites, in place"; description
     "Select any text and ask for a clearer, shorter, more professional or more casual version.
     Keep it, edit it, or keep yours."
   - `supporting`, in this order. Item 1 keeps its existing comment.

     | Icon | Title | Description |
     |---|---|---|
     | `MousePointerClick` | "Click. Edit. Done." | unchanged |
     | `ImagePlus` | "Swap images too" | "Replace a photo by pasting a link or uploading a file, right on the page." |
     | `Upload` | "Draft, then publish" | "Edits stay a draft until someone with Publish access sets them live. Visitors only ever see published copy." |
     | `Globe2` | "One script tag" | "On the site you already built: React, Vue, WordPress, Webflow or plain HTML. Its Content Security Policy has to allow our script." |
     | `History` | "Save and restore" | "Save a version of the site's copy before a big change, and restore it in one click." |
     | `Shield` | "Secure by default" | "Per-site tokens, per-site API keys, and per-editor permissions." |

   - Imports: drop `Users2`, `Languages` and `FlaskConical`; add `UserPlus`, `ImagePlus` and
     `Upload`.
   - Replace the comment at `:16-25` with a tombstone:
     - Until s50 the cards were Translate and Test, and this comment claimed both had shipped.
     - Neither had a customer surface. The A/B page sits in the unrouted `_ab-tests` folder, and
       its cron is not in `vercel.json`. The only translation UI is imported by tests alone, and
       visitors are always served `en`.
     - Each card now points at the code behind it: the invite form and editor codes, and
       `/api/ai/suggest`.
     - A/B and translation stay off this page until a customer can reach them.
   - Grid markup and classNames are unchanged.

5. [x] **ValueProposition, HowItWorks and FinalCTA (V1, W1, W4).** Add to
   `homepage-truth.test.tsx`:
   - "ValueProposition › does not list A/B tests among the jobs it takes off developers". The
     new sentence is present and "A/B" is absent.
   - "HowItWorks › shows the tag the dashboard issues for production". Take the first `<pre>`
     and collapse its whitespace with `replace(/\s+/g, " ")`. It must equal
     `buildEmbedScript({ siteId: "YOUR_SITE_ID", siteToken: "YOUR_SITE_TOKEN", appUrl:
     canonicalizePublicAppUrl("https://recopyfa.st"), wsUrl: "" })`.
   - "HowItWorks › makes no five-minute claim". "A few minutes." and "Set up in minutes" are
     present; nothing matches `/five minutes|5 minutes/i`.
   - "FinalCTA › makes no five-minute claim". "Set up in minutes" is present; nothing matches
     `/5 minutes/`.

   **Red, then green:**
   - `ValueProposition.tsx:108-109` → "Every typo fix, every price change, every campaign update
     requires a developer ticket and days of waiting."
   - `HowItWorks.tsx:33-36`: both hosts become `https://www.recopyfa.st`, so the template is
     `src="https://www.recopyfa.st/embed/recopyfast.js"` … `data-api-url="https://www.recopyfa.st/api"`.
     Attribute order and line breaks are unchanged.
   - `:98` → "A few minutes.".
   - `:218` → "Set up in minutes".
   - `FinalCTA.tsx:31` → "Set up in minutes". Nothing else in FinalCTA changes; `:90-116`
     belongs to s47b.
   - Rewrite `HowItWorks.tsx:15-18` to say three things:
     - The template shows the host the dashboard issues, `www`, because the apex 308-redirects and
       a CORS preflight cannot follow a redirect (`embed-script.ts:21-39`, B-11).
     - The production tag also carries `data-ws-url`. The template leaves it out because
       realtime is additive and editing-session only (ADR 004, ADR 022).
     - A test pins the template to `buildEmbedScript`.
   - Rewrite `:22-24`: realtime exists again, for editing sessions only, and no step promises it
     to visitors.
   - Rewrite `:213-216` as a tombstone: s50 dropped "under five minutes" because nothing measures
     install time.

6. [x] **Demo image modal: no AI generation (D4).** New
   `src/components/landing/demo/__tests__/EditableImage.test.tsx`:
   - "offers replacement only, with no AI image generation". After clicking "Replace image",
     "Generate with AI", "Describe the image you want" and any `textarea` are absent.
   - "swaps to the next photo in the pool". "Use the next photo" calls `onReplace` with the next
     pool entry and closes the dialog. This one is a declared guard and passes before the change.

   **Red, then green**, in `EditableImage.tsx`:
   - Delete the `prompt` state, `requestAiImage`, the label and textarea block, and the "Generate
     with AI" button (`:141-168`, keeping `:170-177`). Delete the `Sparkles` import.
   - Replace the comment at `:58-60` with a tombstone. The modal offered AI image generation
     behind a sign-in. No image-generation feature exists: the product's modal takes a URL or an
     upload (`recopyfast.src.js:4714`, `:4748`). So the demo only shuffles.
   - Styles are unchanged.

7. [x] **Footer (T1, T3, T4, T5, T7, T8).** Add to `homepage-truth.test.tsx`, `describe("Footer")`:
   - "describes the product without 'any website' or a CMS claim". The new description is
     present; "Transform any website" and "content management platform" are absent.
   - "sends email to support@recopyfa.st". The link labelled "Email" has `href`
     `mailto:support@recopyfa.st`.
   - "shows no status, version or docs claim". "All systems operational", "v1.0.0",
     "Comprehensive docs" and "Secure & lightweight" are absent; "Secure by default" is present.
     "Privacy Policy", "Terms of Service", "Compare tools" and "GitHub" are still present.

   **Red, then green**, in `src/components/layout/Footer.tsx`:
   - Description `:68-69` → "Make the copy on the site you already built editable, with one
     script tag. No backend changes, no migration."
   - `quickFeatures` → `[{ Rocket, "One-line integration" }, { Shield, "Secure by default" }]`.
     Drop the `BookOpen` import.
   - Mail `href` → `mailto:support@recopyfa.st`.
   - Delete the right-hand bottom-bar block at `:143-151` (status dot, "All systems
     operational", "v1.0.0").
   - Add a tombstone. `hello@recopyfast.com` was on an unregistered domain (NXDOMAIN): whoever
     registers it receives customer mail. The status line was hardcoded and would stay green
     during an outage (`/status` returns 404). The version matched nothing (`package.json` says
     0.1.0). `/docs` returns 404. `support@recopyfa.st` is the customer mailbox (owner,
     2026-09-28).

8. [x] **Legal contact addresses (AC 6).** New `src/__tests__/app/legal-contacts.test.tsx`.
   Render `src/app/terms/page.tsx` and `src/app/privacy/page.tsx`, with `Header` mocked to a
   named `Header: () => null` and `Footer` to a default `() => null`.
   - `it.each(["terms", "privacy"])("every address on /%s is support@ or privacy@recopyfa.st")`.
     Every `a[href^="mailto:"]` is one of the two, and its text equals the address.
   - "routes customer support to support@ and everything legal to privacy@". Under "General
     Support" the address is `support@recopyfa.st`. Under "Legal Inquiries", "Security Issues",
     "Data Protection Officer", "Security Team" and "EU Representative", and in the `/terms`
     "Security Contact" box, it is `privacy@recopyfa.st`.
   - "/terms no longer points at a status page". "Real-time status monitoring" is absent.

   **Red, then green.** Change each `href` and link text:
   - `terms/page.tsx:421-424`, `:448-451`, `:465-468` and `:482-485` → `privacy@recopyfa.st`.
   - `terms/page.tsx:499-502` → `support@recopyfa.st`.
   - `privacy/page.tsx:364-367`, `:464-467`, `:484-487` and `:504-507` → `privacy@recopyfa.st`.
   - `privacy/page.tsx:524-527` → `support@recopyfa.st`.
   - Delete the `<li>` at `terms/page.tsx:271-274`.

   No other text on either page changes.

9. [x] **Metadata (M1–M3).** New `src/__tests__/app/site-metadata.test.tsx`:
   - Mock `@/contexts/AuthContext` so `AuthProvider` renders its children.
   - Mock `next/og` so `ImageResponse` is a `jest.fn` that returns `{ element }`.

   Tests:
   - "titles the site by what it does". `metadata.title.default`, `openGraph.title` and
     `twitter.title` are all "ReCopyFast - Edit your website copy in place".
   - "describes it as one script tag on the site you already built". `description`,
     `openGraph.description` and `twitter.description` are all "Make the copy on the site you
     already built editable, with one script tag." `keywords` has no "headless CMS".
   - "keeps the manifest in step". `manifest().name` and `.description` equal the same title and
     description.
   - "draws the same line on the social card". `alt` from `opengraph-image` is "ReCopyFast -
     Make the copy on the site you already built editable, with one script tag." The rendered
     `element` text contains the description, and nothing matches `/any website/i`.

   **Red, then green:**
   - `layout.tsx:42-44`: the constants.
   - `layout.tsx:58`: delete `"headless CMS",`.
   - `manifest.ts:5,7-8`.
   - `opengraph-image.tsx:3-4` and `:84-85`.
   - `twitter-image.tsx` is unchanged (it re-exports).

10. [x] **Gates, evidence, one commit.** In the worktree:
    - Run `npm run setup`, then copy in this plan and the research (both are untracked at the
      root).
    - Use the CI placeholder environment (`ci.yml:35-66`). Never copy `.env*` into the worktree.

    Gates:
    - `npm run precommit` (lint, type-check, full Jest).
    - `npm run format:check`, `npm run type-check:build`, `npm run build`.
    - `npx playwright test --list`: still **44** tests.

    Playwright, locally:
    - Run `npx playwright test e2e/landing.spec.ts` against the local Supabase stack. Export its
      env from `npx supabase status -o env`, in the shape of `ci.yml:176-178,246`.
    - If the stack's `plans` rows predate the migration, first apply
      `20260928130000_catalogue_copy_truth.sql` to it. It is local, copy-only and idempotent, and
      CI applies the same file. Never run `supabase db reset`: other worktrees share the stack.
    - First check that port 3000 is free or is this worktree's own server
      (`lsof -nP -iTCP:3000 -sTCP:LISTEN`, then the process's cwd). `reuseExistingServer: true`
      would otherwise test another checkout.
    - If the stack is unavailable, say so. The spec then runs in PR CI, which replays every
      migration and runs all 44 (s33 precedent).

    Mutations. Apply each alone, restore it, and check the restore with a sha256:
    - M1: put the guarantee line back → `retired-promises`, `homepage-truth` and E2E-018 fail.
    - M2: a `// Priority support` comment in `Footer.tsx` → still green, which proves comments are
      ignored.
    - M3: a scratch migration `20260929000000_x.sql` writing "Priority support" into
      `pro.features` → the catalogue guard fails. Delete it afterwards.
    - M4: the apex host back in HowItWorks → the template test fails.

    Then:
    - Tick `docs/stories.md` s50.
    - Append `## Execution log` to this plan with the **claim table**. It has one row per research
      ID marked FALSE, GRAVEYARD or UNVERIFIABLE (30 rows), with these columns: ID, verdict,
      action, where it is now (`file:line`), and the test that pins it.
    - Add one row per claim s50 *introduces*, with its evidence from Resolved question 4 and the
      research IDs: the Invite and Rewrite cards, "Swap images too", "Draft, then publish",
      "Email support", "Version snapshots and restore", "AI rewrite suggestions, 500 credits a
      month", "Set up in minutes", and the metadata line.
    - Commit once: `fix: every homepage claim is one the product backs`.

## Run interdicts

- `public/embed/**` has an empty diff (0-byte allocation).
- `src/components/sections/Hero.tsx` has an empty diff.
- The `FinalCTA.tsx` diff is line 31 only.
- In `Pricing.tsx`, the diff is the deletion of line 73 plus the new comment below the array.
  `:63-72`, the Founding Agency card (`:332`) and the render block stay byte-identical (s47b).
- `trial-claims.test.tsx` and E2E-017: deletions only.
- `playwright.config.ts`, `.github/workflows/ci.yml` and
  `src/__tests__/e2e/playwright-ci-contract.test.ts` have empty diffs, and there is no new
  Playwright test (the 44-test contract).
- `git diff main -- supabase/` is exactly one new file, `20260928130000_catalogue_copy_truth.sql`.
  - No applied migration is edited.
  - No write to price, `limits`, `grants_plan_id`, `is_active`, `sort_order`, `stripe_*`,
    `name` or `kind`.
  - The `free` and `lifetime_agency` rows are untouched.
- Never run `check:stripe:live` or `sync:stripe*`. No Stripe or production database call, no
  `supabase db push`, no `supabase db reset`.
- Never point Playwright at production. Never copy the root `.env*` files.
- No copy beyond what this plan quotes. Out of scope and untouched:
  - the Resolved-13 follow-ups;
  - the test fixtures `Pricing.agency.test.tsx:50` and `BillingDashboard.plan-card.test.tsx:36`
    (mocks, not page source);
  - `public/demo-site/`;
  - the widget's Languages tab;
  - design-system classNames.
- AGENTS.md and `docs/architecture.md` untouched. No ADR, since no structural choice is made. No
  push, PR, merge or production action. Never `--no-verify`.

## The point everything turns on

**What the guard counts as "the copy".** It is the user-visible strings of every page and
component, read as AST literals so tombstones do not count, plus the plans rows as the last
migration leaves them. If that definition is wrong, the guard is green while a retired promise
still reaches a visitor.

- **Copy outside the scan roots.**
  - Blog posts come from `blog_posts`, generated by the cron, and are not scanned.
  - Stripe Checkout shows the old descriptions until the operator syncs.
  - Emails are not pages.
  - Compare against the list of routes under `src/app`: is there a public route whose strings
    live outside `src/app`, `src/components` or `src/lib/compare`?
- **Last writer of the plans copy.**
  - The catalogue guard proves the phrases survive only in the two applied seeds, and that
    `20260928130000`, which sorts after both, overwrites those rows' `features`.
  - Compare with `ls supabase/migrations | tail` and with s47a's and s48's migrations, which
    touch no `plans` row (s47a plan, interdict at line 395).
  - E2E-018 is the end-to-end proof. It is only non-vacuous if the cards loaded, hence the wait
    on the Starter heading.
- **s47b's rebase.** Research trap 4 is followed: deletions only in existing test blocks, and new
  assertions in new files or in E2E-018. The one likely conflict is `landing.spec.ts:203` next to
  s47b's `:196-202`. Resolve it by taking s47b's block without the guarantee line.

## Files touched

- `supabase/migrations/20260928130000_catalogue_copy_truth.sql` (new)
- `src/components/sections/{Pricing,Benefits,ValueProposition,HowItWorks,FinalCTA}.tsx`
- `src/components/landing/demo/EditableImage.tsx`, `src/components/layout/Footer.tsx`
- `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`
- `src/app/layout.tsx`, `src/app/manifest.ts`, `src/app/opengraph-image.tsx`
- Tests, new:
  - `src/__tests__/marketing/retired-promises.test.ts`
  - `src/__tests__/lib/stripe/catalogue-copy-truth.test.ts`
  - `src/components/sections/__tests__/homepage-truth.test.tsx`
  - `src/components/landing/demo/__tests__/EditableImage.test.tsx`
  - `src/__tests__/app/legal-contacts.test.tsx`
  - `src/__tests__/app/site-metadata.test.tsx`
- Tests, edited:
  - `src/components/sections/__tests__/trial-claims.test.tsx`: `:63-65` deleted.
  - `e2e/landing.spec.ts`: `:203` deleted, E2E-018 extended.
- `docs/research/s50-homepage-truth.md`, `docs/plans/s50-homepage-truth.md`, `docs/stories.md`

## Test strategy

The tests work at four levels, and every assertion is about words a visitor can read:

1. **Source.** An AST scan of the user-facing source for the five retired phrases, so a promise
   removed today cannot come back through any page or component.
2. **Data.** The migration text pins the exact plans copy, and a last-writer check proves the
   effective catalogue is clean.
3. **Render.** Each changed section, the legal pages' `mailto` set, the metadata objects and the
   drawn OG card are rendered or evaluated. Each test asserts that the new copy is present and
   the retired copy absent.
4. **Browser.** E2E-018 reads the served homepage, including the catalogue cards from a database
   with every migration applied.

Positive assertions stay out of lines s47b owns. Mutations M1–M4 prove the guards are not
vacuous.

## Definition of Done

- All ten tasks ticked. Red observed before each green, with the declared guards named.
- In the worktree: `lint`, `type-check`, `format:check`, full Jest, `type-check:build` and
  `build` are green. `--list` shows 44. `landing.spec.ts` is green locally, or the deviation is
  declared and left to PR CI.
- One commit on `feature/s50-homepage-truth`. The Execution log carries the claim table the
  review records.
- **Operator, before ship:** `support@recopyfa.st` and `privacy@recopyfa.st` both receive a test
  mail. Until then, "Email support" and every contact link are false.
- **Operator, after merge:**
  1. Deploy.
  2. Run `npx supabase db push --linked --dry-run`. It must list only reviewed migrations, then
     push.
  3. Wait 5 minutes and check that `/api/pricing` shows the new bullets.
  4. Run `npm run check:stripe:live`. It should report description drift on starter, agency,
     credits and lifetime_pro, plus lifetime_agency if s45's sync never ran.
  5. Run `npm run sync:stripe:live`. It patches the text only; no price changes.
  6. Live check: the footer `mailto`, `/terms`, `/privacy` and the page title.
- **Ship order.**
  - s50 before s47b. s47b takes its own block without the guarantee line. Its brief's §1c
    "unchanged" row for the guarantee is stale.
  - If s50's migration reaches production before s48's `110000` or s47a's `120000`, their later
    push needs `--include-all`. Order is safe, because none of the three touches the same rows.
- **Risks.**
  - C10 "Works on any plan" is only fully true once s49 ships.
  - Production copy is true only after the operator steps. Until `sync:stripe:live` runs,
    Stripe Checkout still shows "translations" and "A/B".

## Execution log

Executed 2026-09-28 on `feature/s50-homepage-truth` (from `main` at `a392bb1`), in
`.omx/worktrees/s50-homepage-truth`, with the CI placeholder environment (`ci.yml:35-80`) and
`RCF_TEST_SUPABASE_CONFIG` pointed at unreachable ports (59998/59999), because another story was
using the local Supabase stack. The DB-backed Jest suites therefore reported `[gated]`.

### Red before green

| Task | Red observed | Declared guards (green from the start) |
|---|---|---|
| T1 | `retired-promises` › "no public page says recopyfast.com" (Footer, terms, privacy), "…money-back" (Pricing), "20260928130000 rewrites…" (ENOENT) | scanner (2), "priority support", "onboarding call", "future pro features" in source, "survive only in the applied seeds" |
| T2 | `catalogue-copy-truth` 5 of 6 (ENOENT) | "leaves the applied seeds as they were" |
| T3 | `homepage-truth` › Pricing "makes no money-back promise" | — |
| T4 | Benefits "leads with…", "lists only shipped capabilities" | "keeps the #features anchor" |
| T5 | ValueProposition, HowItWorks ×2, FinalCTA (4) | — |
| T6 | `EditableImage` › "offers replacement only…" | "swaps to the next photo in the pool" |
| T7 | Footer ×3 | — |
| T8 | `legal-contacts` ×4 | — |
| T9 | `site-metadata` ×4 | — |

### Claim table

Every research ID marked FALSE, GRAVEYARD or UNVERIFIABLE (30 rows). "Where it is now" is the
line on this branch; a removed claim points at its tombstone.

| ID | Verdict | Action | Where it is now | Pinned by |
|---|---|---|---|---|
| D4 | FALSE | Removed the prompt, "Generate with AI" and `requestAiImage`; tombstone | `src/components/landing/demo/EditableImage.tsx:49` | `EditableImage.test` "offers replacement only, with no AI image generation" |
| V1 | FALSE | Reworded: "every price change" | `src/components/sections/ValueProposition.tsx:108` | `homepage-truth` "ValueProposition › does not list A/B tests…"; E2E-018 "A/B" |
| W4 | FALSE | Template hosts → `https://www.recopyfa.st`; comment rewritten | `src/components/sections/HowItWorks.tsx:38-41` (comment `:15-23`) | `homepage-truth` "HowItWorks › shows the tag the dashboard issues for production" |
| B1 | FALSE | H2 "Changing the words should be the easy part" + new paragraph | `src/components/sections/Benefits.tsx:120-124` | `homepage-truth` "Benefits › lists only shipped capabilities" (absent "Knowing which words to use", "ReCopyFast does both") |
| B2 | FALSE | Removed; card refilled with Invite | `Benefits.tsx:36-42` (tombstone `:16-34`) | "Benefits › leads with inviting editors and AI rewrite…"; E2E-018 |
| B3 | FALSE | Removed; card refilled with Rewrite | `Benefits.tsx:43-49` (tombstone `:16-34`) | "Benefits › leads with…"; E2E-018 "A/B", "Find out which words actually win" |
| B8 | FALSE | Reworded: "One script tag" + CSP caveat | `Benefits.tsx:77-80` | "Benefits › lists only shipped capabilities" ("Works everywhere" absent); E2E-018 |
| B9 | FALSE | Reworded: "Save and restore" | `Benefits.tsx:83-86` | "Benefits › lists only shipped capabilities" ("Full version history", "Roll back at any point" absent); E2E-018 |
| P4 | FALSE | Removed; tombstone below the array | `src/components/sections/Pricing.tsx:74-77` | `homepage-truth` "Pricing › makes no money-back promise"; `retired-promises` "no public page says money-back"; E2E-018 |
| C3 | FALSE | Starter and Pro → "Version snapshots and restore" | `supabase/migrations/20260928130000_catalogue_copy_truth.sql:49-58` | `catalogue-copy-truth` "sets each row's copy exactly"; E2E-018 "Full version history" |
| C4 | FALSE | "Community support" → "Email support" | `20260928130000_catalogue_copy_truth.sql:49-53` | `catalogue-copy-truth` "says Email support on every subscription plan" |
| C5 | FALSE | → "AI rewrite suggestions, 500 credits a month" | `20260928130000_catalogue_copy_truth.sql:55-58` | `catalogue-copy-truth` "sets each row's copy exactly"; E2E-018 "A/B" |
| C9 | FALSE | → "1,000 AI credits for AI rewrite suggestions" (Stripe sync pending, operator) | `20260928130000_catalogue_copy_truth.sql:66-69` | `catalogue-copy-truth` "sets each row's copy exactly" |
| C12 | FALSE | → "…5 websites and AI features. No recurring billing." (Stripe sync pending, operator) | `20260928130000_catalogue_copy_truth.sql:71-75` | `catalogue-copy-truth` "sets each row's copy exactly"; E2E-018 "unlimited translations" |
| T1 | FALSE | Reworded: "Make the copy on the site you already built editable…" | `src/components/layout/Footer.tsx:87-88` (tombstone `:24-43`) | `homepage-truth` "Footer › describes the product without 'any website' or a CMS claim" |
| T3 | FALSE | "Secure & lightweight" → "Secure by default" | `Footer.tsx:59` | "Footer › shows no status, version or docs claim" |
| T4 | FALSE | Removed; tombstone | `Footer.tsx:24-43` | "Footer › shows no status, version or docs claim"; E2E-018 "Comprehensive docs" |
| T5 | FALSE | `mailto:support@recopyfa.st`; tombstone | `Footer.tsx:52` | "Footer › sends email to support@recopyfa.st"; `retired-promises` "no public page says recopyfast.com"; E2E-018 `page.content()` |
| T7 | FALSE | Removed (bottom-bar right block); tombstone | `Footer.tsx:24-43` | "Footer › shows no status, version or docs claim"; E2E-018 |
| T8 | FALSE | Removed; tombstone | `Footer.tsx:24-43` | "Footer › shows no status, version or docs claim"; E2E-018 "v1.0.0" |
| M1 | FALSE | Title → "ReCopyFast - Edit your website copy in place" | `src/app/layout.tsx:46`; `src/app/manifest.ts:5` | `site-metadata` "titles the site by what it does", "keeps the manifest in step"; E2E-018 `page.title()` |
| M2 | FALSE | Description → "Make the copy on the site you already built editable, with one script tag." | `layout.tsx:47-48`; `manifest.ts:7-8` | `site-metadata` "describes it as one script tag on the site you already built" |
| M3 | FALSE | Same line on the social card, text and alt | `src/app/opengraph-image.tsx:3-4, :84-85` | `site-metadata` "draws the same line on the social card" |
| B6 | GRAVEYARD | Not advertised; the shipped per-editor levels are described in the Invite card | `Benefits.tsx:36-42` | "Benefits › lists only shipped capabilities" ("Role-based permissions" absent); E2E-018 |
| B12 | GRAVEYARD | Removed; "Per-site tokens, per-site API keys, and per-editor permissions." | `Benefits.tsx:89-92` | "Benefits › lists only shipped capabilities" ("audit log" absent); E2E-018 "audit log" |
| W1 | UNVERIFIABLE | Number dropped: "A few minutes." and "Set up in minutes" (×2); tombstone | `HowItWorks.tsx:103, :224` (tombstone `:218-222`); `src/components/sections/FinalCTA.tsx:30` | `homepage-truth` "HowItWorks › makes no five-minute claim", "FinalCTA › makes no five-minute claim"; E2E-018 |
| C1 | UNVERIFIABLE | Starter description "1 website, click-to-edit, draft and publish"; bullet "Draft, then publish" (Starter, Pro) | `20260928130000_catalogue_copy_truth.sql:49-58` | `catalogue-copy-truth` "sets each row's copy exactly" |
| C6 | UNVERIFIABLE | "Email support" on Starter, Pro, Agency; Agency description "…email support" | `20260928130000_catalogue_copy_truth.sql:49-64` | `catalogue-copy-truth` "says Email support on every subscription plan"; `retired-promises` (source and catalogue); E2E-018 |
| C10 | UNVERIFIABLE | Kept (Resolved 11): credits spend on any plan; buying from the lapsed and no-plan screens arrives with s49 | `20260802000000_plans_catalog.sql:304` (unchanged) | `catalogue-copy-truth` "sets each row's copy exactly" (credits features not written) |
| C13 | UNVERIFIABLE | Removed (owner) | `20260928130000_catalogue_copy_truth.sql:71-75` | `catalogue-copy-truth` "drops the future-features promise from Lifetime Pro"; `retired-promises`; E2E-018 "future Pro features" |

### Claims s50 introduces

| Claim | Where | Evidence (research IDs, Resolved Q4) | Pinned by |
|---|---|---|---|
| Invite card: "Hand a client the words, not the site" | `Benefits.tsx:36-42` | B7, W6: editors are invited by email and sign in with a one-time code; Publish is a per-editor permission (`InviteEditorForm.tsx:40-43`), and the widget shows Publish only for `publish` or `admin` (`recopyfast.src.js:2235`). Fix run: "You choose, per editor, who can publish." (see below) | "Benefits › leads with…" |
| Rewrite card: "AI rewrites, in place" | `Benefits.tsx:43-49` | B5, D5: six goals incl. professional and casual (`recopyfast.src.js:5261-5268`) sent to `/api/ai/suggest`; sign-in and credits required | "Benefits › leads with…" |
| "Swap images too" | `Benefits.tsx:65-68` | D1, D3: the widget's image modal takes a URL (`recopyfast.src.js:4714`, `:4748`) or an upload (`POST /api/upload/image`, `:2831`) | "Benefits › lists only shipped capabilities" |
| "Draft, then publish" (card and plan bullet) | `Benefits.tsx:71-74`; migration starter, pro | D2, W6: edits are staged, Publish is separate and permissioned (`:2235`); visitors read `published_content` (`src/app/api/content/[siteId]/route.ts:416-436`) | "Benefits › lists only shipped capabilities"; `catalogue-copy-truth` |
| "Email support" | migration starter, pro, agency | Owner decision 2026-09-28; mailbox `support@recopyfa.st`. **True only once the operator has sent it a test mail (DoD).** | `catalogue-copy-truth` "says Email support…" |
| "Version snapshots and restore" / "Save and restore" | migration starter, pro; `Benefits.tsx:83-86` | B9: "Save Current Version" (`recopyfast.src.js:6160-6185`), restore through `restore_content_version` (`src/app/api/edit-board/history/[versionId]/route.ts:290`) | `catalogue-copy-truth`; "Benefits › lists only shipped capabilities" |
| "AI rewrite suggestions, 500 credits a month" | migration pro | C5: Pro `limits.monthly_credits: 500` (`20260802000000_plans_catalog.sql:295`); `/api/ai/suggest` | `catalogue-copy-truth` "sets each row's copy exactly" |
| "Set up in minutes" / "A few minutes." | `HowItWorks.tsx:103, :224`; `FinalCTA.tsx:30` | W1, W2, W3: three steps, one tag, no build step; no number claimed | "HowItWorks › makes no five-minute claim", "FinalCTA › makes no five-minute claim" |
| Metadata: "Edit your website copy in place" / "Make the copy on the site you already built editable, with one script tag." | `layout.tsx:46-48`; `manifest.ts:5-8`; `opengraph-image.tsx:3-4, :84-85` | B8 and the launch kit's "one script tag on the site you already built"; H1 (the widget edits copy in place) | `site-metadata` (4) |

### Gates (worktree, CI placeholder env)

| Gate | Result |
|---|---|
| `npm run lint` | 0 errors, 40 warnings (none in a new file; the touched-file warnings are pre-existing unused imports in `terms`/`privacy` and the `<img>` in `EditableImage`) |
| `npm run type-check` / `type-check:build` | green / green |
| `npm run format:check` | green |
| Full Jest | 281 suites passed, 2 skipped; 3,559 tests passed, 38 skipped. The 10 DB suites under `src/__tests__/db` reported `[gated]` (unreachable port 59999, by instruction) |
| `npm run build` | green; `public/embed/**` unchanged after `prebuild` |
| `npx playwright test --list` | 44 tests in 10 files |

### Mutations (each applied alone, restored, sha256 checked)

| Mutation | Result |
|---|---|
| M1 guarantee line back in `Pricing.tsx` | `retired-promises` "…money-back" and `homepage-truth` "Pricing › makes no money-back promise" fail. Restored, sha256 `b7f5a0e1…04eb88` |
| M2 `// Priority support` comment in `Footer.tsx` | `retired-promises` stays green (9/9): comments are ignored. Restored, sha256 `9d9d3b92…221de8` |
| M3 scratch `20260929000000_x.sql` writing "Priority support" into `pro.features` | "the retired phrases survive only in the applied seeds" fails. File deleted |
| M4 apex host back in `HowItWorks.tsx` | "HowItWorks › shows the tag the dashboard issues for production" fails. Restored, sha256 `3a59d21a…30aca64` |

### Pending, not skipped

- **T2 local DB replay** (apply `20260928130000` twice inside `BEGIN … ROLLBACK`, read back the six
  rows): not run. The local Supabase stack was in use by another story and this run was told not
  to touch it. The SQL is pinned statically by `catalogue-copy-truth`, and PR CI replays every
  migration against Postgres.
- **`e2e/landing.spec.ts` locally** (E2E-017, E2E-018): not run, for the same reason. Without
  the stack `/api/pricing` serves no plans, and E2E-018 waits on the Starter card. The spec runs
  in PR CI, which replays every migration and runs all 44 (s33 precedent).

### Deviations from this plan

- **`FinalCTA.tsx` diff is lines 30-32, not line 31 alone.** With the shorter copy Prettier
  folds the `<span>` onto one line, and `format:check` is a gate. Nothing outside the badge
  changed; `:90-116` (s47b) is untouched.
- **`docs/stories.md` s50: ACs 1-7 ticked, AC 8 left open.** Its Playwright half has not run
  (see Pending); the Jest half and the local gates are green.
- **T2's DB replay and the local `landing.spec.ts` run are pending**, not done (see Pending).

### Fix run (review major 1)

- The Invite card said "Publish stays off unless you grant it, so their edits wait as drafts for
  you." The dashboard's "Invite a client" dialog pre-selects Publish
  (`ActivationChecklist.tsx:349`), so that was false on the first-run path. Product owner wording:
  the sentence is now "You choose, per editor, who can publish." The Benefits tombstone records
  why. No dialog default changed.
- Red first: `homepage-truth` "Benefits › leads with…" now requires the new sentence and forbids
  "Publish stays off unless you grant it"; it failed before the copy change.
- Review minors 2-6 left as they are: none is a one-line fix in these files with owner-given copy.
