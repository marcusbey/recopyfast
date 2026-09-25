---
validated: yes
validation: operator-prevalidated scope and decisions in user instruction, 2026-09-24
---

# s32 — Try on any site

Branch: `feature/s32-try-on-any-site`. User explicitly authorizes compressed pipeline,
implementation, commit, push and draft PR; independent review remains pending.

## Tasks

- [x] 1. Test-first standalone preview runtime in `public/try/rcf-try.js`, jsdom
  tests under `src/__tests__/try/`: supported scan targets, Alt navigation,
  hover/click editing, Save/Cancel, plain-text paste/drop, image toolbar validation,
  status, Exit cleanup, repeated injection and zero transport calls. Single style,
  no dependency, gzipped <=8192 bytes (gate in test). Preserve original nodes on
  Cancel and remove only owned UI/attributes. No production embed modification.
- [x] 2. Test-first /try server page + minimal client bookmarklet/sample controls,
  marketing nav and sitemap. Metadata follows public pages. Versioned canonical
  script URL, no registration, browser instructions, mobile desktop message,
  CSP fallback and trial CTA. Test actual javascript href after mount. Sample uses
  the same runtime, scoped through a script data attribute pointing to its root.
- [x] 3. Test-first exact /try/rcf-try.js auth bypass and static headers; keep all
  A-24 guards. Include /try public page in sessionless routing if needed to avoid
  unnecessary auth dependence. No broad wildcard bypass of protected routes.
- [x] 4. One Playwright test loads a local fixture, injects runtime and edits a
  heading; verify save/cancel/exit/no transport where practical. Update all active
  exact inventory contracts 39 -> 40 (including CI/reporter regression guards).
- [x] 5. Run targeted tests then `npm run precommit`, `npm run build`,
  `node scripts/build-embed.mjs --check`, `npm run audit:prod`, production typecheck,
  changed-file formatting and browser check. CI placeholders only. Report any
  inherited formatting failures without mass-formatting unrelated files.
- [x] 6. Inspect final diff, record exact evidence and limitations here, preserve
  the independent review unchanged and uncommitted, commit, push branch, retain DRAFT PR #27 with Why / What changed /
  Decisions / Verification / Risk & rollback. Do not merge, ready or deploy.

## Decisions

No new dependencies or SQL. No production service calls. Images default to embedded
raster data URLs under the no-network requirement with the no-network default retained because no image-request exception was authorized. Unsupported CSP and browser-internal pages use the sample
fallback; "any site" describes the target experience, not a CSP bypass guarantee.

## Pre-share fix scope (operator-validated 2026-09-24)

The operator explicitly approved review items 1–11 for this fix run. Preserve
`docs/reviews/s32-try-on-any-site.md` byte-for-byte and leave it uncommitted.

- Capture click and keyboard activation before host handlers/default navigation;
  preserve click-point caret placement and inline formatting while editing text nodes.
- Use a stable script URL and short, revalidated caching; restore social metadata and
  the sample's design-system marker, and remove its static-panel shadow.
- Add real-browser request/WebSocket observation for injection through Exit, nested
  interactive targets, raster validation, local FileReader images and body-swap recovery.
- Keep every existing test guard and synchronize every active exact browser count
  with the final collected inventory, including `server/README.md`.
- Merge current `origin/main`, rerun the requested gates, then commit `fix(s32): ...`,
  push and retain draft PR #27. No deployment, production access or migrations.

## Verification evidence (initial implementation)


- `npm run setup`: root and server installed successfully; both reported zero advisories.
- Test-first: initial runtime tests failed because the script was absent; runtime is now
  14/14 green. Page/delivery/header/contract targeted checks are 61/61 green.
- Final-source full `npm run precommit`: passed; lint 0 errors / 39 inherited
  warnings, TypeScript passed, Jest 214 passed suites / 1 inherited skipped suite,
  2,762 passed tests / 36 inherited skipped tests / 0 failed. Run in an isolated
  Node 20.20.2 container with the exact CI main-job placeholder values and two CPUs.
  No environment file was copied. The container has no database, matching CI main.
- Host baseline run found an existing shared-local-database grant invariant failure:
  `update_translation_coverage(uuid) -> authenticated`. This story does not alter
  that database or its test. The shared DB is not the isolated CI gate environment.
- `npm run build`: passed; /try is statically prerendered.
- `npm run type-check:build`: passed. `npm run format:check`: passed.
- `node scripts/build-embed.mjs --check`: fresh; bundle 46,480 <= 46,681 bytes,
  widget 33,707 <= 33,865 bytes, transport 13,122 bytes. Production embed unchanged.
