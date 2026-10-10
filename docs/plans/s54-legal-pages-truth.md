---
validated: yes
---
# Plan — Story s54-legal-pages-truth

Branch: `feature/s54-legal-pages-truth`
Research: `docs/research/s54-legal-pages-truth.md`. Read it first; this plan does not repeat it.
The research's inventory tables (P1-P59, T1-T38) are the specification. Their **Action** column
holds the exact new text for every change, and it is the only source of words this story may
add.

## Target story

`docs/stories.md:1988-2002`. Complexity 2. Embed allocation 0 bytes. Launch-relevant.

- **AC1.** /privacy and /terms claim no graveyard feature: audit logs, RBAC, SIEM, the
  notification centre, org roles, or the theme editor.
- **AC2.** The EU Representative and every other named role that does not exist is removed or
  replaced with what is true. That means the Data Protection Officer and the Security Team. Every
  contact is `privacy@recopyfa.st` or `support@recopyfa.st`.
- **AC3.** The processing and security sections describe the real stack, without overstated
  certifications or controls. The stack is Vercel, Supabase, Fly.io, Stripe, OpenAI, Resend,
  Upstash and Sentry.
- **AC4.** A guard test fails if a graveyard name reappears on either page. The local gates pass,
  and the work lands in one story commit.

Product owner rule: remove rather than invent, and never add a legal commitment. A section the
law expects stays, saying only what is true, and goes on the owner/legal list below.

Decisions this plan takes from the research's open questions. The owner confirms them at
validation:

- **Q1, dates.** Both dates become the story commit's date. The owner may move "Effective" out
  30 days.
- **Q2, replacements.** The verified replacements are used rather than bare removal.
- **Q3, commitments.** The seven commitments listed in the research are kept.
- **Q4, breach notice.** The breach wording becomes "as the law requires".
- **Q5, account deletion.** Deletion is routed to `privacy@` by hand.
- **Q6, Upstash.** It is listed by name, pending the owner's confirmation. If the owner does not
  confirm, the line reads "Redis hosting — rate limiting".

## Before task 1

- **Worktree.** Create it and install:

  ```
  git worktree add .omx/worktrees/s54-legal-pages-truth -b feature/s54-legal-pages-truth main
  npm run setup
  ```

  Do not start Supabase. The shared local stack belongs to other stories.
- **Environment for every Jest, build and commit command.** Set `SP` to the scratchpad:
  `/private/tmp/claude-501/-Users-marcusbey-Desktop-02-CS-05-Startup-recopyfast/778b4678-01ef-4a37-bb35-2f2282f4350c/scratchpad`.
  Then:

  ```
  source $SP/ci-env.sh
  export RCF_TEST_SUPABASE_CONFIG=$SP/dead-supabase.toml
  ```

  DB suites then report `[gated]`. s54 touches no DB path.
- **Docs.** Copy the untracked research and this plan from the main tree into the worktree. They
  travel in the story commit. The s54 story text is already on `main`.
- **Baseline.** Record the `npm test` pass/fail/gated counts, and the `npm run lint` warning count
  for the two pages, which is 3 today.

## Tasks (ordered)

