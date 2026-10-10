# Review — s40-ai-widget-auth

Reviewer: fresh-context `reviewer` subagent, 2026-09-25, on 9a8feb2 (base origin/main 0e1d5bc).
The reviewer returned its report as text (its tool policy forbade writing files); it is recorded
here verbatim in substance by the orchestrator, followed by the fix-mode note.

## Gates (reviewer's runs)
Type-check clean. Lint 0 errors / 38 pre-existing warnings, none in touched files. 58 targeted
jest suites: 635 passed, 4 skipped. `build:embed -- --check`: fresh at 46,176 / 33,420, both
ceilings lowered from 46,226 / 33,465. Plan-forbidden files: empty diff.

## Confirmed in code
- A site token sent alone is treated as a staging token and refused 401 before any owner read.
- Permission requires `edit` (`publish`/`admin` imply it). Payer is `resolveSiteOwnerId` via the
  service role; the cookie billing path is unchanged.
- Missing `OPENAI_API_KEY` refused before charging; refund only after a charge.
- IP limit before auth; per-site limit after the permission check; both fail closed.
- OPTIONS 204 with public CORS, no credentials. Widget sends the grant header or token body inside
  try/catch. Old widgets sending `autoTranslate` still get 200.

## Mutations (each restored, `git diff --exit-code` clean)
Site token accepted alone: 1 red · charge `sites.user_id`: 20 · charge caller: 1 · grant site
checks removed: 1 · per-site limit before auth: 2 · `view` instead of `edit`: 2 · API-key check
removed: 2 · payer client not forwarded: 2 · **edit-session `site_id` filter removed: 0 of 391** ·
**staging `site_id` filter removed: 0 of 446** · refund try/catch removed: 0.

## Findings
- **major** — nothing tested that an edit-session or staging token for site A cannot spend on
  site B; the route passes the body's `siteId` to both the validator and the owner lookup
  (`route.ts:215,263`), so those two filters are the whole boundary. Code correct today.
- minor — a failed refund cannot throw, untested; the route still says "You were not charged"
  after a failed refund (`route.ts:144,322`).
- minor — if the post-charge balance re-read throws (`system.ts:491`) the owner is charged and not
  refunded (`route.ts:274-295`); pre-existing.
- minor — every billing refusal sets `requiresUpgrade: true`, including transient DB errors.
- minor — plan drift: `build-size-gate.test.ts` edited (justified), commit message differs.

## Fix mode — major (2026-09-25, orchestrator)
`src/lib/auth/__tests__/editor-token-site-binding.test.ts`: a fake Supabase that applies every
filter. Site A's edit session and staging invite are accepted on site A and refused on site B.
Proven: deleting the edit-session `site_id` filter → 1 red; deleting the staging `site_id` filter
→ 1 red; both restored (`git diff --exit-code`). Minors deferred to follow-ups.

## Not verified
Real browser on a customer domain, a real OpenAI call, a real charge/refund, sites with two admin
rows. Live proof after deploy: owner and invited-editor suggestions; site-token-only curl → 401.

Max severity: major
Ship allowed: yes
