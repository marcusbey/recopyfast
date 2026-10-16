# s115 browser verification — editorial demo and blog

Date: 2026-10-16

Preview: `http://127.0.0.1:4332` from the final production build. This is a local preview only;
no deployment or publication mutation was performed.

## Demo behavior

- The production preview rendered the editorial Header and Footer around one real
  `InteractiveHero` with all three sample-site tabs.
- Playwright selected the current site's stable `brand` editable, changed “Premium Auto Spa” to
  “Premium Auto Studio”, activated **Save changes**, and observed “Saved — ready to publish”.
- The demo reload control restored “Premium Auto Spa”, proving the local edit/save/reset journey.
- The existing focused suites separately proved text/image editing, focus, touch behavior, nested
  scrolling, and attract-loop cancellation without a site id, token, storage or API dependency.

## Responsive checks

At 320, 390, 768, 1280 and 1440 CSS pixels, `/demo` and `/blog` both reported document
`scrollWidth === clientWidth`. The demo surface also reported its own `scrollWidth === clientWidth`
at every width, so its nested working area stayed within the available editorial frame.

Final screenshots:

- `output/playwright/s115/demo-final-1440.png`
- `output/playwright/s115/demo-320.png`
- `output/playwright/s115/demo-390.png`
- `output/playwright/s115/demo-768.png`
- `output/playwright/s115/demo-1280.png`
- `output/playwright/s115/demo-1440.png`
- `output/playwright/s115/blog-empty-final-1440.png`

## Blog states and article limit

The production preview truthfully showed the empty state because the configured data source had no
published rows. Populated, filtered, read-error, draft/archived exclusion and article rendering were
verified with the schema-strict repository fixtures. The article suite also exercised a long title,
allowed rich content, deterministic metadata, canonical generation and hostile script/event/URL
attributes through the existing `RICH_TEXT` sanitizer.

No representative article screenshot was captured because there is no deliberately published row,
and the repository article remains `status: draft` / `publication: not-approved`. Publishing it or
adding a production-visible fixture would cross the story's explicit boundary.

## Automated evidence

- Focused s115 routes/components: 4 suites, 29 tests passed.
- Preserved demo/discovery/consent boundaries: 8 suites, 194 tests passed.
- ESLint: 0 errors and 33 pre-existing warnings.
- TypeScript application and production checks passed.
- Prettier check passed.
- Production build passed; embed remained within its existing ratchet ceilings.
- Full Jest: 537 suites passed (2 skipped), 8,025 tests passed (38 skipped).
