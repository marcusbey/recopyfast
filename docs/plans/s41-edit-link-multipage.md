---
validated: yes
validated_by: operator directive 2026-09-25 — "keep going, don't ask for permission, until tested live in production and ready to launch"
---

# Plan — Story s41-edit-link-multipage

Branch: `feature/s41-edit-link-multipage` (from `origin/main` `fb28a8b`).
Research: `docs/research/s41-edit-link-multipage.md`. Read it first; this plan does not repeat it.
Decision: `docs/decisions/036-edit-link-credential-in-tab-session-storage.md` (written at planning;
renumber if s40 has not landed 035 by merge time). There is no screen: the story reuses the
existing banners and modals, so there is no design step.

## Target story

`docs/stories.md` § s41. After following **Edit website** (`rcf_edit_token`) or a **Share Preview
Link** (`rcf_staging=1&rcf_token`), edit mode (plus staging mode for share links) persists across
full-page loads in the same tab and origin. It lasts until the server refuses the credential or
the tab closes.

- The credential goes to sessionStorage, keyed `rcf_edit_link:<SITE_ID>`, never to localStorage.
- It is cleared on a 401/403 from validate or from a terminal save/publish, and kept on 5xx or a
  network failure.
- Blocked or hostile storage never throws into the host page.
- Preview Live opens with `noopener`. A new tab stays a visitor tab.
- The bytes are paid in-branch. An ADR is recorded. jsdom tests cover the behaviour; there is no
  new Playwright spec.
- It is proven live in production after deploy.

## Tasks (ordered)

TDD order: each task writes its failing test first, records red (naming any tests that already
pass at red, and why), then goes green. Pay before spending, so `npm run build` stays under the
ceiling at every step.

1. [x] **T1: pin the premise the payment rests on (server).** In
   `src/lib/auth/__tests__/staging-access.device-binding.test.ts` (reuse its
   `mockSupabaseReturning`), add a `describe("requiresEmail is never emitted")` covering three rows:
   - an `access_type: "link"` row with `email: null` → `valid: false` and `requiresEmail` is not `true`;
   - an unverified invite row → `requiresVerification: true` and `requiresEmail` is not `true`;
   - a verified, bound row → `requiresEmail` is not `true`.

   These pin current behaviour, so they pass at red. That is expected and must be stated. Prove
   they bite with a mutation: temporarily make `staging-access.ts:212-222` return
   `{ valid: true, requiresEmail: true, … }`, see the first case go red, then revert. Record the
   mutation in the Execution log.
2. [x] **T2: pay first (remove the dead email-capture UI and `escapeHtml`).**
   - Test first, in the new suite `src/__tests__/embed/edit-link-persistence.test.ts` (harness
     below): boot `/pricing?rcf_staging=1&rcf_token=tok` with `/staging/validate` answering
     `{ valid: true, verified: false, requiresEmail: true, permissions: [] }`. Assert:
     - no `#rcf-email-input` or `#rcf-email-submit` is ever rendered;
     - `editMode` is `false`;
     - nothing throws.

     Red: the capture modal renders.
   - Then delete, in `public/embed/recopyfast.src.js`:
     - the `if (result.requiresEmail) { await this.showEmailCaptureUI(); return; }` branch (`:992-995`);
     - `showEmailCaptureUI()` in full (`:1656` up to `showVerificationUI(email)` at `:1774`);
     - `escapeHtml` with its comment (`:116-122`).
   - Leave a tombstone comment where the branch was. It says the server has not sent
     `requiresEmail: true` since `747d210` (link rows without an email are refused), that T1 pins
     this, and that the modal was deleted to pay for s41. Keep `showVerificationUI` and the CSS
     classes; they are still used.
   - Run `npm run build:embed`. Record the gz numbers; expect about −426 / −424 against the base.
