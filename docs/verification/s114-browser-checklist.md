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
