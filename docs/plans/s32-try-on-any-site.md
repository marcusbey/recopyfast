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

The existing independent review allows shipping and remains unchanged and uncommitted.
Full 43-case disposable-stack execution is owned by PR CI; local evidence is the
preview browser fixture plus the full collected inventory.
Host CSP may reject the loader origin or inline style; browser-internal pages,
closed shadow roots and cross-origin frame contents are not editable by this script.
The fallback is /try's scoped sample. Images accept embedded raster data URLs and local raster files via FileReader to
honor the no-network instruction; remote image URLs remain rejected.
Exit stops editing and clears chrome; saved preview DOM persists until refresh.
Do not merge, mark ready, or deploy from this lane.
