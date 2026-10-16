# s114 browser acceptance

Passed against the local implementation preview on October 16, 2026. Production deployment remains outside this story's current execution step.

- Homepage: approved cream/teal editorial composition, corrected hand, serif hero with exactly three lines at 390px and desktop.
- Animation: visible small curved cursor; site→website before stuck→done; dashed hover, click, selection, caret and typing; runs once.
- Interruption: click headline during first/second pass; enter custom text; it must survive after the remaining animation time elapses.
- Editing: all three headline lines and two supporting-copy lines keyboard/touch editable; plain-text paste, no injected markup/new lines; caret remains usable, IME supported.
- Reload: restores original text; no hint/reset/replay controls. No saved visitor content.
- Reduced motion: static editable headline; no cursor animation.
- Real demo: immediately below hero; edit real sample site text, save/reset; retain all demo layouts and /demo route.
- Route preservation: /product old landing, pricing catalogue and features anchors intact; new homepage retains /#pricing and /#features.
- Navigation: login/signup state, mobile menu, footer legal/tools/install links and cookie settings intact.
- Safety: no horizontal overflow, no console exceptions, no customer-data writes; unknown pricing is not represented as free.

## Parent browser observations — October 16

Verified on local Next preview port4320: editorial homepage renders with corrected illustration; hero changes site→website then stuck→done; visitor headline/supporting text editing works; reload restores original; existing BellaVista demo headline changed, saved visibly, and reset; /product renders prior rotating-headline landing and functional demo with Product overview title and /product canonical. Mobile390/320 completed headline remains three lines with no document horizontal overflow. Mobile menu opens/closes. Screenshots s114-desktop.png and s114-mobile.png.

Initial middleware configuration failure was fixed before these observations. Browser extension warnings observed separately; no product exception found in the sampled final logs. Automated IME/visibility/unmount verification and full test/build gates belong to implementation/review reports; not inferred from screenshots.

Final verification added: the editorial pricing variant renders the catalogue with flat cream/teal controls and no legacy sky/glass/gradient treatment; the Pricing header anchor updates the hash and scrolls the section to the viewport. Automated gates passed: 537 suites passed (2 skipped), 8,021 tests passed (38 skipped), lint reported 0 errors and 33 pre-existing warnings, type-check and type-check:build passed, format:check passed, and the production build completed.

Final visual follow-up: editorial Pricing now uses flat cream/teal cards and controls. Header Pricing link settles at the pricing section (scroll4057.5, targettopapproximately0). Saved s114-pricing.png. Legacy /product default styling remains separate.

## Responsive hero regression — October 16 follow-up

The reported hidden clipping was reproduced with a browser-level box measurement. Before the repair, the completed first line at 901px had `scrollWidth: 376` inside a `clientWidth: 351` editable line. Extending the same check to all authored hero copy also caught the second supporting line at 320px (`341 > 282`). The page itself did not overflow in either case because each contenteditable hid its own horizontal scrollbar.

The focused Playwright check now measures all three headline lines and both supporting lines in their authored and completed (`website` / `done`) states at 320, 390, 901, 1024, 1100, 1440 and 1920px. Every stock line satisfies `scrollWidth <= clientWidth`; the document also remains within its viewport. A separate assertion preserves the intended behavior for visitor-written copy: a 120-character custom headline stays on one horizontally scrollable line instead of wrapping into a fourth line or forcing unreadably small type. The existing component suite remains the timing/order proof for the real site → website → stuck → done animation; the browser geometry check deterministically installs those exact completed words so it does not depend on headless Web Animations scheduling.

Fresh production output was rebuilt and served on port 4321 before final capture. At 1024px, completed headline boxes are 901/901px; at 320px they are 282/282px, the longer supporting line is 276/276px, and document width is 320/320px. Saved `s114-responsive-1024.png` and `s114-responsive-320.png`.

Final focused evidence: E2E-011 passed; EditableEditorialHero Jest passed 11/11; targeted ESLint and Prettier passed; `npm run type-check` passed; the final `npm run build` completed successfully.
