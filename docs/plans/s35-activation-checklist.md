---
validated: yes
validated_by: operator-prevalidated user scope, 2026-09-25
---
# s35 — Implementation plan

Read research, design, architecture and AGENTS.md first. User explicitly authorizes the compressed pipeline and draft PR. In this fix run, the existing independent review must remain unchanged and uncommitted. No production credentials/services, migrations, embed change, new dependencies, PR merge or deploy. Merge origin/main only if it moved.

- [x] 1. Test-first authenticated per-site activation API/data helper. GET /api/sites/[siteId]/activation: validate UUID, authenticate, rate-limit per user/site before authorization (explicit store-failure policy), and verify admin permission before RLS-scoped reads. Derive install from the persisted live milestone; invited from at least one non-revoked site_editors row with Publish or Admin permission; published from staging_history publish record joined to this site's content_elements. Independent bounded existence reads; failure yields retryable error, not fabricated progress. Return boolean facts, dismissal, no credentials, no-store. Cover missing auth, foreign/non-admin site, errors, missing data, stale/awaiting/live, revoked/pending editor, drafts vs publish, attribute-only publish/site scoping.
- [x] 2. Test-first POST on same route to dismiss for authenticated admin's user/site. Persist only boolean `activation_dismissed_<uuid>` in own auth user_metadata using auth.updateUser; never accept target user or completion facts from request. Saving error is non-success. Test own-user isolation, site isolation, preserved unrelated metadata, permission and failure behavior. No migration.
- [x] 3. Test-first useSiteActivation custom hook and ActivationChecklist composition. API fetching, loading/error/retry, stale response protection, server-confirmed dismissal and refetch on tab visibility/after invite with a 60-second interval only while incomplete and visible. All step combinations, actions and complete-to-Live state; persistent dismissal after remount, different user/site isolation, action/storage/network errors. Use shared UI primitives and design spec. Copy emitted snippet only; show inline success/failure. Reuse SiteEditorsCard/InviteEditorForm in accessible dialog (optional callback for successful editor changes). Use authenticated edit-session create endpoint to open its returned editUrl after validating http(s) and the registered host. The current route uses an expiring rcf_edit_token query parameter, which the widget consumes and strips immediately; do not confuse that session token with the permanent site token or add a fabricated fallback. Surface popup failures and invalid URL. Do not claim completion from actions.
- [x] 4. Integrate on overview for every admin site and on SiteDetailView with current post-rotation snippet. Keep existing site status/install diagnostics and non-admin credential restrictions. Correct public token copy and preserve independent secret API-key copy and rotation caveat. Targeted component integration coverage and existing regression suites. No existing failing markers in scope; report zero flipped.
- [x] 5. Format changed files, run targeted suites, then hand back to leader for full precommit/build/embed/audit gates under exact CI placeholders. No Playwright spec/count change. Update plan/story checkboxes only as verified. Preserve the independent review; do not overwrite it with a placeholder. Leader owns final commit/push/draft PR after all gates, including exact counts and limitations.

## Operator-prevalidated fix scope — PR #33, 2026-09-25

This section supersedes conflicting original task details and delivery claims below. Preserve the independent review file byte-for-byte and leave it uncommitted. The operator explicitly authorized these fixes, the final fix commit, push, and keeping PR #33 draft.

- [x] F1–F2. Use only the authenticated Supabase server client/RLS for activation reads. After authentication, limit per user and per site before permission/data lookups. Replace filter-blind mocks with a filter-aware fake; prove missing-site-filter IDOR, wrong-id read, and unrelated-site dismissal are caught.
- [x] F3/F5. Installed is a durable verification milestone (persisted live status/live_at); invited requires an active editor with normalized publish permission. Keep step 3 as any site publish and name it explicitly “An edit published”; Live copy states installation, an invited editor with publish permission, and an edit published, without attributing it to the client. The checklist invite action preselects Publish.
- [x] F4/F6/F9. Keep the invite dialog and delivery/fallback feedback mounted through completion and refresh errors, with focus restored on close. Successful revocation in that persistent dialog must also refetch activation, so removing the only publisher cannot leave a stale Live card after polling stops. Token copy says checked against requesting page origin. Add incomplete status, site headings, contextual accessible button names, and site-named errors.
- [x] F7/F8/F11/F12. Test polling stop on completion/hidden tab, detail non-admin hiding, and post-regeneration snippet. Poll at 60 seconds with one tab-return trigger; rename refresh to refetch. Batch only if a small safe change; otherwise explicitly defer. Revert the unplanned SiteDetailView key unless a concrete reason requires it.
- [x] F10/validation. Update research/design/story delivery facts. Run targeted tests while iterating; then one full precommit, format check, build, embed freshness/budgets and production audit with CI placeholders. Delivery remains the authorized fix(s35) commit, existing-branch push, and draft PR description update. No production access, deployment, migrations or review edits.

