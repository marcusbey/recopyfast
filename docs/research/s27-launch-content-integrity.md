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

## Fresh review correction

The independent review invalidated the original lifecycle completion claim: restore fabricated absent href/alt and change detection tested key presence. Page identity also increases cardinality beyond PostgREST's 1,000-row default. Fix scope is now value-based draft comparison, presence-preserving restore/capture, page-aware paginated reads, atomic staging/history, and visible page provenance. Discovery must tolerate unsupported authored hrefs while edit validation remains strict. The prior absence of page_path and non-atomic staging were temporary implementation limitations, now explicitly addressed by the fix plan. SPA navigation is deferred as a pre-existing limitation by the operator.

## Review fix implementation — 2026-09-24

Page reads share `src/lib/content/paged-elements.ts`. They paginate mandatory ordered ranges of 1,000 rows, using separate parameterized equality and NULL queries for the page/shared union instead of interpolating caller paths into PostgREST filter syntax. Missing `page_path` retains the legacy all-site read, also paginated. Widget identity, discovery, hydration, polling and preview use the same normalized path; `/index.html`, `/index.htm`, trailing slashes and percent-encoded unreserved characters canonicalize before hashing. Reserved escapes remain distinct from literal separators. Reused stamped SPA nodes, query/hash routers and extensionless-vs-`.html` aliases remain deferred; newly created DOM nodes still use the current path.

The forward migration `20260924030000_content_page_path.sql` adds the nullable path/index, `save_staging_content_atomic`, and `publish_staging_content_with_attributes_atomic`. The existing two-column publish function delegates to the new implementation, preserving its signature without copying transaction logic. The author-added optional page-scoped publish was rejected in fix mode 2: Publish and its preview must remain site-wide, with page context used only for the count breakdown. Restore stages only snapshot attributes with different published values. New RPC grants follow the service-role-only precedent with pinned search paths. Apply the migration before the application; rollback the application first and retain the additive migration.

The atomic staging boundary also repairs A-17's stale previous-content history. Its regression marker is flipped; A-17's separate optimistic-concurrency/lost-update marker remains expected-failing. API test harnesses now model the RPC boundary rather than the removed independent writes; business assertions and authorization guards remain. Actual SQL verifies atomic rollback when a history trigger rejects the insert.

Widget byte offsets come from shared content-read URL construction, removing routine success logs/empty disconnect handling, and shortening retained diagnostics. The content-load warning, image data-URI refusal explanation and map/DOM why-comment are present. Both Node 20.15.1 and 24.14.0 measure bundle 46,621 B, widget 33,855 B, transport 13,141 B; the 46,681/33,865 B ceilings are unchanged.

## Fix mode 2 findings

The independent re-review and operator decision supersede the author-added publish scoping. The shared pager stopped on short responses and incremented by requested size, so a PostgREST cap of 500 silently truncated data; continue to an empty response and advance by actual count. The reviewer found vacuous unlimited mocks and non-overlapping SQL concurrency tests: replace these with capped query doubles and deterministic lock contention. Discovery paths need a bounded normalized contract before upsert. The remaining all-site reads must share the same pager. Restore omits absent attribute keys deliberately: an attribute added after a snapshot remains unchanged when that key is absent from the snapshot (N8 trade-off).

`20260924060000_restore_site_wide_publish.sql` replaces the attribute-aware publish body without changing its signature or editing the earlier migrations. Its compatibility `p_page_path` parameter no longer restricts publication. Apply `20260924010000`, then `20260924030000`, then `20260924060000` before deploying this candidate app/widget. The operator applies migrations; this lane only tests disposable loopback SQL.

Fix mode 2 encoding boundary: `normalizedPagePath()` in the widget owns URI decoding and index/trailing-slash folding. Discovery and reads validate and preserve that canonical string exactly; repeating either transformation can merge scopes or reject valid literal-percent URLs. Regression examples include browser `/%25`, `/%2520`, `/index.html/` and `/index.html/index.html`.

Final fix-mode-2 artifact, measured freshly on Node 20.15.1 and 24.14.0: bundle 46,601 B, widget 33,837 B, transport 13,141 B, with unchanged 46,681/33,865 B ceilings. Offset savings are confined to redundant/decorative publish-modal DOM. Final gates and mutation evidence are recorded in the plan.