1. [x] **The guard and the label swap, test-first (RED).**

   **New `src/__tests__/app/legal-pages-truth.test.tsx`.**

   - Mock `Header` and `Footer` exactly as `legal-contacts.test.tsx:20-24` does. Render each page
     and read `container.innerHTML.toLowerCase()`: text plus attributes, never comments. The file
     header explains, in the house style, why each list exists and why a render replaces
     `retired-promises`' AST scan here. The pages are static, so the render is what a visitor
     reads.
   - `GRAVEYARD` holds `audit log`, `role-based`, `rbac`, `siem`, `notification cent`,
     `in-app notification`, `org role`, `organization role`, `team role` and `theme editor`.
     Test: `it.each` over pages × phrases, named `"/%s never names the graveyard feature %s"`.
   - `UNBACKED` holds the claims s54 removes, so they cannot creep back:
     - certifications and roles: `soc 2`, `compliance`, `certifi`, `eu representative`,
       `data protection officer`, `security team`;
     - availability: `99.9`, `redundant`, `24/7`;
     - authentication and encryption: `tls 1.3`, `multi-factor`, `two-factor`,
       `end-to-end encryption`, `client-side encryption`, `cryptographic erasure`, `zero-trust`,
       `intrusion detection`;
     - providers and cookies: `google cloud`, `cookie consent`;
     - deadlines and retention: `within 72 hours`, `within 24 hours`, `within 90 days`,
       `7 years`;
     - features: `multi-language`.

     Test: `"/%s makes no unbacked claim: %s"`. Leave `penetration testing` off the list: it
     stays in the Terms §4 prohibition.
   - Bite check: each render contains its `h1` ("Privacy Policy" or "Terms of Service"), so an
     empty render cannot pass.
   - Positive pins for AC3:
     - /privacy lists each of Vercel, Supabase, Fly.io, Stripe, OpenAI, Resend, Upstash and Sentry;
     - it names neither AWS nor Google Cloud. Match `/\bAWS\b/` case-sensitively, because a
       plain lowercase "aws" would trip on "laws";
     - /terms renders no heading `9.2`.

   **`src/__tests__/app/legal-contacts.test.tsx`.** Change the label arrays only:

   - Privacy: `["Privacy Requests", "Security Issues"]`, and remove "EU Representative".
   - Terms: `["Legal Inquiries", "Security Issues", "Privacy Requests"]`.
   - Leave every address assertion, the `mailto` loop and the status-page case as they are. Add
     one line to the file's comment saying s54 renamed the roles.

   Every line on today's pages that matches a listed phrase is a line the research changes (checked
   2026-09-28: 24 lines on /privacy and 13 on /terms, all covered by an action). The new texts
   match none, so the guard turns green exactly when every action has landed.

   Run both files. Expected RED:
   - every GRAVEYARD case that research P16, P33, P41, T7, T12, T27 and T30 names;
   - the UNBACKED cases;
   - the provider pins;
   - the `legal-contacts` label case.

   Record the red list for the execution log.

2. [x] **/privacy (GREEN, part 1).** In `src/app/privacy/page.tsx`, apply every action from P1
   to P59, verbatim. Six are structural:

   - **P5, P26:** delete both callout `<div>`s.
   - **P20, P21, P22, P23, P24:** §3.2 becomes the lead-in (P19) plus eight `<li>`s, in this
     order: Vercel, Supabase, Fly.io, Stripe, OpenAI, Resend, Upstash, Sentry. The texts are the
     ones in the research. Use the existing `<li>` markup, with no new classes.
   - **P25:** §3.3 keeps its `h3`. The paragraph and the list become the single `<p>` from the
     research, with `className="text-slate-600"`.
   - **P54:** delete the deletion `<p>`.
   - **P57:** delete the EU Representative block.
   - **P59:** the Response Time box keeps only its first sentence.

   Also:

   - Add a header tombstone above `export default` (research Traps, "Tombstones"). Add inline
     `{/* */}` tombstones at P9, P28 and P32.
   - Remove the imports that become unused: `Globe`, plus the already-unused `FileText`.
   - Do not touch: the hero copy, the TRUE rows, the contact grid's markup, or any `className`.

   Run the guard. Every /privacy case goes green.

3. [x] **/terms (GREEN, part 2).** In `src/app/terms/page.tsx`, apply every action from T1 to
   T38, verbatim. Five are structural:

   - **T3:** delete the 99.9% card, and change `sm:grid-cols-3` to `sm:grid-cols-2` at :44.
     That is the only `className` edit in the story.
   - **T6, T7:** the Security Notice becomes one sentence.
   - **T17:** the §7 heading becomes "Service Changes". Its list keeps T20 and T21.
   - **T23:** the §9.1 first bullet is the research text, with a `mailto:privacy@recopyfa.st`
     link. Copy the link `className` from the existing `privacy/page.tsx:365`.
   - **T24-T28:** delete the whole 9.2 `h3` and list, and retitle §9 "Termination".

   Also:

   - Add the header tombstone.
   - Remove `Clock`, which becomes unused, plus the already-unused `AlertTriangle` and `Users`.

   Run the guard and `legal-contacts`. Everything is green.

