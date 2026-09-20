---
validated: yes
---

> Validated 2026-09-19 by the user's explicit instruction to fix the confirmed live blocker,
> permission-gate Publish, preserve edit-only restrictions, repair stale-session handling, and
> rerun the real cross-device flow.

# Plan — Story s14d-invited-editor-publish

Branch: `feature/s14d-invited-editor-publish`  
Research: `docs/research/s14d-invited-editor-publish.md`  
Design: `docs/designs/s14d-invited-editor-publish.md`

## Tasks

1. [x] **Pin the live failure red in the widget harness.** Extend the real-source embed tests so a
   `publish`/`admin` device identity must render one accessible Publish control and `view`/`edit`
   must render none. Assert clicking it enters the existing confirmation flow. Run the focused
   test and observe the new assertions fail before source changes.

2. [x] **Render the smallest permission-gated control.** In
   `public/embed/recopyfast.src.js::showEditorBanner`, compose the button from the editor banner's
   existing native elements and token-derived literal colours. Call `showPublishConfirmation()`;
   do not duplicate its pending-count or POST logic, and do not expose staging terminology.
   Re-run Task 1 green.

3. [x] **Lock Save-versus-Publish semantics.** Extend the request harness so Save from a grant
   writes only `/staging/content`, Publish explicitly calls `/staging/publish`, both carry
   `X-RCF-Editor-Grant`, and neither URL nor JSON body contains the grant. Keep the existing
   route-level `edit`/`publish` permission tests green.

4. [x] **Make terminal auth failure a recoverable state, test-first.** Add red coverage for a
   dirty Save receiving 401/403: no blocking alert, typed copy preserved in DOM and
   `sessionStorage`, contenteditable removed, mutation controls disabled, one banner status, and
   the correct recovery target opened in a new tab. Assert a 500/network error stays retryable.

5. [x] **Implement shared terminal-session handling.** Retain response status on the Save error;
   handle only 401/403 as terminal in the existing edit lifecycle. Preserve the draft under a
   site+element key, keep the page open, and choose `/edit` for device grants versus
   `/dashboard/sites` for owner edit sessions. No second auth path and no raw exception text.

6. [x] **Rebuild without relaxing the embed ratchet.** Run `npm run build:embed`; keep both
   `MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ` unchanged. If the change exceeds the ceiling, delete
   obsolete invited-editor runtime/comment-derived payload or another proven-dead byte source;
   do not raise a limit and do not remove a reachable feature.

7. [x] **Run focused and full proof.** Focused embed/grant/revocation suites, `npm run
   type-check:build`, `npm run lint`, `node scripts/build-embed.mjs --check`, `npm run build`, and
   full `npm test`. Record existing warnings separately from new failures.

8. [ ] **Repeat the real production-like cross-device evidence on the disposable domain.** On a
   preview deployment of this branch, use the preserved `site_editors` allowlist and a fresh email
   code in an isolated browser: assert one-site visibility, out-of-scope 403, Save not live before
   Publish, explicit Publish live to a fresh visitor, restore baseline, revoke only automated
   device grants, and keep the allowlist for the user's laptop.

## Interdicts

- Edit `recopyfast.src.js`, never the generated artifact; rebuild it.
- Do not widen server permissions or add a fourth auth path.
- Publish is absent for insufficient permission; client hiding is never the authorization check.
- Never put a device grant in a URL, body, screenshot, artifact, console output, test failure or
  report.
- No new dependency, toast system, route, modal, colour, font or design primitive.
- Do not raise either gzip ceiling.

## Definition of Done

An invited editor with Publish can authenticate on a second browser, save a draft, explicitly
publish it, and see it on a fresh visitor page; edit-only remains draft-only; out-of-scope sites
are refused; terminal credential failure keeps the draft and stops futile retries; owner editing
is unchanged; all automated gates and the real external-site run are green.

Plan validated. Next: `/ks-execute s14d-invited-editor-publish`.

## Implementation checkpoint

- Added request coverage for Publish's **preview GET**, as well as POST: the inherited GET
  omitted the device-grant header and supplied an empty staging-token query. Both now reuse the
  existing credential helpers; Save still writes staging only.
- Save and Publish 401/403 stop further writes and new editing, retain typed text in the DOM and
  per-site/element session storage, and provide the correct editor/owner recovery destination.
  500/network Save failures remain retryable. Tests cover keyboard/programmatic retries and
  a previously dismissed editor banner.
- The leader approved the narrowly necessary `data-rcf-ignore` attribute on the editor banner:
  failing tests proved its Publish/Done children were being discovered as editable content.
  The existing scanner exclusion is reused without changing discovery rules.
- Moved inert incident comments outside the CSS template literal. The explanations remain in
  source; no runtime CSS declaration or reachable feature was removed. This keeps the new
  behavior inside the unchanged gzip limits (Node 24.14.0: 46,525 B bundle; 33,757 B widget).
  Production-runtime verification caught that the earlier host-runtime gzip measurements were
  smaller than Node 24's. Two more inert colour-explanation comments were moved outside the
  CSS literal; no CSS declaration changed. Build and size tests now run with the explicit
  Node 24.14.0 executable and matching PATH, leaving 156 B bundle / 108 B widget headroom.
- Red evidence: missing preview grant header; repeated Save alerts on 401/403; absent owner
  recovery; repeated Publish attempts after terminal failures; omitted draft recovery on Publish;
  editor banner children carrying content IDs. Current focused proof: 14 suites / 149 tests pass.
- Fresh-context review identified four additional terminal-state cases, each reproduced red and
  corrected: Publish POST with a non-JSON 401/403; a second in-flight response clearing the
  recovery message; keystrokes after Save was sent being overwritten in stored recovery; and
  owner Edit Board controls remaining usable. Terminal status now dominates later responses,
  current editable DOM wins over the sent payload, and an open board becomes inert/closed with
  its buttons disabled and reopening blocked.
- The first full-suite run lacked worktree environment placeholders. Unrelated API cases failed
  on absent `NEXT_PUBLIC_APP_URL` and `SUPABASE_SERVICE_ROLE_KEY`; all three affected suites
  pass (64 tests) with localhost app URL and a dummy service-role value. No production secret is
  needed or used for these checks. Final full-suite proof: 205 passed / 1 skipped suites;
  2,693 passed / 36 skipped tests (2,729 total), exit 0. Both typechecks, full formatting check,
  production build, `build-embed --check`, and `git diff --check` pass. Lint: zero errors,
  39 existing warnings. Build warnings: inherited multiple-lockfile root inference, middleware
  deprecation, and dynamic billing-cookie rendering; build completes successfully.
- Task 8 remains pending and belongs to the lead's real-browser/deployment lane. No claim of
  production or cross-device completion is made by the implementation checks.