- Preview gzip (Node gzipSync level 9): 4,462 bytes, below 8,192-byte test ceiling.
- `npm run audit:prod`: zero vulnerabilities.
- `CI=true npx playwright test e2e/try-preview.spec.ts --reporter=line`: 1/1 passed.
- `CI=true npx playwright test --list --reporter=list`: 40 tests in 10 files.
  All active strict-count contracts changed 39 -> 40; old tests retained.
- Chromium against the production build: hydrated canonical/versioned bookmarklet;
  scoped sample Save/Published/Exit/Reset; 390px viewport without horizontal overflow.
  Actual bookmarklet loader tested with intercepted local script response: double
  invocation loads once, heading edit succeeds, blocked load shows focused visible
  fallback. No production request used in that test.
- Production-mode local HTTP GET/HEAD: script 200, application/javascript,
  immutable cache, Access-Control-Allow-Origin *, and nosniff.
- Bounded fresh-context integration verification found no remaining functional or
  privacy findings; this is not the independent pipeline review verdict.
- Markers flipped: none (A-24 was already fixed). Migrations: none.

## Pre-share fix verification (2026-09-24)

- Merged `origin/main` at `9f22598`; merge commit `961ac4c`. The only conflict was
  the appended story list, resolved by retaining all stories. Refetched before commit;
  `origin/main` remains an ancestor of this branch.
- `npm run precommit -- -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`:
  passed; lint **0 errors / 39 inherited warnings**, full TypeScript clean,
  Jest **214 passed suites / 1 inherited skipped suite; 2,792 passed tests /
  36 inherited skipped tests / 0 failed**. CI main-job placeholder environment only;
  no environment file copied and no production service used.
- `npm run build`, `npm run type-check:build`, `npm run format:check`: passed.
- `node scripts/build-embed.mjs --check`: fresh; production embed unchanged.
  Node 24.14.0 gzip-9: bundle **46,604 <= 46,681 B**, widget **33,828 <= 33,865 B**,
  transport **13,141 B**. Preview runtime **5,584 <= 8,192 B**.
- `npm run audit:prod`: **0 vulnerabilities**.
- `CI=true npx playwright test e2e/try-preview.spec.ts --reporter=line --retries=0`:
  **4 passed / 0 failed / 0 skipped / 0 retried**. Real clicks and keyboard input
  prove linked-heading caret placement, preserved bold markup, nested interactive
  ancestor isolation and button Space/Enter isolation through all key phases.
- Browser request/WebSocket recording starts before injection and spans text save,
  a valid local PNG FileReader replacement (decoded naturalWidth > 0), and Exit.
  Exactly the intercepted script request is allowed. Temporarily inserting an image
  beacon made this test fail with the extra request; it was aborted locally, the
  mutation was removed, and the final four tests passed.
- Runtime unit suite: **20/20**, including rejected SVG/javascript data URLs,
  rejected local SVG, unchanged inline nodes, Cancel identity restoration, stale
  FileReader callbacks, file-change isolation, and body-swap resume.
- `CI=true npx playwright test --list --reporter=list`: **43 tests in 10 files**.
  All active inventory pins, including server README, match 43 (rather than 40,
  because three new browser cases were added). No guard test removed or weakened.
- Production-mode local HTTP: stable and legacy query URLs return **200**, correct
  JavaScript MIME/CORS/nosniff, **max-age=0, must-revalidate**, ETag, no Set-Cookie;
  matching If-None-Match returns **304**. Rendered /try includes og:image,
  twitter:image, og:site_name and og:locale.
- A Chromium probe executed the actual hydrated bookmarklet, replaced the host body,
  reinvoked the bookmarklet, edited the new heading and exited with zero preview UI.
- Fresh-context fix verification: **APPROVE, 0 findings**; focused **39 Jest tests /
  5 suites**, **4 Chromium cases**, full TypeScript and changed-file ESLint passed.
  This verification did not replace or edit the independent review document.
- The independent review's SHA-256 remains
  `616728bde0c50a0f4fa17e0787d87c38704702cb070642fd3d35c642d536e17b`.
  It remains uncommitted. Failing markers flipped: **none** (none in this scope).
  Migrations/dependencies added: **none**. PR #27 remains draft; no deployment.

## Remaining boundaries

