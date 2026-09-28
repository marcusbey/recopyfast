# Research — Story s50-homepage-truth

Researched 2026-09-28 against `main` at `934253b` and production `https://www.recopyfa.st`
(read-only `curl` around 09:40 UTC). Production matches `main`: every homepage string cited below
was found in the live HTML, `/api/pricing` returned the catalogue quoted here, and the live
`/embed/recopyfast.js` contains the Edit Board, History, Languages and image-upload code cited
from `public/embed/recopyfast.src.js`.

## The five structuring facts

1. **Both headline features are false.** The two big cards, Translate and Test
   (`src/components/sections/Benefits.tsx:26-41`), have no customer surface. The A/B page lives in
   an unrouted private folder (`src/app/dashboard/_ab-tests/page.tsx`, commit `d7cc8e0`) and its
   cron is not scheduled (`vercel.json`). The only translation UI is imported by tests alone, and
   visitors are always served `en` (`src/app/api/content/[siteId]/route.ts:369`). The section's
   layout anchor has to be refilled, not just edited.
2. **A third of the false claims are data, not code.** Plan descriptions and feature bullets render
   from the `plans` table (`src/app/api/pricing/route.ts:16`, seeded in
   `supabase/migrations/20260802000000_plans_catalog.sql:283-313` and
   `20260804140000_yearly_price_matches_stripe.sql:64`). Fixing them takes a forward migration.
   Descriptions are also projected onto Stripe products (`scripts/sync-stripe-catalogue.mjs:698-699`),
   so the operator has to run `sync:stripe:live` after deploy.
3. **Version history and image replacement are real, but narrower than the copy says.** Rollback
   only restores site-wide snapshots that someone saved (`public/embed/recopyfast.src.js:6160-6185`).
   Publishing writes no version (`20260924060000_restore_site_wide_publish.sql:59`). Replacing an
   image by URL or upload is shipped (`recopyfast.src.js:4714`, `:2831`). The homepage demo also
   offers AI image generation, which exists nowhere
   (`src/components/landing/demo/EditableImage.tsx:146-167`).
4. **The footer is the densest false block, and one item is a security smell.**
   `hello@recopyfast.com` is on an unregistered domain (NXDOMAIN). The footer also claims
   "Comprehensive docs" (`/docs` is a 404), a hardcoded "All systems operational", and "v1.0.0"
   while `package.json` says 0.1.0 (`src/components/layout/Footer.tsx:32-40`, `:144-150`).
   `/terms` and `/privacy` list five more addresses on the same dead domain.
5. **Only two assertions pin the guarantee, and both sit where s47b is editing.** They are
   `src/components/sections/__tests__/trial-claims.test.tsx:63-65` and
   `e2e/landing.spec.ts:203`, both inside hunks s47b rewrites. Nothing pins Benefits, Footer or
   metadata copy. s50's new absence assertions belong somewhere s47b will not touch; the
   precedent is E2E-018 (`e2e/landing.spec.ts:206-233`).

## Target story

`docs/stories.md:1879-1900`. Operator decision on 2026-09-28, from the PR #47 launch-kit fact
check. Complexity 2. Branch `feature/s50-homepage-truth`. Embed allocation 0 bytes.

Acceptance criteria:

- [ ] The "30-day money-back guarantee" is removed wherever it appears. Owner decision: remove it;
  refunds stay case by case.
- [ ] Graveyard features with no customer surface (audit log, role-based permissions, anything else
  in `docs/prd.md` § graveyard) are not advertised.
- [ ] Every remaining feature claim (A/B testing, translation, version history, image replacement,
  "works on any site", "no login") is either demonstrable on production today or reworded or
  removed. The result goes in the story's review, with the evidence for each claim.
- [ ] Copy tests and the Playwright landing check pass with the new copy. Required local gates
  pass. One story commit. No push, PR, merge or production action.

Coordination note in the story: s47b edits the same Hero and Pricing copy, so either ship s50
first or rebase s47b on it.

## Current state of the code

**The surface.** `src/app/page.tsx` renders, in order: `Header`, `Hero`, `HeroDemo` (which wraps
`InteractiveHero`), `ValueProposition`, `HowItWorks`, `Benefits`, `Pricing`, `FinalCTA`, `Footer`.
All of them are client components with hardcoded copy, except for three things:

- The Pricing plan and one-time cards. `Pricing.tsx:83-101` fetches `/api/pricing`, which reads the
  `plans` table.
- Metadata: `src/app/layout.tsx:41-96`, `src/app/opengraph-image.tsx` (re-exported by
  `twitter-image.tsx`), and `src/app/manifest.ts`.
- The Founding Agency count, which comes live from `/api/pricing`.

**What the homepage does not have.** There is no `/pricing` route: production redirects `/pricing`
to `/#pricing`. There is no JSON-LD on the homepage (the live HTML has no `application/ld+json`;
in the code, JSON-LD exists only under `src/app/compare/`). There is no FAQ on the homepage, and
the phrase "no login" appears nowhere on it. A grep of the `/compare` pages, which do have JSON-LD
and an FAQ, for the claim classes below (A/B, translation, versions, audit, roles, guarantee,
"any site", size) found nothing to flag.

