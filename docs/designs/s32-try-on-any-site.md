# s32 — Design note

Source: `docs/design-system.md`, existing Header/Footer and /demo marketing page.
Use the pinned-light marketing slate/sky palette, Bricolage display heading,
Instrument body, max-w-6xl and 4px spacing rhythm. Reuse Button/Card where suitable.

/try: Header → headline "See your site editable in one click" → concise local-only
promise → draggable bookmarklet → three desktop browser instructions + mobile
"use desktop" → a sample website edited by this exact preview runtime → CSP
fallback explanation → trial CTA → Footer. Add "Try your site" to both nav sizes.
No elaborate new design language or animations.

The embedded sample can be an isolated same-page region marked for runtime scope;
this avoids relaxing the existing frame-src/frame-ancestors policy for an iframe.
Activation loads the same script locally and scopes edits to the sample, never
turning the marketing navigation into editable content. Include restart/reset.

Preview chrome uses the real widget's compact white floating panel, dark text,
teal Save action and thin outline. System fonts only on host sites, one namespaced
style element. Top bar includes the exact preview disclaimer, signup CTA and Exit.
Toolbar: text editing Save/Cancel; image mode labelled URL input and Replace image;
inline validation/status, including "Published (preview)". All controls keyboard
reachable; Escape cancels; viewport-clamped panel and wrapping narrow top bar.

States: inactive, hovering, editing, published preview, invalid image URL, exited,
and load/CSP failure with a visible link back to the sample. No backend loading
state. CSP-blocked scripts cannot report their own failure: loader offers a fallback
when possible and /try explains it regardless. Strict style CSP may prevent chrome.

Design gap: React components cannot be embedded dependency-free on third-party
pages. Reproduce the widget's small chrome with namespaced DOM/CSS and system fonts;
no new app primitive. Image URL policy follows the explicit no-network constraint
until clarified by the user.