4. [x] **Gates, bite proof, the story commit.** In the worktree, with the environment above:

   - **Gates.** Run `npm run lint` (0 errors; the two pages now have 0 warnings),
     `npm run type-check`, `npm run type-check:build`, `npm run format:check`, `npm test` (green
     overall; DB suites `[gated]`), `npm run build`, and `node scripts/build-embed.mjs --check`.
   - **Bite proof, before committing.**
     - Back up each page and record its `shasum -a 256`.
     - Apply each mutation alone, run the two suites, then restore from the backup and confirm
       the sha256 matches. Do not use `git checkout` here: it would discard the story's own
       uncommitted edits.
     - The mutations:
       - M1: "Maintain comprehensive audit logs for compliance" back into privacy §2.2;
       - M2: "Role-based access controls and session management" back into terms §6.1;
       - M3: the "SOC 2 Type II" callout back into privacy §4;
       - M4: the EU Representative block back into privacy §8;
       - M5: the Upstash `<li>` deleted.
     - Each must turn at least one named case red.
   - **Interdicts.** Run the checks below.
   - **Story text and execution log.**
     - Tick s54's four boxes in `docs/stories.md`.
     - Append `## Execution log` to this plan: the gates with their counts, the red-before-green
       list, the M1-M5 table, and the claim table.
     - The claim table has one row per research ID marked FALSE, GRAVEYARD or UNVERIFIABLE, with
       the action taken and the line where the result now sits. A removed claim points at its
       tombstone.
   - **Commit.** Make one commit on `feature/s54-legal-pages-truth`, with the hook's Jest run
     under the same `RCF_TEST_SUPABASE_CONFIG`.
     - Subject: `fix: /privacy and /terms describe the product that exists (s54)`.
     - The body declares the test change the PR must state: `legal-contacts.test.tsx` role
       labels renamed, addresses unchanged.
     - Do not push, open a PR or merge.

## Run interdicts

- `git diff --stat main...HEAD` lists only these files:
  - `src/app/privacy/page.tsx`
  - `src/app/terms/page.tsx`
  - `src/__tests__/app/legal-pages-truth.test.tsx`
  - `src/__tests__/app/legal-contacts.test.tsx`
  - `docs/stories.md`
  - the research
  - this plan
- **No new words.** Run `git diff -U0 main -- src/app/privacy src/app/terms | grep '^+[^+]'`.
  Every added line of rendered text appears verbatim in the research's Action column. Anything
  else must be a tombstone comment, markup, or an import line.
- **No new styling.** The only new `className` value is `sm:grid-cols-2`. The one copied value
  on T23's link already exists on `/privacy`. No new Lucide icon is imported.
- These diffs are empty:
  - `src/__tests__/marketing/retired-promises.test.ts` and `e2e/`;
  - `public/embed/` (0 bytes) and `server/`;
  - `supabase/`;
  - `src/components/layout/`, `src/app/login/` and `src/app/signup/`.
- In `legal-contacts.test.tsx`, only the label arrays and one comment line change.
- **Out of scope.** Do not fix:
  - the widget's `rcf_vid` cookie or its A/B requests;
  - the blog's "any site" copy;
  - `docs/operations/database-setup.md`.

  Do not add a controller identity, a governing law, a DPA, a complaint-authority clause or any
  other clause the pages lack. Those are on the owner/legal list.
- **No outside actions.** No test is loosened, skipped or `.only`'d. No push, PR, merge,
  deploy, production query, mailbox probe or email to users. The shared local Supabase is neither
  started nor used.

## The point everything turns on

**The research's Action column is the only source of new words.** Everything else is deletion.
This stands or falls in three places.

1. **A "true replacement" that is not quite true.**
   - P32 and T11 (passwordless sign-in): compare with `AuthContext.tsx:88` and the editor
     `request-code`/`submit-code` routes.
   - P33 and T12 (per-site permissions): compare with `InviteEditorForm.tsx:40-43`.
   - P27 (AES-256): Supabase's statement covers the database only, not Upstash, Sentry or
     Vercel logs.
   - P38 (rate limiting): compare with the limiter imports.
   - P25 (US-East): compare with `server/fly.toml` `primary_region`.
   - The provider list: compare with the research's sub-processor table, and Upstash with the
     owner's answer to Q6.