3. [x] **T3: persist and restore the edit-link credential.** Tests first in
   `edit-link-persistence.test.ts`. Each "page load" is a fresh `boot(url)`; sessionStorage is
   cleared only in `beforeEach`.
   - (a) `/?rcf_edit_token=real`:
     - `editMode === true`;
     - `location.search === ""`;
     - `sessionStorage['rcf_edit_link:site-abc']` holds `real`;
     - `localStorage.length === 0`.
   - (b) Then `boot("/about")` with a clean URL:
     - `stagingMode` truthy and `editMode === true`;
     - `/staging/validate` received `editToken: "real"`;
     - the staging content read carries `rcf_edit_token=real`, exactly as on page 1.
   - (c) Share link `/?rcf_staging=1&rcf_token=share`, then `boot("/about")`:
     - staging banner present (`#rcf-staging-banner`);
     - validate received `token: "share"`.
   - (d) A new URL token wins: the stored `old`, then `/?rcf_edit_token=new` → the stored value
     becomes `new`, and validate sees `new`.
   - (e) An orphan `/?rcf_token=orphan` (no `rcf_staging=1`) → nothing stored. The existing
     `editor-grant-requests.test.ts:330` must stay green.
   - (f) A key for another site (`rcf_edit_link:other-site`) is ignored → visitor.
   - (g) Hostile storage never reaches the host. Listen for `window` `error` and
     `unhandledrejection` events and assert none fire.
     - Throwing cases: `Storage.prototype.getItem`, `setItem` and `removeItem` throw, and so does
       a `window.sessionStorage` getter (`Object.defineProperty`, restored in `afterEach`).
     - Expected: page 1 still edits from the URL; page 2 is a visitor.
     - Stored garbage: `"not json"` → visitor; `"{}"` and `"[1,2]"` → no throw.
   - (h) A device-grant-only boot (the stored `rcf_editor_grant:*` from
     `editor-grant-edit-mode.test.ts`'s helper shape) writes no `rcf_edit_link:*` key.

   Red: (b), (c), (d) and (a)'s storage assertion fail. Record which cases pass at red; expect
   (e), (f) and (h).

   Then implement at `:83-105`:
   - make the three URL constants `let`;
   - keep the strip block unchanged, still conditioned on the URL values;
   - after it, add the key, `forgetEditLink()`, and a try/catch that stores
     `[STAGING_MODE ? STAGING_TOKEN : null, EDIT_SESSION_TOKEN]` when
     `(STAGING_MODE && STAGING_TOKEN) || EDIT_SESSION_TOKEN`, and otherwise restores (the staging
     token sets `STAGING_MODE`);
   - move `EDITOR_MODE` below the restore, keeping its Boolean comment.

   Reference shape (measured in research):
   ```js
   const EDIT_LINK_KEY = 'rcf_edit_link:' + SITE_ID;
   function forgetEditLink() {
     try { sessionStorage.removeItem(EDIT_LINK_KEY); } catch (e) {}
   }
   try {
     if ((STAGING_MODE && STAGING_TOKEN) || EDIT_SESSION_TOKEN) {
       sessionStorage.setItem(EDIT_LINK_KEY, JSON.stringify([STAGING_MODE ? STAGING_TOKEN : null, EDIT_SESSION_TOKEN]));
     } else {
       const kept = JSON.parse(sessionStorage.getItem(EDIT_LINK_KEY));
       if (kept) { STAGING_TOKEN = kept[0]; STAGING_MODE = !!STAGING_TOKEN; EDIT_SESSION_TOKEN = kept[1]; }
     }
   } catch (e) {}
   const EDITOR_MODE = !!((STAGING_MODE && STAGING_TOKEN) || EDIT_SESSION_TOKEN);
   ```
   The why-comment above it (house style) cites the ADR. It says why sessionStorage and not
   localStorage (bearer, unbound). It says why the strip still runs first, and why nothing is
   re-added to a URL. Tombstone: "memory-only was the s41 bug; every click through the site
   booted a visitor".
4. [x] **T4: clear on server refusal, and only then.** Tests first.
   - In `edit-link-persistence.test.ts`, with page 1 stored:
     - validate answers **401** on page 2 → key removed, `editMode === false`, the existing
       "Invalid or expired staging link." modal shown. Page 3 then makes no `/staging/validate`
       call.
     - The same for **403**.
     - **500** (`{ error }`) and a rejected fetch (network) → key kept.
   - In `src/__tests__/embed/editor-terminal-session.test.ts`, the owner boot already uses
     `rcf_staging=1&rcf_edit_token=owner-edit-token`:
     - add "a terminal 401/403 save forgets the edit link" (`it.each([401, 403])`);
     - add "a network failure keeps it".

   Red: the 401/403 cases fail (the key survives).

   Implement:
   - in `initStagingMode`, inside `if (!result.valid)` (`:987`), call `forgetEditLink()` when
     `response.status === 401 || response.status === 403`, before `showStagingError`;
   - in `handleTerminalWriteFailure`, call `forgetEditLink()` right after the 401/403 filter
     (`:1138`).

   Comment: 5xx or offline is our outage, not a verdict on the holder (the same reasoning as
   `:309-313`).
5. [x] **T5: Preview Live must not inherit the session.** Test first in
   `edit-link-persistence.test.ts`: in a staging boot, click `#rcf-preview-live`. Assert the
   `window.open` spy was called with `'noopener'` as its third argument, and that the URL
   contains no `rcf_` credential. Red: two arguments.

   Implement at `:2284-2289`. The minimum is adding `'noopener'`. Optionally, collapse the two
   no-op `searchParams.delete` calls to `window.open(window.location.href, '_blank', 'noopener')`
   (measured −12 / −11). Comment: per the HTML spec, an opener-bearing `window.open` copies
   sessionStorage, which would turn "live" preview into staging.
5b. [x] **T5b: the editor bar fits a phone (operator addition, 2026-09-25).** Found live after s39
   shipped: at 360px the grant-editor bar squeezes "You can edit this page" into four lines and
   truncates the email to "r…" (screenshot `.omx/qa-20260925/shots/5-site2-bar-360.png`, bar 104px
   tall). In the `#rcf-editor-banner` style block add one `@media (max-width: 480px)` rule that hides
   the claim span and its divider (give the claim span a class, e.g. `rcf-editor-banner-claim`,
   reusing the existing naming), so the email gets the room. Test in
   `src/__tests__/embed/editor-grant-edit-mode.test.ts`: the claim span carries the class and the
   injected stylesheet contains the media rule hiding it and the divider. No other rule changes.
   Count its bytes inside T6's itemised note.

6. [x] **T6: ratchet the gate.**
   - First rebase onto whatever has merged of s39 (PR #37) and s40, then rebuild.
   - Set `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` in `scripts/build-embed.mjs:110-111` and
     `SEEDED_MAX_BUNDLE_GZ` / `SEEDED_MAX_WIDGET_GZ` in
     `src/__tests__/embed/build-size-gate.test.ts` to the new measurement.
   - Add a dated note in both files itemising:
     - "dead email-capture modal: −N";
     - "`escapeHtml`: −N";
     - "edit-link persistence + clears + noopener: +M";
     - and the optional preview simplification.

     Research measured these on s39's tip: −399 / −396, −27 / −28 and +128 / +129; net
     −306 / −295. Record what the branch measures, not these numbers.
   - Red: the size-gate ratchet test fails against the old seed. Green after lowering.
   - **If the net is positive on either number, stop and report**; raising a ceiling is a defect.
   - `npm run build:embed -- --check` green; artifact committed.
7. [x] **T7: gates and delivery.**
   - Run `npm run precommit` (lint + type-check + jest), `npm run format:check`, `npm run build`
     and `npm run build:embed -- --check`, all green. Record outputs in the Execution log.
   - Re-read ADR 036 against the shipped code (key name, clear points) and fix drift.
   - Tick the story's boxes in `docs/stories.md` that are now true.
   - Commit once, `feat: keep edit links working across pages`, on `feature/s41-edit-link-multipage`,
     bringing research, plan, ADR and story entry. Draft PR; independent review (`/ks-review`)
     before merge.
8. [ ] **T8: proven live in production after deploy** (by `/ks-ship` or the operator, not the
   implementer).
   - On a multi-page site with the snippet:
     - Dashboard **Edit website** → click three internal links → the staging banner is present
       and text is editable on each page.
     - Save on page 3, then publish → the visitor view shows the text.
     - Reload → still editing.
     - **Preview Live** → visitor view.
     - Paste the site URL into a new tab → visitor.
   - Share link → click through → Staging banner on every page.
   - Revoke the share link in the dashboard → the next page load shows the expired modal once,
     then the visitor view.
   - Record evidence in `docs/reviews/s41-edit-link-multipage.md` or the ship notes.

**Test harness for `edit-link-persistence.test.ts`:** copy the shape of
`editor-terminal-session.test.ts:15-120`:
- `WIDGET_SOURCE` read from `public/embed/recopyfast.src.js`;
- `installScriptTag` with `data-site-id="site-abc"`, `data-site-token`, `data-api-url`;
- a recording `fetch` mock;
- `settle()`, then `new Function(WIDGET_SOURCE)()`.

`boot(url)` resets `document.head` and `document.body`, and deletes `window.ReCopyFast`,
`RECOPYFAST_API` and `RECOPYFAST_WS`. It then calls `history.replaceState(null, "", url)` and
re-installs the script tag and fetch. **It never clears sessionStorage.** Only `beforeEach` does,
together with localStorage. Spy on `window.open`, `console.*` and `window.alert` as the terminal
suite does.

## Run interdicts

- `public/embed/recopyfast.js` changes only via `npm run build:embed`, never by hand.
- `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` and the `SEEDED_*` pins only go down.
- No localStorage write, no cookie, and no URL (query, fragment, `pushState`/`replaceState`
  target) may carry `rcf_edit_link` data. The strip block at `:97-105` keeps its current condition
  and effect.
- The request credential paths stay exactly as they are: `editorTokenQuery`, `editorTokenBody`,
  `editorAuthHeaders`, and the `createEditorAuthClient` block between the `@rcf-editor-auth`
  markers. Their diff must be empty.
- No server, route or migration changes. This is a widget-only story. The exception is the T1
  test file.
- No new Playwright spec, and the count stays 44. `e2e/` diff empty, except an optional
  comment-only correction at `share-edit-publish.spec.ts:298`, stated in the PR.
- Do not weaken or delete existing tests. Only additions, plus the ratchet seeds.
- No SPA or `pushState`/`popstate` handling, no exit control, and no rewording of existing modal
  copy. All out of scope, and all cost bytes.
- No production access, merge or deploy from `/ks-execute`.

## The point everything turns on

The story stands on one judgement: an **unbound bearer token** may live in a tab's sessionStorage
because the server re-validates it on every load and write. Three places could make that wrong:

1. **The clear path fires on the wrong statuses.** Clearing on 5xx signs editors out during our
   outages. Never clearing on 401/403 leaves a dead token that shows a modal on every page. Compare
   with the validate route's statuses (`src/app/api/staging/validate/route.ts:47-58` 401; `:73-78`
   500) and the terminal filter (`:1138`).
2. **The restore changes what the URL-derived constants meant.** `EDITOR_MODE` is computed after
   the restore; the strip must still use the URL values, and an orphan `rcf_token` must still stay
   out of storage and public reads. Compare with `editor-grant-requests.test.ts:330-345` and
   `handoff-roundtrip.test.ts:254-283`.
3. **A new context inherits the session unintentionally.** Preview Live is the one widget-owned
   case. Host-page `window.open` without `noopener`, Duplicate Tab and session restore are
   accepted in ADR 036. The reviewer should check no other widget `window.open` lacks `noopener`
   (`:1192` already has it).

## Files touched

- `public/embed/recopyfast.src.js`: T2 deletions; T3 persistence at `:83-105`; T4 two clear
  calls; T5 Preview Live.
- `public/embed/recopyfast.js`: rebuilt.
- `scripts/build-embed.mjs`: ceilings and itemised note.
- `src/__tests__/embed/build-size-gate.test.ts`: `SEEDED_*` and note.
- `src/__tests__/embed/edit-link-persistence.test.ts`: new.
- `src/__tests__/embed/editor-terminal-session.test.ts`: two cases added.
- `src/lib/auth/__tests__/staging-access.device-binding.test.ts`: T1 guard.
- `docs/decisions/036-edit-link-credential-in-tab-session-storage.md`,
  `docs/research/s41-edit-link-multipage.md`, `docs/plans/s41-edit-link-multipage.md`,
  `docs/stories.md`: docs.
- Optional: `e2e/share-edit-publish.spec.ts:298`, comment only.

## Test strategy

- **jsdom, through the real widget source.** Multi-boot within one test simulates full-page
  navigation, with sessionStorage surviving between boots, as it does in a tab. This is the
  level the bug lives at, and the level every existing embed suite uses.
- **Unit, server.** T1 pins that `requiresEmail` is never emitted, so the widget deletion stays
  behaviour-free.
- **Byte gate.** `build-size-gate.test.ts`, plus `build:embed -- --check`.
- **Regression.** All 14 existing embed suites stay green unchanged. The research prototype
  already ran them green: 164/164.
- **No Playwright.** The 44 contract holds. The cross-page journey is proven live after deploy
  (T8), because the fixture server has one page and multi-page E2E is not in the contract.

## Definition of Done

- Every box above is ticked except T8, which is ticked after deploy.
- `npm run precommit`, `npm run format:check`, `npm run build` and `npm run build:embed -- --check`
  are green, and the artifact is committed and fresh.
- Gz net is ≤ 0 on both numbers after the rebase, and the ceilings are lowered to the measurement
  with an itemised note.
- ADR 036 matches the code.
- One story commit on `feature/s41-edit-link-multipage`, in a draft PR.
- `docs/reviews/s41-edit-link-multipage.md` ends `Ship allowed: yes` before merge.
- Deployed, and T8 evidence recorded.

## Execution log

2026-09-25, `/ks-execute`, worktree `.omx/worktrees/s41-edit-link-multipage`, branch
`feature/s41-edit-link-multipage` at `0e1d5bc` (origin/main, s39 merged). Base gate measurement
reproduced exactly: **46,226 / 33,465** (bundle / widget, gate method). `origin/main` has since
moved to `5a618f0` (s43: blog dates, /pricing redirect). It touches no embed file, so every byte
figure below holds; `docs/stories.md` will have a trivial tail conflict. s40 has not merged, so
there was nothing to rebase onto for T6; the operator directed that s40 conflicts are resolved
at merge by rebuilding.

- **T1.** The three `requiresEmail is never emitted` cases pass at red, as expected: they pin
  current behaviour. Mutation: `staging-access.ts` link-row branch made to return
  `{ requiresEmail: true, valid: true, … }` → "refuses an emailless link row" goes red (1 failed,
  8 passed), then reverted (`git checkout`, empty diff).
- **T2.** Red: the capture modal rendered (`#rcf-email-input` present). Deleted the
  `requiresEmail` branch (tombstone left), `showEmailCaptureUI` in full and `escapeHtml`.
  Measured separately: modal + branch **−398 / −394**, `escapeHtml` **−24 / −22** →
  45,804 / 33,049.
- **T3.** Red: (a) storage assertion, (b), (c), (d) failed. Green at red: (e) orphan, (f) other
  site, (h) grant (as the plan expected), and every (g) hostile-storage case, because the code
  under test did not touch storage yet, so the degraded outcome was today's behaviour. Proved
  (g) bites by mutation: without the outer try/catch, the getItem / setItem / getter / "not json"
  cases go red (4 failed). `{}` and `[1,2]` are no-throw guards (`[1,2]` lands in
  initStagingMode's catch). Persistence cost **+90 / +94**.
- **T4.** Red: validate 401/403 (key survived) and terminal 401/403 save. Green at red: 500 and
  network keep, because nothing cleared yet. Mutations: clearing on every `!result.valid` turns
  "keeps it through a 500" red; clearing before the terminal status filter turns "a 500 failure
  on save keeps the edit link" red. The terminal suite's keep-case therefore runs as
  `it.each([500, "network"])`: a network error never reaches `handleTerminalWriteFailure`, so
  the network case alone could not bite. A throwing `removeItem` is covered on both clear paths
  (validate: the refusal is still reported as a refusal; save: the terminal lock still lands).
  Mutation: an unguarded `removeItem` turns both red. Clears cost **+27 / +28**.
- **T5.** Red: `window.open` got two arguments. Took the optional collapse to
  `window.open(window.location.href, '_blank', 'noopener')`. Measured: `noopener` alone
  **−1 / −1** (gzip context), dropping the two no-op deletes **−8 / −11**.
- **T5b.** Red first on the missing class, then on the missing `@media` rule (asserted through
  the CSSOM: a `CSSMediaRule` for `(max-width: 480px)` whose `display: none` rule names both
  selectors). Cost **+26 / +24**.
- **T6.** Red: the ratchet test failed once the seeds were lowered first (`Expected: <= 45938,
  Received: 46226`). Green after lowering `MAX_*`. **Final 45,938 / 33,183, net −288 / −282**
  against 46,226 / 33,465. Both files carry the dated, itemised note.
- **T7.** `npm run precommit` exit 0: lint 0 errors (38 warnings, none in story files), type-check
  clean, jest **257 suites passed, 2 skipped; 3,390 tests passed, 39 skipped**.
  `npm run format:check` clean. `npm run build` exit 0 (prebuild rebuilt the embed at
  45,938 / 33,183; the "fetch failed" catalogue lines come from the CI placeholder env, as on
  main). `npm run build:embed -- --check`: up to date. ADR 036 re-read against the code: key,
  value shape, both clear points, keep-on-5xx/network, URL-wins, try/catch and `noopener` all
  match; no drift.
- **Test-isolation notes.** jsdom cannot unload a widget. An unlocked owner instance's
  document-level click handler answers the next test's clicks first. So the terminal suite's new
  cases sit last in their describe; placed before the Edit Board test, they broke it.
  `edit-link-persistence.test.ts`'s `boot()` locks the previous instance, as an unloaded page
  would be.
- **E2E.** Comment-only correction at `e2e/share-edit-publish.spec.ts:298` (the "plain visitor
  load" is a credentialed load in the same tab since s41). Assertions untouched; no spec added.
- **Deviations.** The commit message is the operator's `fix: edit links keep working across pages
  in the same tab`, not the plan's `feat: …`. No push and no draft PR (operator directive). The
  story checkbox "Required gates pass; independent review before merge" stays unticked until
  review, and "Proven live" stays unticked (T8).

