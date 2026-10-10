# Review — Story s54-legal-pages-truth

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff main...feature/s54-legal-pages-truth` (one commit, `4b79791`, branched
> from `7c21d00`). `git merge-tree --write-tree main feature/s54-legal-pages-truth` is clean;
> `main` has since gained `3235618`, `50f0a3c` (s47a) and `b05666d`, none of which touches either
> page, either test or `retired-promises.test.ts` (only `docs/stories.md` overlaps, merging cleanly).
>
> Environment: worktree `.omx/worktrees/s54-legal-pages-truth`, scratchpad `ci-env.sh` sourced,
> `RCF_TEST_SUPABASE_CONFIG` on the dead config. No database, no browser, no production call.
> Email addresses are named by role below: "the privacy mailbox", "the support mailbox".

## Plan compliance
- [x] The code does what the plan specifies, nothing more. Every action in the research's
      inventory was checked against the diff, row by row:
  - /privacy: P1, P2, P4, P5, P7, P9, P12, P14, P15 (heading), P16-P42, P46, P48, P49, P51-P57,
    P59 all applied. Every added rendered line is verbatim from the research's Action column. The
    TRUE rows and the hero copy are untouched.
  - /terms: T1, T3 (card and `sm:grid-cols-2`), T5, T6+T7, T8, T10-T15, T17-T19, T22-T28
    (9.2 deleted, §9 retitled), T30, T34, T35 and T38 all applied, verbatim. T20, T29, T32, T33
    and T36 are kept as the plan decides.
  - The three JSX tombstones (P9, P28, P32) and both header tombstones are present. Imports
    removed: `Globe` and `FileText` (privacy), `Clock`, `AlertTriangle` and `Users` (terms).
    No import added.
  - `legal-contacts.test.tsx`: the two label arrays and one comment line. Every address assertion
    is unchanged.
  - `docs/stories.md`: only the four s54 ticks. Plan tasks 1-4 are ticked, and the execution log
    is appended.
- [x] Run interdicts respected. Each was checked:
  - `git diff --stat main...feature/s54-legal-pages-truth`: exactly the 7 permitted files.
  - No new words: every `+` rendered line in `git diff -U0 main... -- src/app/privacy src/app/terms`
    traces to a research Action. Everything else is a tombstone, markup or an import.
  - No new styling: `sm:grid-cols-2` (T3), `text-slate-600` on P25 (plan-specified), and the T23
    link class copied from privacy §5.2. No Lucide icon added.
  - Empty diffs: `retired-promises.test.ts`, `e2e/`, `public/embed/`, `server/`, `supabase/`,
    `src/components/layout/`, `src/app/login/`, `src/app/signup/`.
  - Out of scope is respected: no controller identity, governing law, DPA or complaint clause
    was added, and the widget cookie, the blog copy and `database-setup.md` are untouched.
  - No `.only` or `.skip`. Nothing was pushed.

## Anti-hallucination
- [x] No invented API, function or import. Each one was opened:
  - The test uses `render` and `screen` from `@testing-library/react` and default-imports
    `@/app/terms/page` and `@/app/privacy/page`, which exist.
  - The `Header` mock matches the named export `Header`; the `Footer` mock matches the default
    export. This is the same shape as `legal-contacts.test.tsx`.
  - The remaining Lucide imports are all used (eslint on the four files: 0 warnings).
- [x] Every new factual sentence was checked against code, config or an ADR:
  - **Vercel** "hosts the website, the API and the ReCopyFast script": `vercel.json`,
    `public/embed/`, ADR 021 (`*.recopyfa.st` on the same Vercel project).
  - **Supabase** "database, sign-in and image storage": `@supabase/supabase-js` and
    `@supabase/ssr`, `signInWithOtp` (`src/contexts/AuthContext.tsx:88`), `uploadSiteAsset`
    through the service-role client (`src/lib/storage/upload.ts:12`).
  - **Fly.io** "the real-time editing server" and "US-East region": `server/fly.toml:91`
    `primary_region = "iad"`, and one machine (`:110`, ADR 026).
  - **Stripe** "payments": `stripe` dependency and `STRIPE_*` env. No `loadStripe`, `stripe-js`
    import or `js.stripe.com` anywhere in `src/` or the widget, although `@stripe/stripe-js` sits
    unused in `package.json`.
  - **OpenAI** "generates AI rewrite suggestions from the text you submit": `openai` dependency,
    `src/lib/ai/openai-service.ts:1,9`. No other AI SDK or host (Anthropic, Gemini, Mistral) in
    `src/`.
  - **Resend** "transactional email": `resend` dependency, `src/lib/email/resend.ts:9,21`.
  - **Upstash** "rate limiting": `redis` (node-redis) with `REDIS_URL`. Only the `.env.example`
    comment ("Provider: Upstash") names the vendor; the code would run against any Redis. See
    Not verified (Q6).
  - **Sentry** "error monitoring": `@sentry/nextjs`, `src/instrumentation-client.ts`,
    `sentry.server.config.ts`.
  - Passwordless sign-in (P32, T11): owners use `signInWithOtp` only; there is no
    `signInWithPassword` anywhere. Editors go through `api/editor/request-code` and
    `api/editor/submit-code`, which both exist.
  - Per-site permissions "view, edit, publish or admin" (P33, T12):
    `src/components/dashboard/InviteEditorForm.tsx:40-43`.
  - "Automated rate limiting on the API" (P38): 33 route files import `enforceRateLimit` from
    `@/lib/api/rate-limit`.
  - T23 "cancel your subscription from Billing": `/dashboard/billing` renders `BillingDashboard`,
    which renders `SubscriptionCard` and its DELETE `/api/billing/subscription`. Billing is the
    one dashboard path the entitlement gate exempts, so it is always reachable.
  - Tombstone facts:
    - settings "Not available yet" (`src/app/dashboard/settings/page.tsx:362-364`);
    - raw IPs in `edit_sessions` (`src/lib/auth/edit-sessions.ts:104`) and
      `user_activity_logs` (`src/lib/analytics/tracker.ts:113`);
    - the only crons are blog generation and webhook dispatch (`vercel.json`);
    - ADR 026 exists.
- [ ] No plausible-but-wrong value: one claim is not true for every account. See **Major 1**
      ("…or delete a site anytime").
- [x] The code matches what it claims to do. The built static HTML
      (`.next/server/app/{privacy,terms}.html`, scripts stripped, real `Header`/`Footer`
      included) contains none of the 34 guard phrases. It also contains none of `gdpr`, `ccpa`,
      `uptime`, `backup`, `disaster`, `hashed`, `geolocation` or `pci`.

## Rules compliance
- [x] Repo conventions (AGENTS.md):
  - The tombstones follow the § Comments house style (why, anchored to the incident).
  - The test change is declared in the commit body, as § Tests requires ("change the test and
    say so in the PR").
  - One story commit, conventional subject.
  - `docs/reviews/` is left for `/ks-ship` to commit.
- [x] No accepted ADR contradicted:
  - ADR 026: the "99.9% on redundant infrastructure" claim is gone.
  - ADR 036: the "client-side encryption for edit tokens" claim is gone.
  - ADR 021: Vercel is named as host.
  - ADR 016: `rcf_vid` is not described anywhere, which is an omission and is on the owner list,
    not a contradiction.
- [x] Design system: copy-only story. The only layout edit is T3's column count, which the plan
      allows. The raw palette classes are pre-existing, and ADR 020 exempts the legal pages.

## Tests
- [x] Test suite run by the reviewer:
  - **`npm test`: 286 suites passed, 2 skipped (DB-gated); 3661 tests passed, 38 skipped,
    0 failed.** This matches the execution log.
  - `npm run lint`: 0 errors. The 35 warnings are all pre-existing, and the four story files have
    0.
  - `type-check`, `type-check:build` and `format:check` pass.
  - `npm run build` exits 0, with `/privacy` and `/terms` prerendered static. The "plan catalogue
    fetch failed" noise comes from the dead CI env on comparison pages and is unrelated.
  - `node scripts/build-embed.mjs --check`: artifact up to date, 45,883 B gzipped, unchanged.
  - `git diff --exit-code` is clean after the build.
- [x] Assertions pin the acceptance criteria:
  - AC1: `GRAVEYARD` × 2 pages.
  - AC2: the `legal-contacts` labels and the mailto allow-list, plus the UNBACKED `eu
    representative`, `data protection officer` and `security team`.
  - AC3: eight provider pins (the `li` must start with "<Provider> — "), `\bAWS\b`,
    `google cloud`, and the certification and control phrases.
  - AC4: every case is a named `it.each`.
  - No assertion-free test.
- [x] Red-before-green re-proved: main's two pages were put into the worktree and the two
      suites run. **45 failed / 39 passed of 84**, exactly the execution log. The pages were
      then restored and both sha256 values checked OK.
- [x] Bite proven by neutralization. Each mutation was applied alone, the two suites run, and the
      file restored with `git checkout --`. `git diff --exit-code` was clean after every one. Both
      pages still hash to `9e0349ad…a630869b` and `bd7fbe4d…384bd89c`.

| # | Mutation | Red | Cases |
|---|---|---|---|
| R1 | privacy §4: `<p>We maintain SOC 2 Type II certification.</p>` | 2 | `/privacy … soc 2`, `/privacy … certifi` |
| R2 | terms §9.1: `<li>Audit logs may be retained for security and compliance purposes</li>` | 2 | `/terms … audit log`, `/terms … compliance` |
| R3 | privacy §4.3: `title="SIEM integration"` on an `li` (attribute only, no text) | 1 | `/privacy … siem`. This proves `innerHTML` reads attributes. |
| R6 | terms §11: "as the law requires" → "within 72 hours" | 1 | `/terms … within 72 hours` |
| R4 | privacy §1.2: "IP addresses" → "IP addresses (hashed for privacy) and geolocation data" (P9, FALSE) | **0** | no case: see Minor 1 |
| R5 | terms §8.1: "Data loss or corruption (though we implement robust backup systems)" (T22) | **0** | no case: see Minor 1 |
| R7 | privacy §4.1: `{/* SOC 2 Type II, audit logs, SIEM */}` JSX comment | 0 | expected: comments are not rendered, so tombstones are safe |
| R8 | test helper `renderedHtml` made to return `""` | **0** | 84/84 green: see Minor 2 |

The guard bites on everything its vocabulary names (R1-R3, R6, plus the implementer's M1-M5).
It is blind to removed claims outside that vocabulary (R4, R5) and to a broken helper (R8).

## Regressions
- [x] No impact on existing code paths:
  - Both pages are static server components with no data or `metadata` export.
  - They are linked from `Footer`, `login` and `signup`, none of which changed.
  - `comparison-discovery.test.tsx` (footer links), `retired-promises.test.ts` and
    `legal-contacts.test.tsx` all pass in the full run.
  - E2E-040 and E2E-041 check only the status code (not run here, see below).

## Findings

- **major — `src/app/privacy/page.tsx:75`.** The rewritten "Your Control" card promises
  "Export your site content or delete a site anytime". That is not true for an account with no
  entitlement: an expired trial, a subscription past period end, or a founding account after its
  90 days.
  - `src/middleware.ts:163-187` redirects every `/dashboard*` page except `/dashboard/billing` to
    checkout when `hasAnyEntitlement` is false (`src/lib/billing/effective-plan.ts:177`).
  - The only UIs for export (`BulkOperations` in `SiteDetailView.tsx:482`) and for site deletion
    (`/dashboard/sites`) are therefore unreachable exactly when a leaving customer wants them.
  - The APIs are not entitlement-gated, but nothing a user can click reaches them.
  - The text is verbatim from research P4. The research verified that the capability exists
    (E-DEL), not that a user can reach it, so the diff is plan-conformant. It is still a new
    binding claim that the product does not honour for a class of accounts, which is the one
    thing this story exists to prevent.
  - With 0 users today it harms no one. Fix next cycle: drop or scope "anytime", or point to the
    privacy mailbox; or make export reachable for lapsed accounts as a product story. Add the
    phrase to the guard.
- **minor — `src/__tests__/app/legal-pages-truth.test.tsx:63-94`.** Several claims s54 removed
  are outside the guard's vocabulary. R4 ("hashed … geolocation", P9) and R5 ("robust backup
  systems", T22) came back with 0 red.
  - Also uncovered: `gdpr`/`ccpa`, `uptime`, `disaster recovery`, `pci`, `12 months`/`3 years`,
    `30 days to export`. The `\bAWS\b` pin covers /privacy only.
  - None of these phrases is on either built page today, so adding them costs no false positive.
  - The list is exactly the plan's, and the plan calls the guard a tripwire, so this is not
    drift. The P9 inline tombstone partly covers the IP case.
- **minor — `src/__tests__/app/legal-pages-truth.test.tsx:114-130`.** The bite check asserts the
  `h1` through `screen`, not through `renderedHtml`, the string that all 68 absence cases and the
  AWS case read.
  - R8 (the helper returns `""`) left all 84 cases green.
  - The helper is correct today (R1-R3 and R6 went red through it). Asserting the title inside
    `renderedHtml(page)` would make "an empty render cannot pass" literally true.
- **minor — cosmetic.**
  - `src/app/terms/page.tsx:318` keeps a lone "9.1 Termination Rights" subsection now that 9.2
    is gone.
  - `src/app/privacy/page.tsx:417`: the contact grid now holds 3 tiles in `sm:grid-cols-2`, which
    leaves one orphan tile, since the EU block was removed.
  - Both follow the plan, which forbade `className` edits on /privacy and did not ask for
    renumbering. Neither is verified visually.

Counts: critical 0 · major 1 · minor 3.

## Not verified

**What this review could not check, and why:**
- **No browser.** The layout was not seen: the 2-card /terms summary grid, the 3-tile /privacy
  contact grid, the shorter sections, and the lone 9.1. *Gesture:* open `/privacy` and `/terms`
  on a preview deploy at 1440 px and 390 px.
- **E2E-040 and E2E-041** were not run (they need a dev server). *Gesture:*
  `npx playwright test e2e/public-pages.spec.ts -g "E2E-04[01]"` against `npm run dev`.
- **Production and live infrastructure were not queried**, by choice:
  - the TLS 1.2 acceptance on Vercel and Fly (research E-TLS);
  - that production matches `main`;
  - Supabase's AES-256-at-rest statement (E-SB).

  The new wording ("TLS", "AES-256 at rest for our database") holds whichever TLS version is
  negotiated. *Gesture:* after deploy, read both pages on production and confirm they match this
  diff.
- **Upstash as the production Redis (research Q6).** The only evidence in the repo is the
  `.env.example` comment, and the plan lists Upstash "pending the owner's confirmation".
  *Gesture:* the owner checks `REDIS_URL` in the Vercel and Fly secrets. If it is not Upstash,
  use the research's fallback line.
- **Major 1 was traced by reading the code, not by running it.** *Gesture:* with a test account
  whose trial has lapsed, open `/dashboard/sites` and try to reach export or delete.

**Owner/legal must review.** These come from the research and the plan and are expected, not
defects. Nothing here is written into the pages by s54.
1. **Controller identity.** Neither page names the controller (legal entity, address, country;
   Art. 13(1)(a)). The Terms state no governing law or jurisdiction.
2. **EU representative and DPO.** Both were removed as false. Whether either is legally required
   depends on where the company is established.
3. **Right to complain.** The right to complain to a supervisory authority (Art. 13(2)(d)) is
   absent.
4. **DPAs and transfers.** §3.1 and §3.3 now claim no DPA or SCC. Confirm which provider DPAs
   are in force (Supabase and OpenAI need action to execute theirs), then decide the transfer
   wording.
5. **Retention.** §7 keeps criteria only. Periods are needed for:
   - raw IPs and user agents in `edit_sessions` and `user_activity_logs`;
   - Vercel and Sentry logs;
   - support mail;
   - backups.
6. **Kept commitments, honoured by hand.** Confirm each or remove it:
   - the 30-day response to privacy requests (P44);
   - 30-day notice before discontinuing features (T20);
   - email notice of material changes, effective 30 days later (T29, T32);
   - investigate, contain, add measures and cooperate after an incident (T33, T36);
   - "notify affected users as the law requires" (T34).
7. **Account deletion** happens by hand through the privacy mailbox (T23). No deletion timeline
   remains on either page.
8. **This change under Terms §10.** Both dates read September 28, 2026 (the commit date). The
   owner sets "Effective" and decides whether registered users get an email first (Q1).
9. **The widget cookie.** It sets a 1-year `rcf_vid` cookie and makes A/B requests for every
   visitor of every customer site (ADR 016), and neither page discloses it.
   - Removing the "Performance" cookie category (P46, correct for recopyfa.st) makes the §6 list
     read as complete while the widget still sets it.
   - s55 (`no visitor cookie by default`) is the product fix.
10. **Mailboxes.** The privacy and support mailboxes must accept mail before launch; the s50
    review saw both bounce. The host behind the `mail.recopyfa.st` MX is a processor no list
    names.
11. **Backups.** Confirm the Supabase plan and its backups. P30 and T22 can regain a backup
    claim once that is confirmed.
12. **Also for the owner** (research unknowns, plus this review):
    - whether Supabase Auth's own mailer or a custom SMTP sends the magic-link emails;
    - that /privacy states no lawful basis per purpose (Art. 13(1)(c)), which predates s54;
    - that the landing demo loads images from `images.unsplash.com`, so visitors' IPs reach
      Unsplash.

## Verdict

## Product owner disposition (orchestrator, 2026-09-28)

- **Major fixed at `8602eb4`** (fix run, test-first): the "Your Control" card now reads "Export your
  site content or delete a site from your dashboard while your plan is active. After it ends, email
  the privacy mailbox and we will export or delete it for you." A guard case pins the old "anytime"
  phrasing. Exact owner wording, pinned by tests; no full re-review needed.
- **Minor 1 fixed:** guard vocabulary adds anytime, hashed, geolocation, backup systems (each bite
  proven). **Minor 3 fixed:** lone 9.1 removed; contact grid `lg:grid-cols-3`.
- **Minor 2 (bite check reads the rendered string)** → s53 hardening.
- **Owner/legal list (12 items)** → the owner: controller identity, governing law, EU
  representative/DPO need, right to complain, DPAs and transfers, retention periods, kept
  commitments, Terms §10 effective-date notice, the `rcf_vid` cookie (removed by s55), mailboxes,
  Supabase plan/backups, Upstash confirmation.
- Follow-up story `s57-lapsed-export`: a lapsed account can export its own content from the dashboard.


Max severity: major
Ship allowed: yes
