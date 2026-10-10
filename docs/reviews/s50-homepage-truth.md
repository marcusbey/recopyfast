# Review — Story s50-homepage-truth

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff main...feature/s50-homepage-truth`, one commit `1ac684c`
> ("fix: every homepage claim is one the product backs"), rebased on `main` `4ec7799` (includes s48).
> Judged against `docs/plans/s50-homepage-truth.md`, `docs/research/s50-homepage-truth.md`,
> `AGENTS.md`, the accepted ADRs in `docs/decisions/` and `docs/design-system.md`.
> Everything below ran in `.omx/worktrees/s50-homepage-truth` with the CI placeholder env.

## Plan compliance

- [x] The code does what the plan specifies, nothing more — with one wording defect the plan itself
  introduced (Findings 1).
  - **T1** `src/__tests__/marketing/retired-promises.test.ts`: the five phrases, the AST scanner
    (StringLiteral, NoSubstitutionTemplateLiteral, TemplateHead/Middle/Tail, JsxText; comments
    never read), scan roots `src/app` minus `src/app/api`, `src/components`, `src/lib/compare`,
    `__tests__` and `*.test|spec.*` skipped, and the two catalogue tests. E2E-018 extended with the
    Starter-card wait, the 18-phrase `retired` loop, `page.content()` and `page.title()` checks. No
    new Playwright test. Done as written.
  - **T2** `catalogue-copy-truth.test.ts` (6 tests) and
    `supabase/migrations/20260928130000_catalogue_copy_truth.sql`: five `UPDATE`s, values identical
    to the plan table (em dash U+2014 checked), `updated_at = NOW()` on each, header in house style
    with research IDs, `limits` note, KEEP ACTIVE, Stripe runbook, 5-minute cache, idempotence.
  - **T3** `Pricing.tsx`: line 73 deleted, tombstone below `];`. `trial-claims.test.tsx:63-65` and
    `landing.spec.ts:203` deleted, nothing else.
  - **T4** `Benefits.tsx`: h2, paragraph, both headline cards, six supporting items, icons
    (`Users2`, `Languages`, `FlaskConical` out; `UserPlus`, `ImagePlus`, `Upload` in), tombstone,
    item-1 comment kept, grid markup and classNames byte-identical. All strings match the plan.
  - **T5** ValueProposition `:108`, HowItWorks template hosts, `:103`, `:224`, both comments,
    FinalCTA badge. All strings match.
  - **T6** `EditableImage.tsx`: prompt state, `requestAiImage`, label/textarea, the button and the
    `Sparkles` import removed; tombstone; "Use the next photo" keeps its secondary style.
  - **T7** `Footer.tsx`: description, `quickFeatures`, `BookOpen` import, `mailto`, bottom-bar right
    block, tombstone. All as planned.
  - **T8** `/terms` and `/privacy`: every `href` and link text as mapped; the status-page `<li>`
    deleted; no other text changed.
  - **T9** `layout.tsx` constants and "headless CMS" keyword, `manifest.ts`, `opengraph-image.tsx`
    alt and drawn text; `twitter-image.tsx` untouched.
  - **T10** one commit, stories ticked (AC 1-7; AC 8 left open, declared), execution log with the
    30-row claim table and the new-claims table. Line references in the log spot-checked: correct.
  - Declared deviations, accepted: FinalCTA diff is `:30-32` (Prettier fold of the shorter span);
    T2's DB replay and the local `landing.spec.ts` run were pending — **this review ran both**
    (Tests, below).
- [x] Run interdicts respected — each one checked:
  - `public/embed/**`: empty diff (also unchanged after `npm run build`'s prebuild).
  - `src/components/sections/Hero.tsx`: empty diff.
  - `FinalCTA.tsx`: badge only (`:30-32`); `:90-116` untouched.
  - `Pricing.tsx`: deletion of the guarantee line plus the comment below the array; `:63-72`, the
    Founding Agency card and the render block untouched.
  - `trial-claims.test.tsx` and E2E-017: deletions only.
  - `playwright.config.ts`, `.github/workflows/ci.yml`,
    `src/__tests__/e2e/playwright-ci-contract.test.ts`: empty diffs; `playwright test --list` = 44.
  - `git diff main -- supabase/`: exactly one new file; no applied migration edited; `free` and
    `lifetime_agency` never named (and proven byte-identical after replay).
  - `AGENTS.md`, `docs/architecture.md`, `docs/decisions/`: empty diffs.
  - Out-of-scope items (Resolved 13, `public/demo-site/`, the widget Languages tab, fixture mocks,
    design-system classNames): untouched.

## Anti-hallucination

- [x] No invented API/function/import — each one opened:
  - `lucide-react` 0.539.0 exports `UserPlus`, `ImagePlus`, `Upload`, `Wand2`, `Globe2`, `History`,
    `Shield`, `MousePointerClick`, `Shuffle`, `X`, `Rocket`, `Zap`, `Github`, `Mail` (checked at
    runtime).
  - `buildEmbedScript({ siteId, siteToken, appUrl?, wsUrl? })` and
    `canonicalizePublicAppUrl(origin)` exist with those signatures (`src/lib/sites/embed-script.ts:26-39, :92-107`);
    `wsUrl: ""` omits the attribute as the test assumes.
  - `Header` is a named export (`Header.tsx:14`), `Footer` a default export (`Footer.tsx:62`) —
    the `legal-contacts` mocks match both pages' imports.
  - `metadata` (`layout.tsx:50`), `alt` and the default `OpenGraphImage` (`opengraph-image.tsx`),
    `manifest()` exist; `metadata.openGraph.title/description` and `twitter.*` use the constants.
  - `typescript` compiler API used by the scanner (`createSourceFile`, `ScriptKind`, `isJsxText`,
    `isTemplateHead/Middle/Tail`, `forEachChild`) is real and exercised by the scanner test.
  - `public.plans` has `updated_at` (and trigger `update_plans_updated_at`); every column the
    migration writes exists.
  - `scripts/sync-stripe-catalogue.mjs:698-699` projects `description` only — the migration
    header's "four product descriptions change" is right (Pro's description is not written).
- [ ] No plausible-but-wrong value or logic — **one**: the Invite card's "Publish stays off unless
  you grant it" (Findings 1). The research's fact (`InviteEditorForm.tsx:46`, default View + Edit)
  is true for that component, but the dashboard's first-run "Invite a client" dialog overrides it
  with Publish pre-selected. Everything else checked against source, the local database or DNS
  (claim table below).
- [x] The code matches what it claims to do — tombstones checked against the facts they cite:
  `/terms` has no refund clause (grep), `package.json` is `0.1.0`, no `/docs` or `/status` route in
  `src/app`, `vercel.json` schedules only `generate-blog-post` and `webhook-dispatch`, `_ab-tests`
  is a private folder, `TranslationDashboard` is imported by tests only, the content route defaults
  to `en` (`route.ts:369`), `recopyfast.com` has no A or MX record, `recopyfa.st` MX is
  `mail.recopyfa.st`, `NEXT_PUBLIC_WS_URL` is documented Production-only (`server/README.md:263`).

## Rules compliance

- [x] Repo conventions followed (AGENTS.md): forward-only timestamped migration (Non-negotiable 5);
  tombstones in the house style (§ Comments); one story commit, conventional message; story docs
  (research, plan) travel in the story commit; `docs/stories.md` ticked in the story commit as s48
  and s45 did.
- [x] No accepted ADR contradicted. Checked the ones the diff leans on: ADR 004 / 022 / 026
  (realtime is editors-only; the template omits `data-ws-url` and no step promises realtime to
  visitors), ADR 008 (restore writes to staging — see Findings 2, wording only), ADR 020 (the SEO
  cluster pages that reuse `sections/*` get the same copy — intended), ADR 027 (per-site tokens),
  ADR 035 / 040 (AI charged to the owner, credits in the database — untouched).
- [x] Design system respected. No `docs/designs/s50-*` exists and none is needed: copy changes
  inside existing layouts. No new component, token, colour or className. Removals only: the footer's
  right-hand block (which carried a `bg-emerald-500` pulse dot, itself a design-system violation),
  the demo modal's primary button, one `/terms` bullet. Benefits grids keep 2 + 6 items, markup
  unchanged. Icons come from the existing Lucide set (`Upload` is the icon the invite form already
  uses for Publish). The Founding Agency gradient and FinalCTA emerald dots are left to s47b, as
  planned.

## Tests

- [x] Test suite run by the reviewer, passing.
  - Full Jest, live local database (default stack, `54322`): **285 suites passed, 2 skipped;
    3,656 tests passed, 39 skipped, 0 failed.** DB suites ran live, not `[gated]`: 10 suites / 91
    tests (credit-spend 27, founding-agency-cap 23, column-privileges 14, sites-install-status 7,
    site-delete-cascade 5, content-version-i18n 4, function-grants 3, rls-policies 3,
    content-version-concurrency 2, restore-reports-rows 2). Two are skipped by design and are
    unrelated to s50: `content-attributes-lifecycle` (needs an explicit scratch `RCF_TEST_DB_URL`)
    and `editor-activation-concurrency` (needs `RCF_S29_DB_URL`).
  - `npm run lint`: 0 errors, 38 warnings (4 in touched files, all pre-existing: unused icon
    imports in `terms`/`privacy`, the `<img>` in `EditableImage`). `type-check`, `format:check`,
    `type-check:build`, `build`: green. `playwright test --list`: 44.
  - **Migration `20260928130000` replayed twice inside `BEGIN … ROLLBACK`** on the local stack,
    rows read back:
    - Before: starter "1 website, instant copy testing, basic features" / "Instant copy testing",
      "Basic version history", "Community support"; pro "Instant copy testing", "Full version
      history", "Priority support", "AI A/B copy testing"; agency "…Agency support" / "Priority
      support + onboarding call"; credits "…suggestions, translations and A/B copy generation";
      lifetime_pro "…unlimited translations, A/B testing…" / "Includes all future Pro features".
    - After two applies: exactly the plan's table (starter, pro, agency, credits, lifetime_pro).
    - Second apply vs first: 0 rows differ in `description`/`features` (idempotent).
    - Every column other than `description`, `features`, `updated_at` — `price_monthly`,
      `price_yearly_*`, `limits`, `additional_site_price`, `stripe_*`, `grants_plan_id`,
      `is_active`, `sort_order`, `name`, `kind` — identical to before for all 7 rows (0 rows
      differ). Row count 7 → 7.
    - Changed rows: exactly starter, pro, agency, credits, lifetime_pro. `free` and
      `lifetime_agency` byte-identical (whole row compared).
    - No row matches `money-back|priority support|onboarding call|future pro features|a/b|translation|copy testing|community support|full version history|basic version history` afterwards.
    - After `ROLLBACK` the old copy was back.
  - **`e2e/landing.spec.ts` locally** (dev server from this worktree, local stack, CI-shaped env):
    - Before applying the migration (old catalogue rows): **E2E-018 red** on
      `not.toContain("Priority support")` — the catalogue half of the guard bites through the real
      `/api/pricing` → cards path.
    - After applying the migration: **9/9 green** with `--workers=1` (CI's setting).
    - With default parallel workers, E2E-013 and E2E-014 (the price toggles) time out at 90 s — in
      the run before the migration too. They assert prices s50 does not touch; this is local dev-server
      load, not the diff (see Not verified).
- [x] Assertions pin the acceptance criteria. Every new test asserts the new copy present *and* the
  retired copy absent, so a blank render cannot pass; the scanner test proves its own reach (>100
  files, "Privacy Policy" read from `Footer.tsx`). No `.skip`, `.only` or assertion-free test in the
  diff.
- [x] Bite proven by neutralization — each mutation applied alone, the named suites run, then
  restored with `git checkout` and `git diff --exit-code` clean (Pricing sha256 back to
  `b7f5a0e1…04eb88`):

  | # | Mutation | Red |
  |---|---|---|
  | M1 | `"30-day money-back guarantee"` back in `Pricing.tsx` TRUST_POINTS | Jest **2**: `retired-promises` "no public page says money-back", `homepage-truth` "Pricing › makes no money-back promise"; Playwright **E2E-018** red on "money-back" |
  | M2 | Footer `mailto:` back to the dead domain | **2**: "no public page says recopyfast.com", "Footer › sends email to support@recopyfa.st" |
  | M3 | `/privacy` Security Team → a third address on the right domain | **2**: `legal-contacts` "every address on /privacy…", "routes customer support to support@…" |
  | M4 | "Priority support" in place of "Email support" in the migration's `pro` row | **4**: "says Email support…", "sets each row's copy exactly", "20260928130000 rewrites…", "survive only in the applied seeds" |
  | M5 | scratch later migration `20260929000000_x.sql` writing "Priority support" into `pro` | **1**: "survive only in the applied seeds" (file deleted) |
  | M5b | same scratch migration writing "AI A/B copy testing", "Full version history" | **0** of 15 — see Findings 5 (file deleted) |
  | M6 | Benefits Shield line back to "…and an audit log of every edit." | **1**: "Benefits › lists only shipped capabilities" |
  | M7 | a "Generate with AI" button back in the demo modal | **1**: "offers replacement only, with no AI image generation" |
  | M8 | `SITE_TITLE` back to "Universal CMS Layer" | **1**: "titles the site by what it does" |
  | M9 | control: `// Priority support, money-back, hello@recopyfast.com` comment in `Footer.tsx` | **0** (9/9 green) — comments are ignored, as required |
  | M10 | apex host back in the HowItWorks template | **1**: "HowItWorks › shows the tag the dashboard issues for production" |

## Regressions

- [x] No impact on existing code paths.
  - `Footer` renders on every marketing page: `comparison-discovery` ("Compare tools") and all
    page suites green; only the right-hand block of the bottom bar is gone.
  - `EditableImage` is used by `InteractiveHero` on `/` and `/demo`: its suites green; the shuffle
    path is pinned by the new "swaps to the next photo in the pool".
  - The catalogue copy also feeds `BillingDashboard` and `UpgradeDialog`; their tests use mock
    catalogues, and the new copy there is intended. Checkout and grants read ids, prices and
    `grants_plan_id`, which the replay proves unchanged.
  - Stripe product descriptions drift from the database until the operator syncs — expected and in
    the migration header.
  - Rebase onto `4ec7799`: s48's `20260928110000` sorts before `130000` and touches no `plans` row;
    the last-writer test still holds.

## Claim table — evidence per claim (AC 3)

Research rows marked FALSE, GRAVEYARD or UNVERIFIABLE (30). "Reviewer check" is what this review
itself ran or read.

| ID | Verdict | Now | Reviewer check |
|---|---|---|---|
| D4 | FALSE | AI image generation removed (`EditableImage.tsx:49` tombstone) | M7 red; widget modal takes URL (`recopyfast.src.js:4741-4760`) or upload (`:2820-2831`) only |
| V1 | FALSE | "every price change" (`ValueProposition.tsx:108`) | `homepage-truth`; E2E-018 "A/B" green on the served page |
| W4 | FALSE | `https://www.recopyfa.st` hosts (`HowItWorks.tsx:38-41`) | M10 red; equals `buildEmbedScript` output |
| B1 | FALSE | "Changing the words should be the easy part" + new paragraph (`Benefits.tsx:115-119`) | `homepage-truth` absence of "Knowing which words to use" |
| B2 | FALSE | Translate card replaced by Invite (`Benefits.tsx:31-37`) | `homepage-truth`; E2E-018 — but see Findings 1 on the new text |
| B3 | FALSE | Test card replaced by Rewrite (`Benefits.tsx:38-44`) | `homepage-truth`; E2E-018 |
| B8 | FALSE | "One script tag" + CSP caveat (`:72-75`) | `homepage-truth`; E2E-018 "Works everywhere" |
| B9 | FALSE | "Save and restore" (`:78-81`) | widget "Save Current Version" / Restore read (`:6159-6215`); Findings 2 |
| P4 | FALSE | removed, tombstone (`Pricing.tsx:74-77`) | M1 red (Jest 2 + E2E-018) |
| C3 | FALSE | "Version snapshots and restore" (starter, pro) | replay read-back; `catalogue-copy-truth` |
| C4 | FALSE | "Email support" (starter) | replay; M4 red |
| C5 | FALSE | "AI rewrite suggestions, 500 credits a month" (pro) | replay; pro `limits.monthly_credits = 500` read from the local DB |
| C9 | FALSE | "1,000 AI credits for AI rewrite suggestions" | replay; Stripe text pending operator sync |
| C12 | FALSE | "…5 websites and AI features. No recurring billing." | replay; em dash preserved; Stripe pending |
| T1 | FALSE | "Make the copy on the site you already built editable…" (`Footer.tsx:87-88`) | `homepage-truth` |
| T3 | FALSE | "Secure by default" (`Footer.tsx:59`) | `homepage-truth` |
| T4 | FALSE | "Comprehensive docs" removed | `homepage-truth`; no docs route in `src/app` |
| T5 | FALSE | `mailto:support@recopyfa.st` (`Footer.tsx:52`) | M2 red; `recopyfast.com` has no A/MX; E2E `page.content()` check green |
| T7 | FALSE | status line removed | `homepage-truth`; E2E-018 |
| T8 | FALSE | "v1.0.0" removed | `homepage-truth`; `package.json` 0.1.0 |
| M1 | FALSE | "ReCopyFast - Edit your website copy in place" | M8 red; E2E `page.title()` green |
| M2 | FALSE | "Make the copy on the site you already built editable, with one script tag." | `site-metadata` |
| M3 | FALSE | same line on the OG card, alt and drawn text | `site-metadata` renders the element (satori mocked) |
| B6 | GRAVEYARD | "Role-based permissions" not advertised | `homepage-truth`; E2E-018 |
| B12 | GRAVEYARD | audit-log claim removed (`Benefits.tsx:84-87`) | M6 red |
| W1 | UNVERIFIABLE | "A few minutes." / "Set up in minutes" ×2 | `homepage-truth`; E2E-018 "five minutes" / "5 minutes" |
| C1 | UNVERIFIABLE | "1 website, click-to-edit, draft and publish"; "Draft, then publish" | replay |
| C6 | UNVERIFIABLE | "Email support" on starter, pro, agency; agency "…email support" | replay; **true only once the mailbox exists** (operator) |
| C10 | UNVERIFIABLE | kept, "Works on any plan" | true: credits cover AI on any plan (`permissions.ts:374-420`); s51 makes purchase need a plan. The plan's "once s49 ships" is stale (Findings 3) |
| C13 | UNVERIFIABLE | "Includes all future Pro features" removed | replay; `catalogue-copy-truth` |

Claims s50 introduces:

| Claim | Reviewer verdict | Evidence |
|---|---|---|
| Invite: "Invite someone by email. They sign in with a one-time code, no account and no password" | TRUE | `/api/editor/request-code` (allowlist + emailed code), `SiteEditorsCard.tsx:384` |
| Invite: "Publish stays off unless you grant it, so their edits wait as drafts for you." | **MISLEADING** | Findings 1 — `ActivationChecklist.tsx:349` pre-selects Publish |
| Rewrite: "clearer, shorter, more professional or more casual version" | TRUE | widget goals `improve`, `shorten`, `professional`, `casual` (`recopyfast.src.js:5261-5268`) → `/api/ai/suggest` |
| "Swap images too" — link or upload | TRUE | `:4741-4760` URL input; `uploadImage` → `POST /api/upload/image` (`:2820-2831`) |
| "Draft, then publish" — visitors only see published copy | TRUE | content route serves `published_content ?? original_content` and strips `staging_attributes` (`route.ts:416-436`) |
| "Save and restore … in one click" | TRUE, narrow | one click restores into the draft; live after Publish (ADR 008 `:40-43`). Findings 2 |
| "Per-site tokens, per-site API keys, and per-editor permissions" | TRUE | ADR 027; `ApiKeysPanel`; `site_permissions` view/edit/publish/admin |
| "One script tag … CSP has to allow our script" | TRUE | `buildEmbedScript` emits one element; the platform list is inherited, not tested per platform |
| "Email support" (plans) | TRUE only after operator step | both mailboxes currently bounce |
| "AI rewrite suggestions, 500 credits a month" | TRUE | pro `monthly_credits: 500` |
| "Set up in minutes" / "A few minutes." | acceptable | no number claimed |
| Metadata / footer line | TRUE | B8 wording; "No backend changes, no migration" = W2/W3 |

## Findings

1. **major** — `src/components/sections/Benefits.tsx:36` (Invite card) and its tombstone at `:24-26`
   — "Publish stays off unless you grant it, so their edits wait as drafts for you" is not true on
   the product's main invite path. `ActivationChecklist.tsx:349` passes
   `inviteDefaultPermissions={["view", "edit", "publish"]}`, and its dialog says "Add the person who
   will edit and publish {siteName}" (`:341-342`). That checklist renders on `/dashboard`
   (`src/app/dashboard/page.tsx:204`) and on the site detail view (`SiteDetailView.tsx:305`). Only
   the plain editors card falls back to View + Edit (`InviteEditorForm.tsx:46`). An owner who follows
   the product's own first-run flow gets a client who publishes directly, while the homepage promised
   drafts. Plan Resolved Q4 replaced the research's accurate "Untick Publish and their edits wait as
   drafts for you" on the strength of `InviteEditorForm.tsx:46` alone. The tombstone repeats the
   same wrong premise ("whose permissions default to View and Edit"). In a story whose purpose is
   that every claim is demonstrable, this new headline claim should be fixed before merge. It is a
   one-string fix: go back to the research's wording, or use something like "Leave Publish unticked
   and their edits wait as drafts for you", and correct the comment.
   No test pins the description, so no test changes.
2. **minor** — `Benefits.tsx:81` "…and restore it in one click": the restore writes the snapshot to
   staging (`api/edit-board/history/[versionId]/route.ts:4`, ADR 008 `:40-43`). Visitors see it only
   after a Publish. The "Draft, then publish" card beside it makes this coherent, but "one click"
   can be read as live. Optional: "restore it as a draft in one click".
3. **minor** — `docs/plans/s50-homepage-truth.md` Resolved 11, DoD Risks and the claim-table row
   C10 justify keeping "Works on any plan" as "true once s49 ships". s49 is SUPERSEDED by s51
   (`docs/stories.md:1858`, on `4ec7799`, which this branch is rebased on). The conclusion still
   holds: `canUseAIFeatures` lets a credit balance cover AI on any plan (`permissions.ts:374-420`),
   and s51 makes buying credits need a plan. Only the stated reason is stale.
4. **minor** — `docs/stories.md` s50 AC 2 ("graveyard features … are not advertised") is ticked,
   but `/privacy` (`:165`, `:297`, `:311`) and `/terms` (`:177`, `:234`, `:361`) still claim audit
   logs, RBAC and SIEM integration, on pages this story edited. `/privacy` also still lists an
   "EU Representative", which now points at the company's own `privacy@` mailbox. Plan Resolved 13
   defers these to owner and legal review, which is legitimate. But `docs/stories.md` has no
   follow-up story for them yet, so the deferral lives only in this plan. Add the story.
5. **minor** — `retired-promises.test.ts` and `catalogue-copy-truth.test.ts`: the Jest last-writer
   guard covers only the five owner phrases. A later migration that writes "AI A/B copy testing" or
   "Full version history" back into `pro.features` passes all 15 catalogue tests (reviewer mutation
   M5b). Only E2E-018 in PR CI, with every migration replayed, would catch it. This follows the plan's
   design and is noted so nobody reads the Jest guard as covering the whole catalogue.
6. **minor** — `catalogue-copy-truth.test.ts` "never touches price, limits, grant…": the regex
   omits `additional_site_price`, a price column. The live replay proved it unchanged; the static
   guard would not notice a future edit.

## Not verified

- **Mailboxes (operator, before public launch).** `support@recopyfa.st` and `privacy@recopyfa.st`
  currently bounce. The owner must create both at the registrar and send each a test mail. Until
  then "Email support" on every plan, the footer link and every contact on `/terms` and `/privacy`
  are false.
- **Stripe (operator, after the migration reaches production).** Not run, by interdict: `npm run
  check:stripe:live` (expect description drift on starter, agency, credits, lifetime_pro), then
  `npm run sync:stripe:live`. Stripe Checkout shows "translations" and "A/B" until then.
- **Production.** Nothing deployed or pushed. The homepage was rendered only locally, by Playwright
  against a dev server and the local database. After deploy: wait 5 minutes for the `/api/pricing`
  cache, then read the pricing cards, the footer `mailto`, `/terms`, `/privacy` and the tab title.
- **Visual layout.** No human looked at the screens and no Playwright screenshot was reviewed. Open
  `/` at desktop and mobile widths and check: the Benefits headline cards with the longer Invite
  text at the `md` two-column breakpoint; the footer bottom bar with only its left block; the
  `/demo` photo modal with one secondary button ("Replace image", then "Use the next photo").
- **Social card.** `ImageResponse` was mocked, and satori never rendered the new line. Open
  `/opengraph-image` and `/twitter-image` locally or after deploy, and check that the longer line
  wraps inside the card. Then run a link-preview debugger on the production URL.
- **Product behaviour behind the new claims** was verified by reading code, not by clicking. On a
  real site opened from the dashboard: replace an image by URL and by upload; run an AI rewrite
  with "Make more professional"; save a version, change copy, restore, and confirm visitors see
  the restored copy only after Publish. On `/dashboard`, click "Invite a client" and see Publish
  pre-selected (Findings 1).
- **Platform list** ("React, Vue, WordPress, Webflow or plain HTML"): inherited from the research,
  not installed on each platform here.
- **Local Playwright parallelism.** With default workers, E2E-013 and E2E-014 time out locally,
  before and after the migration. Not compared against `main`. CI runs one worker, and with
  `--workers=1` all 9 pass.
- **Gated DB suites.** `content-attributes-lifecycle` and `editor-activation-concurrency` need
  scratch database URLs and did not run. Neither touches s50's paths.
- **Legal.** Whether routing security, DPO and EU-representative mail to `privacy@` meets the
  owner's legal obligations (for example, a GDPR Art. 27 representative is a separate entity). This
  is an owner and legal decision (Resolved 13).
- **Local side effects of this review, all local.**
  - The default stack's restored volume lacked s48's `20260928110000`, which is merged on `main`
    and needed by `credit-spend.test.ts`. It was applied with `psql` and recorded in
    `supabase_migrations.schema_migrations`.
  - s50's `130000` was applied for the E2E run. The five rows' `description` and `features` were
    then restored. Their `updated_at` now differs, because the table's trigger rewrites it.
  - The volume already carried s47a's `20260928120000`, which is not on this branch.
  - `next dev` rewrote `AGENTS.md` while running, and the change was reverted.
  - Stack stopped, dev server stopped, worktree clean (`git status` empty). The s47a and s51 stacks
    and colima were left running.

## Verdict

Critical 0 · major 1 · minor 5. The diff does what the plan says. The migration is idempotent and
copy-only, which was shown against a real database. Every retired claim is gone and pinned by a
test that bites. The one major finding is a new claim this story introduces, and it should be
reworded before merge.


## Product owner disposition (orchestrator, 2026-09-28)

- **Major 1 fixed at `feccbf8`** (fix run, test-first): the Invite card now reads "…You choose,
  per editor, who can publish." — true on every invite path; dialog defaults unchanged.
- **Minor 2 accepted:** "restore it in one click" sits beside "Draft, then publish"; wording
  follow-up only if support sees confusion.
- **Minor 3 accepted:** conclusion holds (credits cover AI on any plan); stale reason noted.
- **Minor 4 → story `s54-legal-pages-truth`:** /privacy and /terms still claim audit logs, RBAC,
  SIEM and an EU Representative. Launch-relevant; done before public launch posts.
- **Minors 5 and 6 → test hardening follow-up** (guard every retired catalogue phrase, add
  `additional_site_price` to the static price guard), queued with s53 hardening.

Max severity: major
Ship allowed: yes