## Acceptance / rollback

All three checklist facts originate in site-scoped reads, with unknown explicitly separate. Dismissal affects only viewing user's chosen site. No schema or widget changes. Revert story commit to remove UI/API; unused account metadata is harmless. Checklist completion means installation has been verified, an active invited editor has Publish permission, and the site has a publish record. It does not attribute the publish to an invited editor. Timed under-five-minute activation is not claimed by unit tests.

## Verification and delivery status — 2026-09-25

Original implementation `e361c35` is pushed in draft [PR #33](https://github.com/marcusbey/recopyfast/pull/33). The independent review permits ship with four major findings; this fix run addresses them under the operator-approved scope above. Its local review file is deliberately neither modified nor staged.

`origin/main` was fetched and remains `c3b2b28`, already an ancestor of this branch; no merge is needed. No migration was added and zero failing markers were flipped. Existing unrelated guard tests remain intact.

An earlier local-database run failed the inherited `update_translation_coverage(uuid)` ACL invariant. That was not a CI-placeholder run and does not describe current PR delivery state. This run uses a scrubbed environment populated from the `ci` job in `.github/workflows/ci.yml`; no environment file is copied and no remote service is tested. Database-backed tests are not enabled by those placeholders.

Fix-run gates and final counts are recorded below. Targeted suites run in band during implementation; the full required gates run once after integration. Five-minute activation, real PostgREST execution, and browser edit/publish round trips remain unmeasured by these unit/API checks. Optional batched overview requests are deferred because they require endpoint and shared request-state changes; polling is reduced to 60 seconds with one tab-return trigger.

### Targeted fix evidence

- API route: 23/23 tests passed. Before implementation, the new suite recorded 15 failed and 7 passed. Neutralizing the permission site filter, using the wrong site ID, and treating any site's dismissal as this site's each produced one failing regression test; the fixed source was restored byte-for-byte after every mutation.
- Polling hook: 10/10 tests passed, with targeted lint and formatting clean. Red phase recorded 7 failures and 2 passes. Guards include completion without replacement timer, initially hidden state, hide/return without duplicate focus fetch, dismissal, and unmount.
- No existing `it.failing`/`test.failing` marker is in this fix scope; zero markers flipped. Existing test expectations changed only where explicitly required: durable installation replaces recent activity, publish-capable invitations replace any editor, copy is truthful, and visibility replaces duplicated focus refresh.

- UI targeted checks passed for exact copy, accessible site context, non-admin hiding, post-regeneration snippet, Publish preselection, dialog persistence, and focus restoration. The fresh reviewer found a stale Live state after revoking the only publisher inside the persistent dialog; successful revocation now invokes the same activation refetch, with success/failure and Live-to-incomplete regressions. No remaining code/spec/security finding was reported.
- The recursive filter-aware query fake received explicit `FakeQuery`/`FakeQueryResult` interfaces after the first precommit attempt caught TS7022/TS7024. The typing-only repair passed type-check; no guard behavior changed.

### Final local gates (CI placeholders only)

- `npm run precommit -- -- --runInBand`: exit 0. Lint: 0 errors, 39 inherited warnings (zero new). Type-check: passed. Jest: 239 suites total, 237 passed, 2 inherited skipped, 0 failed; 3,183 tests total, 3,145 passed, 38 inherited skipped, 0 failed. The unchanged same-site rotation test passed in this sequential run after earlier timeout-only targeted runs.
- `npm run format:check`: exit 0, all matched source files formatted.
- `node scripts/build-embed.mjs --check`: exit 0, artifact fresh; bundle 46,601 B / 46,681 B maximum, widget 33,837 B / 33,865 B maximum, transport 13,141 B (the gate's Node gzip level 9 measurements).
- `npm run audit:prod`: exit 0, zero vulnerabilities.
- `npm run build`: exit 0 on the final default Turbopack run; production TypeScript passed and 97/97 static pages generated. The activation route is included. Earlier default and webpack attempts failed only with ENOSPC. Removing this worktree's partial generated output and clearing npm's disposable download cache, followed by recovered disk headroom, allowed the exact default command to pass. Installed dependencies and source configuration were unchanged. A waiting uv-cache prune was stopped without forcing access to its active cache.
- Review file SHA-256 remains `69b0877574b0e69e1efcbe6569c8b6557eb16032978127ba242bbaa5404e2009`; leave its pre-existing dirty change uncommitted.

Delivery verification uses the existing draft PR #33. The review is not part of the fix commit; only the four story/design/research/plan documents and 13 source/test files are staged. Commit/push hooks repeat already completed full gates, so those duplicate hook runs are suppressed for this delivery only to honor the loaded-host single-full-gate constraint. No failed gate is bypassed. No merge, deployment, schema change, or production-service test is performed.