The independent review remains unchanged and uncommitted. This pass is limited to
fixes and a draft PR update; final independent sign-off remains a separate step.
Full 44-case disposable-stack execution is owned by PR CI; local evidence is the
preview browser fixture plus the full collected inventory.
Host CSP may reject the loader origin or inline style; browser-internal pages,
closed shadow roots and cross-origin frame contents are not editable by this script.
The fallback is /try's scoped sample. Images accept embedded raster data URLs and local raster files via FileReader to
honor the no-network instruction; remote image URLs remain rejected.
Exit stops editing and clears chrome; saved preview DOM persists until refresh.
Do not merge, mark ready, or deploy from this lane.

## Fix mode 2 — operator-prevalidated 2026-09-24

Preserve the uncommitted independent delta review byte-for-byte (SHA-256
`811f2159658e03e8bc45abb451a65a10dde767d23011f1abae986f7e7b1cf2f0`).
The user's explicit D1–D8 instructions validate this bounded plan.

- [x] D1: test-first normal navigation and hover for WordPress/Bootstrap/mega menus;
  only Alt+click edits link labels; link-only wrappers never hijack plain clicks.
- [x] D2: bound interactive-ancestor suppression at nearest block container or four
  levels, excluding body/root; preserve controls outside the edited element.
- [x] D3: plain-text paste/drop applies to every descendant of the active edit.
- [x] D4: resume removes cloned stale preview UI before restoring the live bar.
- [x] D5: keep native Space/Enter/undo/IME for ordinary text; only intercept activating
  button/link labels, and never hand-insert during composition.
- [x] D6: add a behavioral guard sensitive to moving window capture to document.
- [x] D7: reject files above 5 MiB before reading, with distinct size and empty/corrupt
  messages; prove valid raster still works with zero network.
- [x] D8: synchronize all active browser inventory pins and QA register with collection.
- [x] Run focused Jest and real Chromium regressions, full precommit, build, format,
  production typecheck, embed freshness/budgets, audit; independent bounded verification.
- [x] Commit `fix(s32): ...`, push to existing draft PR #27 and refresh its evidence.

No new dependency, SQL, deployment, merge of the PR, or review-file modification.
Existing guard assertions remain; explain any fixture adaptation required by D2.
The D2 browser fixture keeps its original zero-host-click assertion by placing the
editable heading directly inside the clickable card anchor. Separate DOM tests cover
the new stop boundary with a generic block-level `onclick`, a fifth ancestor, and body.

## Fix mode 2 verification (2026-09-24)