### Claims inventory

Verdicts:

- **TRUE**: demonstrable on production today.
- **FALSE**: contradicted by the code or by production.
- **GRAVEYARD**: a feature frozen in the PRD with no customer surface.
- **UNVERIFIABLE**: cannot be shown today.

Items marked *not counted* are framing or illustration, not claims about the product.

#### Hero: `src/components/sections/Hero.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| H1 | :8-15, :74-94 | "Change your [headline · description · button text · testimonial · pricing · any text] in seconds." | TRUE | The widget scans `h1…h6, p, span, li, td, th, label, button, img` (`recopyfast.src.js:2595-2596`). Links are opt-in, which step 02 says (W5). | keep |
| H2 | :103-106 | "Stop waiting days for simple text updates. Add one line of code and give your team direct control over the words on your website." | TRUE | One `<script>` element (`src/lib/sites/embed-script.ts:98`). Editors are invited by email (`InviteEditorForm.tsx:40-43`). | keep |
| H3 | :133 | "Start your free trial" | TRUE | 14 days of Pro granted at sign-in, no card (`src/lib/billing/trial.ts:6-23`). | keep (s47b owns this line) |
| H4 | :144 | "Watch it work" → `/demo` | TRUE | `/demo` returns 200 and serves the interactive demo. | keep |
| H5 | :154 | "14 days of Pro. No credit card required." | TRUE | `trial.ts:23` `TRIAL_DURATION_DAYS = 14`; the grant has no payment method (`:10-18`). | keep (s47b owns this line) |

#### Demo: `src/components/landing/` (the same component renders on `/demo`)

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| D1 | InteractiveHero.tsx:765 | "Click any text or photograph to edit it in place" | TRUE | The widget's image modal says "Replace image or edit properties" (`recopyfast.src.js:4714`); uploads go through `POST /api/upload/image` (`:2831`). | keep |
| D2 | InteractiveHero.tsx:746 | "Saved — ready to publish" | TRUE | Edits are staged; Publish is a separate action (`recopyfast.src.js:2235`). | keep |
| D3 | demo/EditableImage.tsx:88, :120 | "Replace image" | TRUE | As D1. | keep |
| D4 | demo/EditableImage.tsx:146-167 | "Describe the image you want" + "Generate with AI · Sign in" | **FALSE** | No image generation exists: there is no image-generation call in `src/` or in the widget. The product's image modal takes a URL or an upload, nothing else. Signing in unlocks nothing here. | **Remove** the prompt and the button. Keep "Use the next photo" (:176). Replace the false comment at :58-60 with a tombstone. |
| D5 | InteractiveHero.tsx:702-708 | Toolbar AI prompt → sign-in | TRUE | AI rewrite exists, requires sign-in and is credit-metered (`src/app/api/ai/suggest/route.ts`). | keep |

#### Value proposition: `src/components/sections/ValueProposition.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| V1 | :108-109 | "Every typo fix, every A/B test, every campaign update requires a developer ticket and days of waiting." | **FALSE** (implied) | It lists A/B tests among the jobs ReCopyFast takes off the developer. A/B has no customer surface (B3). | **Reword:** "Every typo fix, every price change, every campaign update requires a developer ticket and days of waiting." |
| V2 | :30-31 | "1 line / Of code to install" | TRUE | `embed-script.ts:98` emits one element. | keep |
| V3 | :35-36 | "$0 / Developer cost per update" | TRUE | An invited editor edits and publishes with no developer involved (`recopyfast.src.js:2235`; kit claims ledger). | keep |
| V4 | :46-47 | "No deploy / Live on the next page load" | TRUE | Visitors read `GET /api/content/:siteId` when the page loads (comment :40-45; kit ledger). | keep |
| V5 | :202-204 | "Content updates go from a ticket to a click." | TRUE | As V3. | keep |

*Not counted:* the pain-point stats at :7-26 ("Days", "Dev hours", "Redeploy") describe the
status quo, not the product.