2. **A removal that empties something the law expects.** Read the finished /privacy against the
   GDPR Art. 13 items:
   - purposes: §2 is kept;
   - recipients: the §3.2 list;
   - transfers: the §3.3 sentence;
   - retention: the §7 criteria;
   - rights: §5 is kept.

   The items the pages never had go on the owner/legal list, not into the diff: controller
   identity, and the right to complain to a supervisory authority.
3. **The guard is a tripwire, not a proof.** Paraphrases slip past it, for example "audit trail"
   or "SOC2". Phrases shared with text that stays would falsely fail it; that is why
   "penetration testing" and "vulnerability" are not on the list. The reviewer reads the diff
   rather than trusting the green run.

## Owner/legal must review

Nothing on this list is written into the pages by s54.

1. **Controller identity.** Neither page names the controller: legal entity, address, country
   (Art. 13(1)(a)). The Terms state no governing law or jurisdiction.
2. **EU representative and DPO.** Both are removed as false. Whether either is legally required
   depends on where the company is established.
3. **Right to complain.** The right to lodge a complaint with a supervisory authority
   (Art. 13(2)(d)) is absent from /privacy.
4. **DPAs and transfers.** §3.1 and §3.3 now claim no DPA or SCC. Confirm which provider DPAs are
   in force; Supabase and OpenAI need action to execute theirs. Then decide the transfer wording.
5. **Retention.** §7 keeps criteria only. Set periods for:
   - raw IPs and user agents in `edit_sessions` and `user_activity_logs`;
   - Vercel and Sentry logs;
   - support mail;
   - backups.
6. **Kept commitments, honoured by hand.** Confirm each or remove it:
   - the 30-day response to privacy requests (P44);
   - 30-day notice before discontinuing features (T20);
   - email notice of material changes, effective 30 days later (T29, T32);
   - investigate, contain, add measures and cooperate after an incident (T33, T36);
   - notify affected users as the law requires (T34).
7. **Account deletion.** It happens by hand through `privacy@` (T23). No deletion timeline
   remains on either page.
8. **This change under Terms §10.** Set the Effective date, and decide whether registered users
   get an email before it applies (Q1).
9. **The widget cookie.** The widget sets a 1-year `rcf_vid` cookie and makes A/B requests on
   every visitor of every customer site. Neither page discloses it, and customers may need to
   disclose it in their own cookie policies. Candidate product fix: stop setting it while A/B is
   parked.
10. **Mailboxes.** `privacy@` and `support@recopyfa.st` must accept mail before launch. The s50
    review saw both bounce. The `mail.recopyfa.st` host is a processor that no list names.
11. **Backups.** Confirm the Supabase plan and its backups. P30 and T22 can regain a backup claim
    once that is confirmed.

## Files touched

- **Modified:**
  - `src/app/privacy/page.tsx`
  - `src/app/terms/page.tsx`
  - `src/__tests__/app/legal-contacts.test.tsx` (labels only)
  - `docs/stories.md` (s54 ticks)
- **New:**
  - `src/__tests__/app/legal-pages-truth.test.tsx`
  - `docs/research/s54-legal-pages-truth.md`
  - `docs/plans/s54-legal-pages-truth.md`

## Test strategy

- **Unit (jsdom render).** `legal-pages-truth.test.tsx` covers AC1, AC3 and AC4:
  - graveyard absence per page;
  - unbacked-claim absence per page;
  - the real provider list;
  - a bite check.

  `legal-contacts.test.tsx` covers AC2: roles renamed, every `mailto` on the two allowed
  addresses.
- **Bite.** M1-M5 in Task 4 prove each guard family turns red on a single regression.
- **Unchanged coverage.** `retired-promises` still scans both files for the s50 phrases. E2E-040
  and E2E-041 still load both pages. No Playwright change is needed, because no E2E asserts
  their text. Running `playwright test e2e/public-pages.spec.ts -g "E2E-04[01]"` is optional and
  needs a dev server.
