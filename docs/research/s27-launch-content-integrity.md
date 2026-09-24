# Research — s27-launch-content-integrity

## Verified premise

A-14: `public/embed/recopyfast.src.js` computes stable IDs from structural paths, with a verbatim `data-rcf-id` escape hatch. The audit suite extracts these real helpers and reproduces collisions across identical templates.

A-26: `src/app/api/staging/content/[siteId]/route.ts` writes text and ignores href/alt. Its GET selects metadata but detects changes only by text. Public content GET already selects metadata. Widget hydration handles alt but skips equal-text rows and never applies href.

## Storage and lifecycle

`20250817000000_complete_database_setup.sql` declares `content_elements.metadata JSONB`. `20251230000000_staging_workflow.sql` declares staging_history with text snapshots but no attribute snapshots. `20260803020000_restore_atomic_publish.sql` publishes only text-different rows. `20260805120000_reconcile_create_content_version.sql` snapshots text; `20260804150000_reconcile_restore_content_version.sql` restores text to staging. Both must include attributes for a coherent restore. New SQL is forward-only, idempotent, service-role grants per 20260805190000. No remote application.

## Design constraints

Keep published href/alt at metadata top level. Store pending attribute patches under metadata.staging_attributes; staging GET overlays these, public GET strips them. Publishing merges pending attributes and clears the pending key. Discovery captures authored href/alt as the baseline so restoring the original version is meaningful. History gains previous_metadata/new_metadata JSONB snapshots. Version snapshots gain attributes, restored to staging only, preserving old snapshot behavior when attributes are absent.

Shared validator contract: trim, cap href at 2048 characters and alt at 2000; reject non-strings except omitted extras (widget sends null alt for background images, treat null as omitted), control characters/backslash and non-allowlisted schemes. Client hydration must use equivalent defense. Empty string is a valid intentional attribute edit.

## Traps and scope

Do not leak pending href/alt to public readers. Attribute-only changes must publish even when text is identical. Preserve unrelated metadata. Existing ID keys remain opaque to consumers; verify all paths. No legacy ID fallback, no backfill. Existing unrelated audit failing markers stay untouched. All testing uses CI placeholders or disposable loopback-only databases.

## Open verification

Cross-path opaque ID audit and local SQL execution to be recorded with validation results. Independent review remains pending. Complexity 4, matching story; keep both findings together because they ship one widget.

## Completed ID consumer audit

Discovery upserts in `src/app/api/content/[siteId]/route.ts` use `(site_id,element_id,language,variant)` and ignore existing duplicates; new page-scoped keys naturally create separate rows. Widget hydration uses the computed ID map. Dashboard `src/app/api/sites/[siteId]/content-elements/route.ts` and `src/app/dashboard/content/page.tsx` consume opaque IDs. There is no persisted page/url column or field; per user instruction, dashboard display is unchanged. Optional socket discovery carries a URL, but the HTTP persisted payload does not.

`src/app/api/bulk/{export,import,update}/route.ts` preserve opaque element keys (import keys include language/variant); JSON/CSV/XML export includes metadata. `src/app/api/ab-tests/active/[siteId]/route.ts` returns target_element_id; creation/generation stores that same opaque key. `src/app/api/ab-tests/track/route.ts` tracks test/variant IDs, independent of page hashes. `src/app/api/v1/content/route.ts`, edit-board languages and styles also use opaque IDs. No consumer parses the old hash or requires a separate page lookup. Legacy QA A/B targets may orphan along with content rows, accepted by D2.

Design phase: no new UI; dashboard page display is intentionally omitted because the requested existing page field is absent.

## Baseline evidence

Setup completed for root and server; no env files copied. Base is a9e3f21. The two scoped audit suites initially passed 24 cases with expected-failure markers intact. Lint baseline: 0 errors, 39 warnings. Production audit: zero vulnerabilities. Initial Node 25 baseline (zlib level 9, not accepted as CI byte evidence): bundle 46,480 / 46,681 maximum; widget 33,707 / 33,865 maximum; transport 13,122 bytes. Global formatting check only reported the two audit test files during their in-progress test additions.

Further lifecycle inspection found the publish-preview GET compares text only. Include attribute changes there and clear draft attributes on revert, so UI preview and discard agree with publish.

## Migration integration note

`20260924010000_content_attributes_lifecycle.sql` replaces publish/create-version/restore/revert bodies to carry attributes, retaining existing function signatures and old element_id snapshot shape. The separate A-15/A-16/A-23 lane also changes version RPCs: merge must reconcile both bodies so whichever migration runs last retains both repairs. This lane does not mark those other findings resolved. Staging save keeps the inherited update-then-history sequence; an audit insert failure now returns 500, though the draft update may already have persisted.

## Embed byte budget

Final Node 20.15.1 / Node 24.14.0 generated artifact measurements: bundle 46,640 / 46,681 B, widget 33,852 / 33,865 B, transport 13,141 B (Node zlib level 9). To retain the existing ceilings, the touched widget paths omit nonessential scan/hydration console diagnostics and use concise fallback save/image-rejection messages. Functional branches and error handling remain. The final missing-metadata regression prevents older/null metadata rows from aborting link/image hydration.