#### How it works: `src/components/sections/HowItWorks.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| W1 | :96-98, :218; FinalCTA.tsx:31 | "Three steps. Five minutes." · "Set up in under five minutes" · "Set up in under 5 minutes" | UNVERIFIABLE | Nothing measures install time; the file says so itself (:213-216). | **Owner decides (Q5).** Keep only if one real install (register → paste → first publish) is timed and recorded in the review. Otherwise: "Three steps. A few minutes." / "Set up in minutes". |
| W2 | :101-102 | "No complex migration. No learning curve. Just direct content control." | TRUE | The script is added to the existing site; there is no content model to migrate to. | keep |
| W3 | :30-32 | "Register your site and the dashboard hands you the tag with your site ID and site token already filled in. Paste it before the closing body tag. No build step, no framework change, no backend." | TRUE | `buildEmbedScript` (`embed-script.ts:98`). | keep |
| W4 | :33-36 | Template: `src="https://recopyfa.st/embed/recopyfast.js"` … `data-api-url="https://recopyfa.st/api"` | **FALSE** | The dashboard issues `www.recopyfa.st` (`embed-script.ts:21-39`), because the apex 308-redirects to www and CORS preflights cannot follow a redirect. Checked today: `curl https://recopyfa.st/api/health` returns 308. The comment at :15-18 says this template mirrors `buildEmbedScript()`; it no longer does. | **Reword:** use `https://www.recopyfa.st/embed/recopyfast.js` and `https://www.recopyfa.st/api`, and fix the comment. |
| W5 | :43-44 | "…headings, paragraphs, list items, table cells, labels, buttons and images. Links stay untouched unless you tag them rcf-editable-link…" | TRUE | `recopyfast.src.js:2595-2596`. | keep |
| W6 | :55-56 | "…Anyone you have given edit access clicks a piece of text, types, and publishes — visitors get the new copy the next time the page loads." | TRUE (narrow) | Publishing needs the Publish permission (`InviteEditorForm.tsx:42`). The widget only shows Publish for `publish` or `admin` (`recopyfast.src.js:2235`). | keep. Optional: "…types, and publishes, or saves a draft for you to publish." |

*Not counted:* the scan output at :45-48 ("47 editable elements mapped") is an illustration shown in
a code window.