- **Not automated.** The layout of the 2-card terms grid and the shorter sections. Check it by
  eye at 1440 and 390 widths during review or after deploy.

## Definition of Done

- **Tests.** Every AC has a named, green test. M1-M5 each turned a named case red and were
  restored with a matching sha256.
- **Gates.** In the worktree, with the CI env and the dead DB config, these pass: `lint` (the two
  pages at 0 warnings), `type-check`, `type-check:build`, `format:check`, `test`, `build` and
  `build-embed --check`.
- **Interdicts.** Every run interdict holds, checked by the commands given. Every added rendered
  line traces to a research Action.
- **Evidence.** The execution log carries the claim table: 75 non-TRUE rows, each with its action
  and where it now lives.
- **Commit.** There is one story commit on `feature/s54-legal-pages-truth`, not pushed. Its body
  declares the `legal-contacts` label change.
- **After this story.** `/ks-review` comes next. After merge and deploy, the owner works through
  the owner/legal list. The owner also reads `/privacy` and `/terms` on production and confirms
  that both mailboxes receive mail before the launch posts.

## Execution log

Executed 2026-09-28 in `.omx/worktrees/s54-legal-pages-truth`, branched from `main` at
`7c21d00`, with `ci-env.sh` sourced and `RCF_TEST_SUPABASE_CONFIG` on the dead config. No
Supabase stack was started. `main` has since moved to `3235618` (s55 story text in
`docs/stories.md` only); the story diff is `main...feature/s54-legal-pages-truth`.

### Gates

| Gate | Before (7c21d00) | After |
|---|---|---|
| `npm test` | 285 suites passed, 2 skipped (DB-gated); 3581 tests passed, 38 skipped, 0 failed | 286 suites passed, 2 skipped (DB-gated); 3661 tests passed, 38 skipped, 0 failed (+80, all in `legal-pages-truth`) |
| `npm run lint` | the two pages: 3 warnings (`FileText`; `AlertTriangle`, `Users`) | 0 errors; the two pages and both test files: 0 warnings |
| `npm run type-check` | — | pass |
| `npm run type-check:build` | — | pass |
| `npm run format:check` | — | pass |
| `npm run build` | — | pass |
| `node scripts/build-embed.mjs --check` | — | artifact up to date; bundle 45,883 B gzipped, unchanged (0 embed bytes) |

### Red before green (Task 1)

45 of 84 cases failed on the unchanged pages, all for the expected reason:

- **Graveyard.** /privacy: `audit log` (P16, P41), `rbac` and `role-based` (P33), `siem` (P41).
  /terms: `audit log` (T7, T27), `role-based` (T12), `in-app notification` (T30).
- **Unbacked, /privacy (18):** `24/7`, `7 years`, `certifi`, `client-side encryption`,
  `compliance`, `cookie consent`, `cryptographic erasure`, `data protection officer`,
  `end-to-end encryption`, `eu representative`, `google cloud`, `intrusion detection`,
  `multi-factor`, `security team`, `soc 2`, `tls 1.3`, `within 24 hours`, `zero-trust`.
- **Unbacked, /terms (9):** `99.9`, `compliance`, `data protection officer`, `multi-factor`,
  `multi-language`, `redundant`, `tls 1.3`, `within 72 hours`, `within 90 days`.
- **Pins:** all eight provider pins, `/privacy names no host it does not use`, and
  `/terms has no 9.2 …`.
- **`legal-contacts`:** "routes customer support to support@ and everything legal to privacy@"
  (no `h4` "Privacy Requests" on /terms).

The 39 cases already green at RED: both bite checks, the three unchanged `legal-contacts` cases,
and 34 absence cases for phrases neither page carried that day (for example `org role`,
`theme editor`, `two-factor`). Those are regression guards, as the plan intends.

After Task 2 every /privacy case was green; after Task 3 all 84 were, and `retired-promises`
stayed green (9/9).

### Bite proof

Pages backed up to the scratchpad; restored with `cp` after each mutation, never `git checkout`.
sha256 before: privacy `9e0349ad…a630869b`, terms `bd7fbe4d…384bd89c`.

