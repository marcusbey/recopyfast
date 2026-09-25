---
validated: yes
validated_by: operator-prevalidated user scope, 2026-09-25
---
# s35 — Implementation plan

Read research, design, architecture and AGENTS.md first. User explicitly authorizes compressed pipeline and a draft PR before independent review; review document must remain a placeholder. No production credentials/services, migrations, embed change, dependencies, merge or deploy.

- [x] 1. Test-first authenticated per-site activation API/data helper. GET /api/sites/[siteId]/activation: validate UUID, rate-limit before auth (explicit store-failure policy), authenticate and verify admin permission using existing route precedent before scoped reads. Derive install only from s02 effective live status; invited from at least one non-revoked site_editors row; published from staging_history publish record joined to this site's content_elements. Independent bounded existence reads; failure yields retryable error, not fabricated progress. Return boolean facts, dismissal, no credentials, no-store. Cover missing auth, foreign/non-admin site, errors, missing data, stale/awaiting/live, revoked/pending editor, drafts vs publish, attribute-only publish/site scoping.
- [x] 2. Test-first POST on same route to dismiss for authenticated admin's user/site. Persist only boolean `activation_dismissed_<uuid>` in own auth user_metadata using auth.updateUser; never accept target user or completion facts from request. Saving error is non-success. Test own-user isolation, site isolation, preserved unrelated metadata, permission and failure behavior. No migration.
- [x] 3. Test-first useSiteActivation custom hook and ActivationChecklist composition. API fetching, loading/error/retry, stale response protection, server-confirmed dismissal and refresh on focus/after invite with bounded interval only while incomplete and visible. All step combinations, actions and complete-to-Live state; persistent dismissal after remount, different user/site isolation, action/storage/network errors. Use shared UI primitives and design spec. Copy emitted snippet only; show inline success/failure. Reuse SiteEditorsCard/InviteEditorForm in accessible dialog (optional callback for successful editor changes). Use authenticated edit-session create endpoint to open its returned editUrl after validating http(s) and the registered host. The current route uses an expiring rcf_edit_token query parameter, which the widget consumes and strips immediately; do not confuse that session token with the permanent site token or add a fabricated fallback. Surface popup failures and invalid URL. Do not claim completion from actions.
- [x] 4. Integrate on overview for every admin site and on SiteDetailView with current post-rotation snippet. Keep existing site status/install diagnostics and non-admin credential restrictions. Correct public token copy and preserve independent secret API-key copy and rotation caveat. Targeted component integration coverage and existing regression suites. No existing failing markers in scope; report zero flipped.
- [ ] 5. Format changed files, run targeted suites, then hand back to leader for full precommit/build/embed/audit gates under exact CI placeholders. No Playwright spec/count change. Update plan/story checkboxes only as verified. Independent review placeholder is exactly “pending independent review”. Leader owns final commit/push/draft PR after all gates, including exact counts and limitations.

## Acceptance / rollback

All three checklist facts originate in site-scoped reads, with unknown explicitly separate. Dismissal affects only viewing user's chosen site. No schema or widget changes. Revert story commit to remove UI/API; unused account metadata is harmless. Checklist completion means a site has a publish record, not proof that a client rather than an owner authored it. Timed under-five-minute activation is not claimed by unit tests.

## Verification and delivery status — 2026-09-25

- `npm run setup`: root and server installed successfully; both installation audits reported zero vulnerabilities.
- CI-placeholder-only environment: extracted from the `ci` job in `.github/workflows/ci.yml`, with inherited service credentials excluded and no dotenv file copied. All database tests resolved to the existing loopback ReCopyFast test database, never production.
- `npm run precommit -- -- --runInBand`: lint passed (0 errors, 39 inherited warnings), type-check passed; full Jest ran 239 suites: 236 passed, 1 failed, 2 skipped. Tests: 3159 passed, 1 failed, 38 skipped, 3198 total. No test or guard was removed, skipped, weakened, or changed to accommodate this failure.
- The single failure is the unchanged `src/__tests__/db/function-grants.test.ts` invariant: the local database exposes `update_translation_coverage(uuid)` to `authenticated`. Existing `20260809120000_lock_down_definer_functions.sql` revokes that privilege, but later `20260818001000_restore_translation_coverage_function.sql:92` restores it. This is an inherited ACL regression, outside activation scope. No production schema claim is made and no migration was applied or added.
- `npm run format:check`: passed after formatting the new stale-dismissal regression test.
- `npm run build`: passed; 97 static pages generated and the activation route included.
- `node scripts/build-embed.mjs --check`: fresh; bundle 46601 B / 46681 B ceiling, widget 33837 B / 33865 B ceiling; build reproduced those sizes without a tracked artifact change.
- `npm run audit:prod`: zero vulnerabilities.
- `git diff --check`: passed. Zero failing markers flipped; no migration, dependency, widget, or Playwright contract changes. Existing Playwright count remains 44; E2E was not run for this story.
- Delivery is blocked by the required green-precommit condition. No commit, push, PR, merge, or deployment has been performed. The independent review file remains only `pending independent review`.

The follow-up invitation fixes retain asynchronous form focus and delivery/fallback-link feedback. Final `npm run type-check` passed, then the targeted command below passed all 7 suites and 111 tests (0 failed):

```sh
npm test -- --runInBand --runTestsByPath \
  'src/app/api/sites/[siteId]/activation/__tests__/route.test.ts' \
  src/hooks/__tests__/useSiteActivation.test.tsx \
  src/components/dashboard/__tests__/ActivationChecklist.test.tsx \
  src/components/dashboard/__tests__/SiteEditorsCard.test.tsx \
  src/components/dashboard/__tests__/SiteDetailView.test.tsx \
  src/app/dashboard/sites/__tests__/page.test.tsx \
  src/app/dashboard/__tests__/page.activation.test.tsx
```

The under-five-minute user journey remains a GTM target, not a measured result from these unit/API checks.