#### Features: `src/components/sections/Benefits.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| B1 | :109-114 | "Changing the words is the easy part" / "Knowing which words to use is the hard part. ReCopyFast does both." | **FALSE** | "Which words" means A/B plus impressions, and none of the stories behind them has shipped (s09, s11b, s11c, s12). | **Reword:** H2 "Changing the words should be the easy part". Paragraph: "With ReCopyFast it is: the people who own the copy change it on the live page, and you decide who can publish." |
| B2 | :29-32 | "Translate" / "Every string on the site, in another language" / "Pick a language and translate the whole site in one pass — not string by string. Translations are written back as real content, so they stay editable afterwards." | **FALSE** | (1) The only translation UI, `src/components/dashboard/TranslationDashboard.tsx`, is imported only by tests. (2) The widget's Edit Board "Languages" tab adds a language row and never translates: s40 removed its auto-translate (`src/__tests__/api/edit-board/languages-no-auto-translate.test.ts:1-11`). (3) The widget never asks for a non-default language and the content route defaults to `en` (`src/app/api/content/[siteId]/route.ts:369`), so a translation could never reach a visitor. | **Remove.** Refill the card (Q4). |
| B3 | :36-39 | "Test" / "Find out which words actually win" / "Generate variants of a headline, split your traffic across them, and let the test call it. Views, clicks and conversions are attributed per variant, and the winner stays live on its own." | **FALSE** | The page is `src/app/dashboard/_ab-tests/`, a private folder Next does not route (`d7cc8e0`). The nav entry was removed (`DashboardNavigation.tsx:47-49`). The lifecycle cron is not scheduled: `vercel.json` lists two crons, neither of them `ab-test-lifecycle`. Of the A/B stories, only s11a has a review; s11b, s11c and s12 have not shipped. | **Remove.** Refill the card (Q4). |
| B4 | :46-52 | "Click. Edit. Done." / "Open your site from the dashboard and edit in place. No CMS screens to learn." | TRUE | `EditWebsiteButton` creates the edit-session link and the widget enters edit mode. | keep |
| B5 | :56-58 | "AI that writes like you" / "Rewrite any string for a tone and a goal, without leaving the page." | TRUE | Six goals, including professional and casual (`recopyfast.src.js:5261-5268`), sent to `/api/ai/suggest` (`:5351-5359`; aliases at `suggest/route.ts:95-98`). | keep |
| B6 | :64 | "Role-based permissions" | **GRAVEYARD** | PRD § graveyard: "Teams with org roles". `/dashboard/teams` has redirected since s04 (`src/app/dashboard/teams/page.tsx:1-18`). What shipped is narrower: per-editor View, Edit, Publish or Admin on one site (`InviteEditorForm.tsx:40-43`). | **Reword** the whole line (see B7). |
| B7 | :64 | "plus revocable edit access for contractors." | TRUE | Removing an editor signs out their devices (`SiteEditorsCard.tsx:332-353`). | New line: "Invite editors by email. They sign in with a one-time code, no account. Choose who can publish, and revoke access any time." |
| B8 | :68-69 | "Works everywhere" / "React, Vue, WordPress, Webflow, static HTML. One script tag." | **FALSE** | A strict Content Security Policy blocks the script, and the product says so itself (`src/components/try/TryExperience.tsx:192-196`; kit "What not to say"). | **Reword:** title "One script tag"; description "On the site you already built: React, Vue, WordPress, Webflow or plain HTML. Its Content Security Policy has to allow our script." |
| B9 | :73-75 | "Never lose a word" / "Full version history on every string. Roll back at any point." | **FALSE** | Rollback restores site-wide snapshots (`content_versions`), and those are created in only three ways: "Save Current Version" (`recopyfast.src.js:6160-6185`; the dashboard's History button is at `SiteDetailView.tsx:266-269`), a bulk import, or automatically just before a restore (`20260924030000_content_page_path.sql:274`). Publishing writes `staging_history`, not a version (`20260924060000_restore_site_wide_publish.sql:59`). A per-string `content_history` is written by a trigger, but no screen reads it. | **Reword:** title "Save and restore"; description "Save a version of the site's copy before a big change, and restore it in one click." |
| B10 | :81 | "Scoped API keys" | TRUE | Per-site keys with `scopes` (`src/components/settings/ApiKeysPanel.tsx:140-141`; `src/app/api/api-keys/route.ts:70`). | keep |
| B11 | :81 | "per-site permissions" | TRUE | `site_permissions`; see B6. | keep |
| B12 | :81 | "and an audit log of every edit." | **GRAVEYARD** | PRD § graveyard: "Audit log / compliance console (`/api/audit/*`)". There is no screen for it. | **Remove.** New description: "Per-site tokens, per-site API keys, and per-editor permissions." |

#### Pricing section, hardcoded copy: `src/components/sections/Pricing.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| P1 | :70; FinalCTA.tsx:106 | "14-day free trial" | TRUE | `trial.ts:23`. | keep (s47b owns item 1) |
| P2 | :71; FinalCTA.tsx:110 | "No credit card required" | TRUE | `trial.ts:10-18`. | keep |
| P3 | :72; FinalCTA.tsx:114 | "Cancel anytime" | TRUE | `SubscriptionCard.tsx:81-95` calls `billing/subscription/route.ts:134` (`cancelSubscription`). | keep |
| P4 | :73 | "30-day money-back guarantee" | **FALSE** | `/terms` has no refund clause (no match for "refund" in `src/app/terms/page.tsx`). Owner decision 2026-09-28: remove. | **Remove** the array item and add a tombstone to the comment at :63-68. |
| P5 | :134-139 | "Simple pricing, no surprises" / "Choose the plan that fits your needs. Upgrade anytime." | TRUE | `UpgradeDialog` in `BillingDashboard`. | keep |
| P6 | :164 | "Save 17%" | TRUE | From live `/api/pricing`: Starter $108 → $90 (16.7%), Pro $228 → $189 (17.1%), Agency $588 → $490 (16.7%). | keep |
| P7 | :364-370 | "N of 50 founding spots left" | TRUE | Live values: `remaining: 50, limit: 50`. | keep |

#### Pricing section, catalogue copy (from the `plans` table via `/api/pricing`; shown on the homepage and in the billing screens)

| ID | Where (row → field) | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| C1 | starter → description; starter and pro → features | "1 website, instant copy testing, basic features" · "Instant copy testing" | UNVERIFIABLE | No feature is called copy testing, and Starter has `ab_testing: false`. The nearest real thing is Preview Live, then Publish (`recopyfast.src.js:2223`, `:2235`). | **Reword:** description "1 website, click-to-edit, draft and publish"; feature "Draft, preview, then publish". |
| C2 | starter, pro → features | "Click-to-edit interface" | TRUE | See B4. | keep |
| C3 | starter → "Basic version history"; pro → "Full version history" | as quoted | **FALSE** | No plan gate on versions: nothing under `src/lib/feature-gating` or `src/lib/billing` mentions them. Both plans get the same snapshot feature (B9). | **Reword** both to "Version snapshots and restore". |
| C4 | starter → features | "Community support" | **FALSE** | No community channel exists: no Discord, forum or community link anywhere in `src/app` or `src/components`. | **Remove**, or replace with whatever support line the owner chooses (Q2). |
| C5 | pro → features | "AI A/B copy testing" | **FALSE** | See B3. | **Reword:** "AI rewrite suggestions, 500 credits a month" (`limits.monthlyCredits: 500`). |
| C6 | pro → "Priority support"; agency → "Priority support + onboarding call"; agency description "…Agency support" | as quoted | UNVERIFIABLE | No support tier or support channel exists, and the one advertised address does not work (T5). | **Owner decides (Q2).** |
| C7 | limits | "1 website", "Up to 5 websites", "+$5 per additional website", "10 client websites", "+$4 per additional website", "Unlimited invited editors", "1,000 AI credits / month" | TRUE | The `limits` and `additionalSitePrice` fields of the same `/api/pricing` payload. | keep |
| C8 | pro → description | "Up to 5 websites, all features, +$5 per additional website" | TRUE once C1-C5 are fixed | "All features" means whatever the list says. | keep |
| C9 | credits → description | "1,000 AI credits for suggestions, translations and A/B copy generation" | **FALSE** | Translation and A/B have no customer surface (B2, B3). This text is also projected onto the Stripe product. | **Reword:** "1,000 AI credits for AI rewrite suggestions". |
| C10 | credits → features | "Works on any plan" | UNVERIFIABLE (today) | The API sells credits to any account, but the lapsed and no-plan billing screens offer no purchase until s49 ships (`docs/stories.md:1858-1868`). | keep; true once s49 ships |
| C11 | credits → features | "Credits never expire while your account is active" | TRUE | Purchases insert `expires_at: null` (`src/lib/credits/system.ts:97`; `spendable.ts:15-18`). | keep |
| C12 | lifetime_pro → description | "Pay once, keep every Pro feature forever — 5 websites, AI features, unlimited translations, A/B testing. No recurring billing." | **FALSE** | See B2 and B3. The text was set by `20260804140000_yearly_price_matches_stripe.sql:64` and is projected onto Stripe. | **Reword:** "Pay once, keep every Pro feature forever — 5 websites and AI features. No recurring billing." |
| C13 | lifetime_pro → features | "Includes all future Pro features" | UNVERIFIABLE | A promise about the future. | **Owner decides (Q7).** |
| C14 | "Everything in Pro" (lifetime_pro, agency), "One payment, no renewal", Founding Agency description and features | as served | TRUE | `grants_plan_id`; the s45 migration `20260926120000_lifetime_agency_monthly_credits.sql`. | keep |

#### Final CTA: `src/components/sections/FinalCTA.tsx`

The time claim at :31 is W1, and the trust row at :104-115 is P1-P3.

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| F1 | :60-61 | "Stop waiting on developers for every text change. Give your team the power to update website copy without a deploy." | TRUE | See V3 and V4. | keep |
| F2 | :77, :85 | "Get started" → `/signup`; "See it in action" → `/demo` | TRUE | Both routes return 200. | keep |

#### Footer: `src/components/layout/Footer.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| T1 | :67-69 | "Transform any website into an intelligent content management platform with a single script tag. No backend changes required." | **FALSE** | "Any website": see B8. "Content management platform": the PRD rules out a content model or schema designer (§ graveyard, "never built"). | **Reword:** "Make the copy on the site you already built editable with one script tag. No backend changes, no migration." |
| T2 | :38 | "One-line integration" | TRUE | See V2. | keep |
| T3 | :39 | "Secure & lightweight" | **FALSE** ("lightweight") | The live widget is 45,771 bytes after `gzip -9` (measured today), against the PRD's own 30 KB budget (`docs/prd.md:111`). The launch kit says not to claim size. | **Reword:** "Secure by default". |
| T4 | :40 | "Comprehensive docs" | **FALSE** | There is no docs route in `src/app`, and `/docs` returns 404. | **Remove.** |
| T5 | :32 | `mailto:hello@recopyfast.com` | **FALSE** | `recopyfast.com` is NXDOMAIN (unregistered). The live domain `recopyfa.st` has an MX record (`mail.recopyfa.st`), and transactional mail is sent as `noreply@recopyfa.st` (`src/lib/email/resend.ts:21`). | **Replace** with a recopyfa.st mailbox the owner confirms exists (Q3). |
| T6 | :16, :27 | GitHub link `github.com/marcusbey/recopyfast` | TRUE | Returns 200 without authentication, so the repo is public. | keep. The owner may want to confirm the repo is meant to be advertised. |
| T7 | :144-147 | Pulsing dot + "All systems operational" | **FALSE** | Hardcoded, with no check behind it; `/status` returns 404. It would stay green during an outage. | **Remove.** |
| T8 | :148-150 | "v1.0.0" | **FALSE** | `package.json:3` says `0.1.0`, and nothing versions releases. | **Remove.** |

*Not counted:* "Made with care for content teams" (:139).

#### Header: `src/components/layout/Header.tsx`

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| N1 | :91-163 | Nav links "Features", "Pricing", "Demo", "Try your site", "Blog"; buttons "Sign in", "Get started" | TRUE | The `#features` and `#pricing` anchors exist; `/demo`, `/try` and `/blog` return 200. | keep |

#### Metadata

| ID | Where | Exact text | Verdict | Evidence | Action |
|---|---|---|---|---|---|
| M1 | `layout.tsx:42` (title, og:title, twitter:title); `manifest.ts:5` | "ReCopyFast - Universal CMS Layer" | **FALSE** | "Universal" is another way of saying "works everywhere" (B8). | **Reword:** "ReCopyFast - Edit your website copy in place" (Q6). |
| M2 | `layout.tsx:43-44` (meta description, og:description, twitter:description); `manifest.ts:7-8` | "Transform any website into an editable platform with a simple script tag" | **FALSE** | See B8. | **Reword:** "Make the copy on the site you already built editable, with one script tag." |
| M3 | `opengraph-image.tsx:4` (alt text) and `:84-85` (text drawn on the image), re-exported by `twitter-image.tsx:5` | "Transform any website into an editable platform with a simple script tag" | **FALSE** | See B8. | **Reword:** same wording as M2. |

*Not counted:* the `keywords` array (`layout.tsx:56-64`) includes "headless CMS", which is a stretch.
Search engines ignore this tag. Drop the keyword if the line is being touched anyway.

### Counts

| Verdict | Count | IDs |
|---|---|---|
| TRUE | 38 | H1-H5, D1-D3, D5, V2-V5, W2, W3, W5, W6, B4, B5, B7, B10, B11, P1-P3, P5-P7, C2, C7, C8, C11, C14, F1, F2, T2, T6, N1 |
| FALSE | 23 | D4, V1, W4, B1, B2, B3, B8, B9, P4, C3, C4, C5, C9, C12, T1, T3, T4, T5, T7, T8, M1, M2, M3 |
| GRAVEYARD | 2 | B6, B12 |
| UNVERIFIABLE | 5 | W1, C1, C6, C10, C13 |

### Leads from the launch kit, resolved

The kit is PR #47: `git show docs/gtm-launch:docs/gtm/launch-2026-09-28.md`, sections 11-12.

- **Money-back guarantee.** Appears once on the homepage (P4). Remove it.
- **"Works on any site".** Appears as B8, T1, M1, M2 and M3. The kit's wording, "one script tag
  on the site you already built", runs through the proposed rewordings.
- **"No login".** Does not appear on the homepage. `/try` says "No account, install or saved
  changes", which is true. Nothing to change.
- **A/B testing: FALSE.** No route, no cron; only the s11a data plane shipped.
- **Translation: FALSE.** No UI and no delivery to visitors.
- **Version history: narrower than claimed.** It exists as manual site snapshots with a restore.
  The copy is reworded to match (B9, C3).
- **Image replacement: TRUE.** Replacing by URL or upload works (D1, D3). The demo's AI image
  generation is the false part (D4).

## Anchor points

| File | Change |
|---|---|
| `src/components/sections/Pricing.tsx:69-74` | Delete line 73 only. Add a tombstone line to the comment at :63-68. |
| `src/components/sections/Benefits.tsx:16-41, :62-81, :109-114` | Refill the `headline` array (Q4) and keep the two-card grid at :117-143, so the layout does not change. Rewrite `supporting[2]`, `[3]`, `[4]` and `[5]`. Rewrite the section paragraph. Replace the false comment at :16-25 ("Both are shipped… Nothing here is aspirational") with a tombstone. |
| `src/components/sections/ValueProposition.tsx:108-109` | One phrase (V1). |
| `src/components/sections/HowItWorks.tsx:15-18, :33-36` (+ :96-98, :218 if Q5 says reword) | Template host (W4) and its comment. |
| `src/components/sections/FinalCTA.tsx:31` | Only if Q5 says reword. Nothing else in this file needs to change. |
| `src/components/landing/demo/EditableImage.tsx:57-66, :139-167` | Remove `requestAiImage`, the prompt state, the textarea and the "Generate with AI" button. Keep the shuffle. |
| `src/components/layout/Footer.tsx:30-41, :67-69, :143-150` | T1, T3, T4, T5, T7, T8. |
| `src/app/layout.tsx:42-44` (and `:58`) | M1, M2. |
| `src/app/opengraph-image.tsx:4, :84-85` | M3. |
| `src/app/manifest.ts:5, :7-8` | M1, M2. |
| New `supabase/migrations/2026092xxxxxxx_catalogue_copy_truth.sql` | An idempotent `UPDATE public.plans` of `description` and `features` for `starter`, `pro`, `credits` and `lifetime_pro`, plus the `agency` support lines if Q2 requires. Follow the shape of `20260926120000_lifetime_agency_monthly_credits.sql`: fixed values, `WHERE id = …`, never touch `is_active`, and include the Stripe step in the header. |
| `src/components/sections/__tests__/trial-claims.test.tsx:63-65` | Delete the guarantee assertion. |
| `e2e/landing.spec.ts:203` and `:218-229` | Delete the guarantee line in E2E-017. Add every removed claim to E2E-018's `fabricated` list, or to a new E2E-019 placed after it. |
| New `src/components/sections/__tests__/homepage-truth.test.tsx` | Render Benefits, Pricing, Footer and ValueProposition, and assert the removed strings are absent. Put it in its own file so s47b never touches it. |

## Verified APIs / functions

- `GET /api/pricing` returns `{ plans[], oneTimeProducts[], foundingAgencyAvailability, source }`.
  `features` and `description` come from `plans` through `getPlanCatalogue`
  (`src/lib/stripe/plans.ts`, parsed strictly at `:235-240`). There is no hardcoded fallback
  (`pricing/route.ts:13-25`). Responses are cached in memory for 5 minutes (`:27`).
- `scripts/sync-stripe-catalogue.mjs`. `npm run check:stripe:live` reports drift between the
  database description and the Stripe product (`:698`). `npm run sync:stripe:live` patches the
  product text (`:699`) and creates or changes no price (`package.json:34-37`).
- `canonicalizePublicAppUrl` and `buildEmbedScript` (`src/lib/sites/embed-script.ts:26-39`,
  `:98`). Covered by `src/lib/sites/__tests__/embed-script.test.ts`; HowItWorks is not tested
  against it.
- `TRIAL_DURATION_DAYS = 14` (`src/lib/billing/trial.ts:23`).
- In the widget:
  - The scan selector (`recopyfast.src.js:2595-2596`).
  - The Edit Board tabs Elements, Languages and History (`:5778-5782`), with the Languages tab at
    `:5966-6080` and the History tab at `:6090-6200`.
  - The image modal (`:4714-4760`) and the upload (`:2831`).
  - The AI goals (`:5261-5268`).
- `restore_content_version` RPC (`src/app/api/edit-board/history/[versionId]/route.ts:290`); the
  dashboard's `VersionHistoryPanel` restores through the same route.
- `site_permissions` levels view, edit, publish and admin (`InviteEditorForm.tsx:40-43`), and
  revocation through `/api/editor/editors` (`SiteEditorsCard.tsx:332-353`).

## Traps & constraints

- **Tests that pin today's copy.**
  - `trial-claims.test.tsx:56-66` asserts all four Pricing trust points, guarantee included, at
    :63-65.
  - `e2e/landing.spec.ts:183-204` (E2E-017) asserts the same four in `#pricing`, the guarantee at
    :203.
  - Nothing pins Benefits, HowItWorks, Footer, metadata or the demo image modal.
  - `comparison-discovery.test.tsx:18-24` checks only the footer's "Compare tools" link.
  - `BillingDashboard.plan-card.test.tsx:58` uses a mock catalogue, so the migration does not
    touch it.
  - The E2E pricing checks assert only names and prices (`landing.spec.ts:56-80`), so they are
    unaffected by the catalogue copy.
- **Coordinating with s47b.** s47b's brief (`docs/designs/s47-founding-20-offer-brief.md` §1c)
  swaps only the first trust item in Pricing and FinalCTA. It also says the other items, including
  "30-day money-back guarantee", are "unchanged"; that sentence is stale once s50 lands. To keep
  s47b's rebase trivial:
  1. Ship s50 first.
  2. In `Pricing.tsx`, delete only line 73. Leave items 1-3, the render block at :397-412 and the
     comment structure as they are.
  3. Do not touch `Hero.tsx` at all (H3 and H5 are true), and do not touch `FinalCTA.tsx:90-116`.
  4. In the two existing test blocks, only delete lines (`trial-claims.test.tsx:63-65`,
     `landing.spec.ts:203`). Put every new assertion in new code: the new unit file, and E2E-018 or
     a new E2E-019 below it. The one-line deletions are next to s47b's edits (`:196-202`), so git
     may still flag a conflict. Resolving it means taking s47b's block without the guarantee line.
  5. Also have s47b's design and plan drop the guarantee from the §1c table.
- **Design-system violations in these sections.**
  - The Founding Agency card uses `bg-gradient-to-br from-teal-50 to-sky-50` and
    `shadow-xl shadow-teal-500/10` (`Pricing.tsx:332`).
  - The FinalCTA trust dots are `bg-emerald-500` (`FinalCTA.tsx:105`, `:109`, `:113`).

  Neither is a truth problem. Recommendation: **leave both out of s50.** The FinalCTA dots sit
  inside the row s47b redraws, and the brief already assigns them `teal-600` in that redraw
  (gap 5). Changing them in s50 would create the conflict above. The Founding Agency card is the
  precedent s47b builds its flat offer card beside, so cleaning both in one review keeps them
  consistent. If the owner prefers, the card fix is a single className at :332, far from line 73
  and from s47b's insertion point, and could ride along in s50 without conflict (Q9).
- **Comments that would become false.** Four comments assert things this story disproves and need
  tombstones in the house style (AGENTS.md § Comments): `Benefits.tsx:16-25`,
  `HowItWorks.tsx:15-18`, `EditableImage.tsx:58-60`, and `Pricing.tsx:63-68` (which should record
  why the guarantee went).
- **The migration.**
  - Migrations are forward-only (Non-negotiable 5). CI replays every migration against Postgres 14
    (`.github/workflows/ci.yml:18-20`), so the `UPDATE` must be idempotent and must not assume
    rows exist beyond what the seeds create.
  - Never set `is_active = FALSE` on a plan row. That lesson is recorded in
    `20260926120000_lifetime_agency_monthly_credits.sql:31-34`.
  - `/api/pricing` caches for 5 minutes, so production shows the new copy up to 5 minutes after the
    migration is applied.
  - Until the operator runs `sync:stripe:live`, Stripe Checkout shows the old descriptions, and
    `check:stripe:live` reports the drift. That step is a production action, which s50 forbids
    itself: it belongs in the ship runbook.
  - The same catalogue feeds the in-app billing screens (`UpgradeDialog`, `BillingDashboard`), so
    they change with the migration. That is intended.
- **No `/ks-design` needed if Q4 keeps the layout.** Refilling the two headline cards in the same
  grid is a copy change. Deleting the grid would be a layout change on the marketing surface and
  would need a design pass.
- **Embed: 0 bytes.** Nothing here touches `public/embed/`. The widget's Languages tab is itself
  a half-surface for a feature this story stops advertising. Leave it alone; it is out of scope.
- **Out of the homepage, same problems. Do not fix them in s50; note them for a follow-up.**
  - `/privacy` claims audit logs (`privacy/page.tsx:165`, `:311`, the latter with "SIEM
    integration") and RBAC (`:297`).
  - `/terms` claims audit logs (`terms/page.tsx:177`, `:365`), role-based access controls (`:234`)
    and in-app notifications (`:388`), which is the notification centre graveyard item.
  - Both pages list addresses on the dead `recopyfast.com` domain: `privacy@`, `security@`,
    `eu-representative@` and `support@` (`privacy/page.tsx:364-527`), and `security@`, `legal@`,
    `privacy@` and `support@` (`terms/page.tsx:421-502`). Anyone who registers `recopyfast.com`
    would receive security and privacy reports.
  - The blog says "any site" and "any website" (`blog/page.tsx:71`, `blog/[slug]/page.tsx:112`).

  Legal copy needs owner review.

## Open questions

These are for the owner, to settle at planning.

1. **Catalogue copy in s50?** C1, C3-C6, C9 and C12 live in `plans`. Including them means a
   migration plus a post-deploy `sync:stripe:live`. Leaving them out means the homepage pricing
   cards keep advertising A/B and translation, which fails AC 3. **Recommendation: include them.**
2. **Support promises (C4, C6).** "Community support", "Priority support", "Priority support +
   onboarding call" and "Agency support" have no channel behind them today. Keep each only as a
   promise the owner will honour by hand, through a mailbox that works. Otherwise remove it or
   replace it with, for example, "Email support".
3. **Contact mailbox (T5).** Which `@recopyfa.st` address? Separately: register or park
   `recopyfast.com`, since six addresses across the footer and legal pages point at it.
4. **Replacements for the two headline cards (B2, B3).** Proposal, both claims already verified by
   the kit:
   - eyebrow "Invite", title "Hand a client the words, not the site", text "Invite someone by
     email. They sign in with a one-time code, no account and no password, and change the words
     on the page, never the layout or the code. Untick Publish and their edits wait as drafts for
     you."
   - eyebrow "Rewrite", title "AI rewrites, in place", text "Select any text and ask for a
     clearer, shorter, more professional or more casual version. Keep it, edit it, or keep yours."

   B7 and B5 then move up out of the supporting list, so that list drops to four items or takes
   B9's "Save and restore".
5. **The five-minute claim (W1).** Time a real install and keep it, or drop the number.
6. **SEO title (M1).** The proposed title replaces "Universal CMS Layer". The owner may want
   different wording for the search-results title.
7. **"Includes all future Pro features" (C13).** Keep it only as a commitment.
8. **"Role-based permissions" (B6).** The AC lists it as graveyard. The research recommends
   rewording rather than deleting the capability, because per-editor View, Edit, Publish and Admin
   levels on a site are shipped and are the truthful version of the claim.
9. **Design-system fixes.** Recommended out, with the FinalCTA dots going to s47b. Optionally,
   the Founding Agency card's single className at `Pricing.tsx:332` could ride along in s50.
10. **Follow-up story** for the `/terms`, `/privacy` and blog claims listed under Traps.

## Real complexity

The story scores this 2. **After research: 3 with the catalogue migration, 2 without it.** The
story assumed component copy only. The migration adds three things: a forward SQL change that CI
replays; a Stripe description sync, which is an operator step after deploy; and reasoning about
the 5-minute pricing cache. The Benefits section also loses both of its anchor cards, so the
content decision in Q4 comes before any code.

Estimated at **9 tasks**, test-first where there is an assertion to write:

1. Absence tests first: the new `homepage-truth.test.tsx` and additions to E2E-018 or a new
   E2E-019 (red).
2. `Pricing.tsx`: remove the guarantee and add its tombstone; delete the guarantee lines in
   `trial-claims.test.tsx:63-65` and `landing.spec.ts:203`.
3. `Benefits.tsx`: headline cards per Q4, supporting items B6-B12, header, tombstone.
4. `ValueProposition.tsx` (V1) and `HowItWorks.tsx` (W4, plus W1 per Q5, and `FinalCTA.tsx:31` if
   reworded).
5. `EditableImage.tsx`: remove AI image generation (D4).
6. `Footer.tsx`: T1, T3, T4, T5, T7, T8.
7. Metadata: `layout.tsx`, `opengraph-image.tsx`, `manifest.ts` (M1-M3).
8. Catalogue migration, with an operator note for `check:stripe:live` and `sync:stripe:live`.
9. Gates (`precommit`, `prepush`, `test:e2e`) and the per-claim evidence table for the review,
   which is this inventory with the actions applied.

## Split proposal

Not required (the verdict is 3, not 5). One cut is possible if the owner wants s50 to stay at 2:

- **s50** covers components, metadata and tests (tasks 1-7 and 9). It closes P4, D4, V1, W4, B*,
  T* and M*.
- **s50b-catalogue-truth** (complexity 2) covers the migration, the Stripe sync runbook and the
  review evidence for C1-C13.

The catch: s50 alone does not satisfy AC 3, because the pricing cards on the homepage would
still say "AI A/B copy testing" and "unlimited translations, A/B testing". **Recommendation: one
story at 3.**