| Mutation | Cases turned red | Restored, sha256 match |
|---|---|---|
| M1 "Maintain comprehensive audit logs for compliance" back into privacy §2.2 | `/privacy never names the graveyard feature audit log`; `/privacy makes no unbacked claim: compliance` | yes |
| M2 "Role-based access controls and session management" back into terms §6.1 | `/terms never names the graveyard feature role-based` | yes |
| M3 the "SOC 2 Type II" callout back into privacy §4 | `/privacy makes no unbacked claim: soc 2`; `/privacy makes no unbacked claim: compliance` | yes |
| M4 the EU Representative block back into privacy §8 | `/privacy makes no unbacked claim: eu representative` | yes |
| M5 the Upstash `<li>` deleted | `/privacy lists Upstash as a service provider` | yes |

M4 re-inserted the block with the `Shield` icon rather than `Globe`, whose import s54 removed: a
`ReferenceError` would have failed every case instead of the one the mutation targets.

### Interdicts

- `git diff --stat main...HEAD`: the two pages, the two tests, `docs/stories.md`, the research
  and this plan. Nothing else.
- Empty diffs: `retired-promises.test.ts`, `e2e/`, `public/embed/`, `server/`, `supabase/`,
  `src/components/layout/`, `src/app/login/`, `src/app/signup/`.
- `className` values added: `grid sm:grid-cols-2 gap-4 mb-16` (T3), `text-sky-600
  hover:underline font-medium` (T23, copied from privacy §5.2) and `text-slate-600` (P25, as the
  plan specifies; the value is already used on the page). No Lucide icon added.
- `legal-contacts.test.tsx`: the two label arrays and one comment line.
- Every added rendered line in `git diff -U0 main -- src/app/privacy src/app/terms` is verbatim
  from the research's Action column; the rest are tombstones, imports and markup.
- No `.only`, `.skip`, push, PR, merge, deploy, production query, mailbox probe or email.

### Claim table

Every research row marked FALSE, GRAVEYARD or UNVERIFIABLE: 44 on /privacy, 31 on /terms, 75 in
all. Lines are in the committed files. "Header" is each page's tombstone above `export default`
(privacy `:5-23`, terms `:5-25`), which states the rule every removed claim broke.

**/privacy** (`src/app/privacy/page.tsx`)

| ID | Verdict | Action taken | Now |
|---|---|---|---|
| P1 | FALSE | Both dates → September 28, 2026 | :44, :48 |
| P2 | FALSE | Reworded: "AES-256 at rest in our database, TLS in transit" | :61 |
| P4 | FALSE | Reworded in the fix run to the owner's wording (see Fix run); inline tombstone | :74-87 |
| P5 | FALSE | "Privacy by Design" callout removed | header |
| P7 | FALSE | Reworded: "API keys and integration settings" | :120 |
| P9 | FALSE | Reworded: "IP addresses"; inline tombstone (re-add location when A/B ships) | :128-133 |
| P12 | FALSE | "Website performance impact metrics" removed | header |
| P14 | FALSE | Reworded: "Generate AI rewrite suggestions" | :172 |
| P16 | GRAVEYARD | Audit-log bullet removed | header |
| P17 | UNVERIFIABLE | Security-assessment bullet removed | header |
| P18 | UNVERIFIABLE | Reworded: "With the service providers listed below, …" | :233 |
| P19 | UNVERIFIABLE | Reworded: "We use these service providers to run ReCopyFast:" | :242 |
| P20 | FALSE | Replaced by Vercel, Supabase, Fly.io | :246-249 |
| P22 | FALSE | Analytics bullet removed | header |
| P24 | UNVERIFIABLE | "strict confidentiality and data protection agreements" removed | header |
| P25 | UNVERIFIABLE | §3.3 heading kept; paragraph and list → the one research sentence pair | :261-266 |
| P26 | FALSE | "Security First" SOC 2 callout removed | header |
| P28 | FALSE | Reworded: "TLS encryption for data in transit"; inline tombstone | :282-284 |
| P29 | FALSE | End-to-end encryption removed | header |
| P30 | UNVERIFIABLE | Reworded: "Encrypted database connections" | :285 |
| P31 | FALSE | Client-side encryption removed | header |
| P32 | FALSE | Reworded: passwordless sign-in; inline tombstone | :292-298 |
| P33 | GRAVEYARD | Reworded: per-site permissions for invited editors | :299-302 |
| P34 | FALSE | JIT access removed | header |
| P35 | UNVERIFIABLE | Access reviews removed | header |
| P36 | UNVERIFIABLE | Zero-trust removed | header |
| P37 | FALSE | 24/7 SOC removed | header |
| P38 | FALSE | Reworded: "Automated rate limiting on the API" | :309 |
| P39 | UNVERIFIABLE | Pen-testing bullet removed | header |
| P40 | UNVERIFIABLE | IDS/IPS removed | header |
| P41 | GRAVEYARD | Bullet → "Error monitoring with Sentry"; heading → "4.3 Monitoring" | :306, :310 |
| P42 | UNVERIFIABLE | Heading → "5.1 Your Data Protection Rights" | :323 |
| P44 | UNVERIFIABLE | Kept (owner/legal list, item 6) | :368 |
| P46 | FALSE | "Performance" cookie removed | header |
| P48 | FALSE | "Security" cookie removed | header |
| P49 | FALSE | Reworded: "You can control cookies through your browser settings." | :396 |
| P51 | FALSE | 12-month anonymisation removed | header |
| P52 | FALSE | 7-year security logs removed | header |
| P53 | UNVERIFIABLE | 3-year support retention removed | header |
| P54 | FALSE | Cryptographic-erasure paragraph removed | header |
| P55 | FALSE | "Data Protection Officer" → "Privacy Requests" | :435 |
| P56 | FALSE | "Security Team" → "Security Issues" | :455 |
| P57 | FALSE | EU Representative block removed | header |
| P59 | UNVERIFIABLE | 24-hour sentence removed; the 30-day sentence stays | :492-493 |

