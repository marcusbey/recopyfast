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
- [ ] 6. Inspect final diff, record exact evidence and limitations here, retain
  review placeholder, commit, push branch, open DRAFT PR with Why / What changed /
  Decisions / Verification / Risk & rollback. Do not merge, ready or deploy.

## Decisions

No new dependencies or SQL. No production service calls. Images default to embedded
raster data URLs under the no-network requirement with the no-network default retained because no image-request exception was authorized. Unsupported CSP and browser-internal pages use the sample
fallback; "any site" describes the target experience, not a CSP bypass guarantee.

## Verification evidence

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

## Remaining boundaries

Formal review stays `pending independent review`. Full 40-case disposable-stack
execution is owned by PR CI; local evidence is the added fixture plus full inventory.
Host CSP may reject the loader origin or inline style; browser-internal pages,
closed shadow roots and cross-origin frame contents are not editable by this script.
The fallback is /try's scoped sample. Images accept embedded raster data URLs to
honor the no-network instruction; remote image URLs would need explicit authorization.
Exit stops editing and clears chrome; saved preview DOM persists until refresh.
Do not merge, mark ready, or deploy from this lane.
