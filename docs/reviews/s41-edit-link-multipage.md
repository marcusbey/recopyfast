# Review — s41-edit-link-multipage

Reviewer: fresh-context `reviewer` subagent, 2026-09-25, diff `0e1d5bc...3b948d9`. Returned as
text (its tool policy forbids report files); recorded here by the orchestrator.

## Gates (reviewer's runs)
`tsc --noEmit` 0. Lint 0 errors. Prettier clean on changed tests. Targeted jest (embed suites +
`src/lib/auth/__tests__`): 24 suites, 290 tests pass. `build:embed -- --check` up to date at
45,938 / 33,183; both ceilings lowered; itemised deltas sum exactly.

## Checks
1. Token → sessionStorage only (`recopyfast.src.js:127-138`); URL token wins; orphan `rcf_token`
   never stored; every storage access in try/catch.
2. Server re-checks `is_active`, `expires_at`, `site_id` on every load and write
   (`editor-access.ts:421-437`, `staging-access.ts:186-203`).
3. `noopener` on both `window.open` calls (`:2258`, `:1242`).
4. No emitter of `requiresEmail: true`; removed modal and `escapeHtml` unreferenced.
5. Only the new ≤480px `@media` block and the claim class added.

## Mutations (each restored, `git diff --exit-code`)
localStorage 12 red · clear on 500 1 · SITE_ID dropped from key 11 · stored beats URL 1 ·
`noopener` removed 1 · refused save/publish clear removed 2 · storage try/catch removed 4 ·
≤480px rule removed 1 · server sends `requiresEmail: true` 1. (Byte-gate suite excluded: any
source edit makes it red.)

## Findings (all minor — follow-ups)
- "Kept through 5xx" does not hold in a DB outage: supabase-js returns (not throws) the error, the
  server answers 401 (`editor-access.ts:431-436`, `staging-access.ts:195`) and the widget forgets the
  link (`:1029`). Safe (drafts kept) but signs editors out. Next: server returns 503 on DB errors.
- The other-site test (`edit-link-persistence.test.ts:287`) stays green with SITE_ID removed;
  isolation is guarded only by the key-name assertions. Add a site-A-then-site-B same-tab test.
- Token stored before the `!SITE_ID` / `!SITE_TOKEN` checks (`:131-155`): a misconfigured tag writes
  under `rcf_edit_link:null`.
- Unverified share-link holders now see the blocking verification modal on every page of the tab;
  ADR 036 does not say so.
- T5b (phone bar) is in the plan but not in the story's criteria.

## Not verified
Real-browser `noopener`/sessionStorage (Chrome/Firefox/Safari), session restore, Duplicate Tab,
blocked site data; Playwright; full suite and build; the live multi-page journey (T8).

Max severity: minor
Ship allowed: yes