**/terms** (`src/app/terms/page.tsx`)

| ID | Verdict | Action taken | Now |
|---|---|---|---|
| T1 | FALSE | Both dates → September 28, 2026 | :46, :50 |
| T3 | FALSE | 99.9% card removed; grid → `sm:grid-cols-2` | :56; header |
| T5 | FALSE | "multi-language support" dropped from the sentence | :99-101 |
| T6 | UNVERIFIABLE | "We actively monitor…" removed | :179-181; header |
| T7 | GRAVEYARD | "…detailed audit logs" removed | :179-181; header |
| T8 | FALSE | Reworded: "All data transmission is encrypted using TLS" | :232 |
| T10 | UNVERIFIABLE | Security audits and pen testing removed | header |
| T11 | FALSE | Reworded: "Passwordless sign-in for account owners and invited editors" | :234-236 |
| T12 | GRAVEYARD | Reworded: "Per-site permissions for invited editors, and session management" | :237-239 |
| T13 | UNVERIFIABLE | Reworded: "Error monitoring and logging" | :240 |
| T14 | UNVERIFIABLE | GDPR/CCPA protocols removed | header |
| T15 | FALSE | Password bullet removed (accounts have no password) | §6.2 :244-251 |
| T17 | FALSE | Uptime bullet removed; heading → "Service Changes" | :259; header |
| T18 | UNVERIFIABLE | Scheduled-maintenance bullet removed | §7 :259-269 |
| T19 | UNVERIFIABLE | Disaster-recovery bullet removed | §7 :259-269 |
| T20 | UNVERIFIABLE | Kept (owner/legal list, item 6) | :262-265 |
| T22 | UNVERIFIABLE | Reworded: "Data loss or corruption" | :293 |
| T23 | FALSE | Reworded with a `mailto:privacy@recopyfa.st` link | :317-326 |
| T24 | UNVERIFIABLE | 30-day export window removed with 9.2 | header |
| T25 | UNVERIFIABLE | Token invalidation removed with 9.2 | header |
| T26 | FALSE | 90-day deletion removed with 9.2 | header |
| T27 | GRAVEYARD | Retained audit logs removed with 9.2 | header |
| T28 | FALSE | Retention-policy purge removed; 9.2 deleted; §9 → "Termination" | :314 |
| T29 | UNVERIFIABLE | Kept (owner/legal list, item 6) | :356 |
| T30 | GRAVEYARD | In-app notifications removed | header |
| T32 | UNVERIFIABLE | Kept (owner/legal list, items 6 and 8) | :360 |
| T33 | UNVERIFIABLE | Kept (owner/legal list, item 6) | :375 |
| T34 | UNVERIFIABLE | Reworded: "Notify affected users as the law requires" | :376 |
| T35 | UNVERIFIABLE | Incident-report bullet removed | §11 :374-381 |
| T36 | UNVERIFIABLE | Kept (owner/legal list, item 6) | :377-380 |
| T38 | FALSE | "Data Protection Officer" → "Privacy Requests" | :446 |

