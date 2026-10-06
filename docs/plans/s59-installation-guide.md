---
story: s59-installation-guide
validated: yes
---

# Installation guide implementation plan

## Outcome

Ship a public `/docs/install` guide and a copyable/downloadable agent brief based
on the reviewed copy. Make both easy to find from the footer and site Installation
card. Keep dashboard recipes consistent with actual widget limitations.

## Tasks

- [x] 1. Put the approved guide and agent brief in one shared typed content module
  (`src/lib/docs/installation-content.ts`). Build the example using
  `buildEmbedScript` with obvious placeholders and explicit production origins.
  The design copy becomes a historical specification; runtime page and export
  read the shared module so agent instructions cannot drift between formats.
- [x] 2. Implement `/docs/install` as a server-rendered page using existing app
  tokens/primitives. Add a small client copy control with success/failure feedback
  and a selectable fallback. Expose the same brief at
  `/docs/install/agent-instructions.md` as plain text with a download link.
- [x] 3. Link the guide from the public footer and site Installation card. Correct
  `install-recipes.ts` React/Next.js wording and test its shared consumers so they
  no longer imply that inserting a root-layout script completes SPA integration.
- [x] 4. Add focused tests for snippet generation parity, optional WebSocket
  wording, public page/agent export consistency, navigation links and clipboard
  success/failure. Keep the existing browser-test count contract unchanged unless
  a separately justified CI change is required.
- [ ] 5. Run targeted tests, lint, full type-check, format:check, build and Jest.
  Verify the public page without auth, mobile/desktop readability, keyboard
  navigation, section links and clipboard fallback in a real browser. Obtain a
  fresh independent review and record the mechanical ship verdict.
- [ ] 6. Open the story PR with validation evidence. Follow manual merge policy;
  after the approved merge/deployment, verify the public URLs and dashboard link.
  Do not report a local preview as a published documentation page.

## Boundaries

No new dependencies, no changes to authentication, editing, billing or the embed
bundle, no credentials in public examples, no installations on customer sites.
Platform guidance describes capabilities and verified caveats, not untested
compatibility promises. No new account or paid action is required to read docs.

## Acceptance evidence

The user can obtain the correct snippet from Sites, understand exactly where it
belongs, choose page scope, hand an agent the downloadable brief, and distinguish
installation detection from a completed invited-editor publishing test.

## Review repair evidence

- A regression test first failed because the canonical agent brief advertised a
  magic-link alternative. The brief now requires the actual six-digit emailed
  code, and the documentation plus editor request/submit-code regression set
  passes 40/40 tests.
- The public page now uses app semantic tokens, Instrument Sans at weight 600 and
  JetBrains Mono for code. Production-browser checks at 1440×1000 and 390×844
  show no horizontal page overflow. Screenshots are under
  `output/playwright/s59-installation-guide-review/`.
- Fresh Node 24 gates pass: lint has zero errors and 35 inherited warnings;
  format, both TypeScript checks and the production build pass; full Jest and
  coverage each pass 314 suites / 4,041 tests with the existing 2 suites /
  38 tests skipped. Coverage is 63.82% statements and 64.44% lines.

## Validation checkpoint

The repository requires `validated: yes` to be set only after human plan approval.
Validated by the user on 2026-10-03: "looking good. let's integrate that".
The approval authorizes tasks 1–5 and preparation of the PR. Source merge remains
governed by the repository's manual strategy.