- Merged `origin/main` at `e43010a` (PR #23) via `4fbff04`; story-list conflict
  resolved by keeping both s29 and s32. No production operation or remote DB access.
- All commands used Node 24.14.0 and only the 17 main-job placeholder variables
  parsed from `.github/workflows/ci.yml`; no `.env` copied or inherited service keys.
- `npm run precommit -- -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`: exit 0;
  lint **0 errors / 39 inherited warnings**; full TypeScript clean; Jest **219 passed
  suites / 2 inherited skipped suites; 2,865 passed / 38 skipped / 0 failed tests**.
- `npm run build`, `npm run type-check:build`, `npm run format:check`: passed.
  Changed runtime/browser/config files also pass targeted `prettier --check`.
  Existing Markdown formatting outside the repository format gate is retained to
  avoid unrelated reformatting. `git diff --check`: clean.
- `node scripts/build-embed.mjs --check`: fresh; bundle **46,604 / 46,681 B**,
  widget **33,828 / 33,865 B**, transport **13,141 B**. Preview gzip-9 **6,662 / 8,192 B**.
  Production embed unchanged. `npm run audit:prod`: **0 vulnerabilities**.
- `CI=true npx playwright test e2e/try-preview.spec.ts --reporter=line --retries=0`:
  **5 passed / 0 failed / 0 skipped / 0 retried** in Chromium. Includes WordPress,
  Bootstrap, mega-menu links, wrapper padding, native ordinary-text undo, activating
  labels, empty/corrupt local-file errors and valid image decoding with zero network
  beyond the intercepted runtime request. `--list --reporter=list`: **44 in 10 files**.
- Runtime Jest **29/29**; CI/reporter contract Jest **18/18**. Initial red run had
  six expected failures; CSS block-boundary and button-insertion corrections were
  also observed red before repair. Moving the click listener to document made D6
  fail (two document-capture calls); restored window capture passes.
- Fresh-context bounded functional verification: **no remaining D1–D8 findings**;
  independent rerun **3 Jest suites / 40 tests** and **5 Chromium cases** passed.
  This does not replace or alter the user's independent delta review.
- All active browser pins now say **44**, including QA register, server README and
  Supabase README. Historical dated evidence and review documents remain historical.
- Failing markers flipped: **none** (none in scope). Migrations/dependencies: **none**.
  The migration arriving through the main merge belongs to PR #23, not this fix.
- Review file hash remains **811f2159658e03e8bc45abb451a65a10dde767d23011f1abae986f7e7b1cf2f0**;
  it remains unmodified by this lane and uncommitted. Draft PR #27 is retained.
  Full disposable-stack execution belongs to PR CI; no merge, ready or deployment.

## Fix mode 3 — operator-prevalidated 2026-09-24

The operator approved E1–E6. Preserve the review byte-for-byte and uncommitted
(SHA-256 `c2480df9660cb2c6367d363a5834571e5416630d0e86961a4b86b85394768b73`).

- [x] E1: every link navigates on a plain click; Alt+click (Option+click on macOS)
  edits its text. Align story, design, /try copy and preview hint. Pin CTA links,
  `p > a.button` and content `li > a` in tests.
- [x] E2: while editing, block navigation through an ancestor link of the edited
  element using a bounded walk from that element only. Restore and verify the
  Bootstrap `a > div.card-body > h3` fixture without weakening host-handler guards.
- [x] E3: releasing Alt or blurring clears link hover outlines.
- [x] E4: resume cleans cloned editing/hover attributes so Exit leaves no cloned
  edited element contenteditable. Preserve host-owned attributes.
- [x] E5: pin the no-nav mega-menu LI guard with a mutation-sensitive test; replace
  the 25 ms image delay with actual decode/event completion.
- [x] E6: merge origin/main, preserve all stories, synchronize active Playwright
  inventory counts and run gates. Commit `fix(s32): ...`, push, retain draft PR #27.

No review verdict changes, dependency additions, new migrations or deployments.
Earlier verification sections are historical; the evidence below will record this pass.

## Fix mode 3 verification (2026-09-24)

- Merged `origin/main` at `300548a` (PR #25) in `cb79ad1`; retained every
  story entry. Two billing migrations arrived from main; this fix adds none.
- Node 24.14.0; commands used a clean environment with exactly the main-job
  placeholder values parsed from `.github/workflows/ci.yml`. No `.env` copied,
  production service accessed, migration applied, or dependency added.
- `npm run precommit -- -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`:
  passed; lint **0 errors / 39 inherited warnings**, full typecheck clean, Jest
  **221 passed suites / 2 skipped suites; 2,922 passed / 38 skipped / 0 failed**.
- `npm run build`, `npm run type-check:build`, `npm run format:check`: passed.
  `npx prettier --check public/try/rcf-try.js e2e/try-preview.spec.ts` and
  `git diff --check`: clean.
- `node scripts/build-embed.mjs --check`: fresh; bundle **46,604 / 46,681 B**,
  widget **33,828 / 33,865 B**, transport **13,141 B**. Production embed unchanged.
  Preview gzip-9 (Node): **7,345 / 8,192 B**.
- `npm run audit:prod`: **0 vulnerabilities**.
- `npx jest --runInBand --forceExit src/__tests__/try/rcf-try.test.ts
  src/__tests__/integration/try-page.test.tsx`: **2 suites / 40 tests passed**.
- `CI=true npx playwright test e2e/try-preview.spec.ts --retries=0 --workers=1
  --reporter=line`: **5 passed / 0 failed / 0 skipped / 0 retried**.
  `CI=true npx playwright test --list --reporter=list`: **44 tests in 10 files**;
  all active CI/config/reporter/test/documentation pins remain 44.
- E1 updates the intended gesture for linked headings/inline anchors to Alt;
  precise caret insertion and inline node/HTML assertions remain. The restored
  static Bootstrap fixture is `a > div.card-body > h3`, with Alt starting the
  heading edit and plain clicks on the heading and card body remaining isolated.
- Disabling either the no-nav LI+submenu rule or the bounded ancestor-link
  suppression made its respective regression fail; both changes were restored.
  The LI guard preserves ordinary prose-list editing. The image guard now awaits
  its actual mocked decode callback rather than a fixed sleep.
- Fresh-context bounded verification found no remaining functional findings.
  Failing markers flipped: **none** (none in scope). New migrations: **none**.
- Review SHA-256 remains
  `c2480df9660cb2c6367d363a5834571e5416630d0e86961a4b86b85394768b73`;
  preserved byte-for-byte and left uncommitted.
- Full disposable-stack 44-case execution is checked in PR CI after push; local
  Docker context was unavailable. No merge of the PR, ready transition or deployment.