## Fix run

The review (`docs/reviews/s54-legal-pages-truth.md`) passed with one major and three minors.
This run fixes the major and the two minors the orchestrator asked for, test-first, and amends
the story commit. The claim table above carries the line numbers after this run.

**Major 1: the "Your Control" card (P4).** "Export your site content or delete a site anytime"
was false for an account without a plan: `src/middleware.ts:165-196` (as of `bae700c`) sends every dashboard page
except Billing to checkout, so the export (`BulkOperations`) and site-deletion screens are out of
reach. The card now uses the product owner's wording, with the privacy address as the page's
existing `mailto:` element (the link class of privacy §5.2), and an inline tombstone:

> Export your site content or delete a site from your dashboard while your plan is active. After
> it ends, email privacy@recopyfa.st and we will export or delete it for you.

This is the one sentence in the story whose words do not come from the research's Action column:
the owner supplied it at review.

**Minor 1: vocabulary.** UNBACKED gains `backup systems` (T22), `hashed` and `geolocation`
(P9), and `anytime` (major 1). None is on either page, so no case is a false positive.

| Step | Result |
|---|---|
| RED, vocabulary added, card unchanged | 1 of 92 failed: `/privacy makes no unbacked claim: anytime` |
| GREEN, card reworded | 92 of 92 |
| F1: P9's old "IP addresses (hashed for privacy) and geolocation data" restored | red: `/privacy … hashed`, `/privacy … geolocation` |
| F2: T22's old "Data loss or corruption (though we implement robust backup systems)" restored | red: `/terms … backup systems` |
| F3: the card's old "…delete a site anytime" restored | red: `/privacy … anytime` |

Each mutation was applied alone and restored from a backup; sha256 matched after each (privacy
`ed6a649e…d1e4b3e5`, terms `49d422c9…68e8ca35`).

**Minor 3, cosmetic.**

- /terms §9 had a lone "9.1 Termination Rights" once 9.2 was gone. The `h3` is removed, and the
  list takes the class of the other single-list sections (`mb-6` dropped), so §9 reads like §3.
- /privacy §8 held three tiles in `sm:grid-cols-2`, leaving one orphan. It is now
  `lg:grid-cols-3`: one column below 1024 px and one row of three above. `sm:grid-cols-3` was
  rejected because an unbreakable `privacy@recopyfa.st` would overrun a tile at 640 px. Neither
  layout has been seen in a browser.

**Not done:** the review's Minor 2 (the bite check reads `screen`, not the `renderedHtml` string)
was not in the fix list.

**Gates after the fix run:**
- `npm test`: 286 suites passed, 2 skipped (DB-gated). 3669 tests passed, 38 skipped, 0 failed
  (+8: four phrases on two pages).
- `npm run lint`: 0 errors, and 0 warnings on the four story files.
- `type-check`, `type-check:build`, `format:check` and `npm run build` pass, with `/privacy` and
  `/terms` static.
- `build-embed --check`: up to date, 45,883 B, unchanged.
- Rebased onto `origin/main` `bae700c` (s51) without conflict, then re-run on the rebased tree:
  `npm test` 302 suites passed, 2 skipped (DB-gated), 3902 tests passed, 38 skipped, 0 failed.
  Lint (0 errors), both type-checks, `format:check`, `build` and `build-embed --check` pass. The
  s51 middleware still sends every dashboard page but Billing to checkout without a plan.
