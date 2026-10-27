# Research — Story s126-site-token-write-paths

**Verdict: H2 partially holds; M5 holds. The audit's NULL-only remedy is insufficient.**
Date: 2026-10-27. Verified locally at `534e792653338928fb0b78117f8639d1bc735a6b`,
branch `feature/s126-site-token-write-paths`. No production access, credentials, or `.env*`
contents were used. These are code-path findings, not a production exploit demonstration.

## The five structuring facts

1. Discovery seeds `original_content`, `current_content` and `published_content` with the same
   untrusted text and stores href/alt (`src/app/api/content/[siteId]/route.ts:155-184`); its only
   caller authority is the public site token and origin check (`:503-511`).
2. The current widget does **not** normally apply that equal-to-original text: `applyRow`
   suppresses it, but still applies metadata (`public/embed/recopyfast.src.js:3869-3882`,
   `:3677-3687`). Thus the audit overstates direct text/image-source defacement on this widget;
   attacker-chosen HTTPS links and alt text remain a confirmed path.
3. NULL is not a safe public boundary today: content GET falls back to the stored original
   (`src/app/api/content/[siteId]/route.ts:425-446`), as does the snapshot projection
   (`src/lib/content/public-rows.ts:91-116`). Both retain discovery attributes. The snapshot
   integration instructs hosts to render `current_content` (`docs/architecture/published-snapshot.md`,
   response contract), which can render attacker text even when the current widget would skip it.
4. Upload checks only the public token (`src/app/api/upload/image/route.ts:121-150`), then
   processes and stores bytes (`:160-209`). No editor or entitlement check exists. Its XHR sends
   only the site bearer token (`public/embed/recopyfast.src.js:2966-2975`).
5. `editorAuthHeaders()` carries **only device grants** (`recopyfast.src.js:1359-1362`).
   Edit-session/staging credentials live in `editorTokenBody()` (`:1375-1382`); a multipart
   adapter is needed to preserve all legitimate upload callers.

## Target story

Close H2 and M5 using existing editor authorization. Discovery remains public, bounded ingest,
never publication; visitor delivery keeps host markup for undiscovered/unpublished elements.
Upload becomes an editor write under the owner's plan. No visual design phase: the existing image
picker/progress interaction remains. Acceptance is in `docs/stories.md` under s126.

`docs/reviews/stories.md` still ends `Stories ready: no` for older framing defects. This addition
is explicitly requested by the owner; it does not claim that backlog-wide gate has changed.

## Current state of the code

### H2: insertion, identity, delivery and publication

- `buildDiscoveryRows` validates and normalizes inputs, but validation is not authorship. The
  caller controls original text and safe-scheme attributes (`route.ts:155-184`). Computed ids are
  deterministic page-path/structural hashes, and authored ids are accepted verbatim
  (`recopyfast.src.js:939-947`); secrecy of element ids is no defense.
- POST runs the per-IP limiter before auth (`route.ts:490`), then the canonical authorized-site
  fail-closed limiter (`:578-586`). `authorizeSiteRequest` checks a real token signature
  (`site-auth.ts:216-224`) and compares the supplied Origin/Referer host with the site domain
  (`:242-247`). A non-browser token holder can supply that host; no editor identity is proved.
- Upsert conflict key is `(site_id,element_id,language,variant)`, with `ignoreDuplicates: true`
  (`route.ts:666-672`). First discovery wins; later discovery cannot overwrite an existing row.
  Install bookkeeping/email/analytics at `:616-635` is separate and must remain unchanged.
- The public GET and snapshot currently serve fallback originals and metadata minus only
  `staging_attributes` (`route.ts:427-446`; `public-rows.ts:84-116`). This is explicitly part of
  ADR 046, so changing it requires an amendment rather than silently claiming existing behavior.
- Widget `applyRow` compares current with original, not current with the actual DOM. Discovery's
  equal text is skipped; href/alt is applied before the null-content early return
  (`recopyfast.src.js:3677-3700`). URL scheme checks limit executable URLs; they do not prevent
  phishing HTTPS links. This finding is copy/attribute integrity, not evidence of script execution.
- The proposed public filter omits NULL-publication rows on **both** reads, including the
  session-authorized content GET, retaining their fixed projections and parity. Editor discovery
  uses staging/site content reads; repository call-site search found no production dashboard
  fetch of the general `/api/content/<id>` route. Do not widen those private reads into public ones.
- Staging GET currently computes `staging_content ?? published_content`
  (`src/app/api/staging/content/[siteId]/route.ts:200-214`), so newly NULL-published rows need an
  editor-only fallback to original text to remain useful for review. No public fallback.
- Staging PUT requires content (`:342-350`) and passes a string plus attribute patch to its atomic
  save (`:397-421`). The existing atomic publish promotes staging content and attributes together
  (`supabase/migrations/20260924060000_restore_site_wide_publish.sql:47-99`). An attribute edit
  through this route includes content; test it on a newly discovered row. Do not change the RPC
  to silently publish an unreviewed original as a substitute for missing staged content.
- Historical discovery rows already have non-NULL `published_content` and cannot reliably be
  distinguished from legitimate publications just by equality with original. This story stops
  new discovery publication; it does not certify or erase historical content.

### M5: upload authority and transport

- IP and site upload budgets are both `API_UPLOAD`, fail closed (`upload/image/route.ts:76-89`,
  `:142-150`); that preset is 10/min (`src/lib/security/rate-limiter.ts:458`). The file cap is
  4 MiB (`upload/image/route.ts:46`, `:152-168`). The audit's roughly 57 GB/day is an ingress
  ceiling estimate, **not measured stored growth**: decode/re-encode changes object size.
- MIME sniffing, SVG rejection and normalization remain mandatory (`:172-200`). Storage uses
  service role, random immutable keys, no overwrite, and public URLs
  (`src/lib/storage/upload.ts:42-82`). Valid image bytes can be stored without editor authority.
- `ai/suggest` is the reuse model: validate credential, grade edit, fail-closed site limiter,
  owner-plan check (`src/app/api/ai/suggest/route.ts:263-291`, `:316-327`). Upload needs no AI
  configuration, credit accounting, or new session-cookie fallback.
- `validateEditorTokenFromRequest({ request, siteId, body?, allowUnverified? })`
  (`src/lib/auth/editor-access.ts:610-648`) derives device context and defaults verification to
  required. `extractEditorToken` (`:208-267`) prioritizes the grant header, then staging fields,
  edit fields, then bearer-as-staging. A site bearer is not an editor credential.
- `requireEditorPermission(access, "edit")` (`:126-131`) uses normalized permission hierarchy.
  Use canonical site ids (`src/lib/api/validation.ts:395`) for validation, limiter, plan and
  storage so casing cannot multiply buckets.
- Upload's local CORS helper omits `X-RCF-Editor-Grant` (`upload/image/route.ts:53-60`). Reuse
  `withPublicCors`/`publicOptions`, whose allowlist already includes it, without credentials.
- Only the widget is a production upload caller in the checked-out source; the route header's
  dashboard claim has no matching caller. XHR progress, timeout, and error paths are at
  `recopyfast.src.js:2975-3009`; preserve these while capturing `this` correctly for the Promise.

### L1 scope decision

Related trust problem, different remedy: track verifies site ownership of test ids but accepts
visitor telemetry (`src/app/api/ab-tests/track/route.ts:516-535`) and invokes lifecycle near
`:653`. `src/lib/ab-testing/lifecycle.ts:127-150` auto-completes and promotes a winner. It chooses
existing variants rather than uploading arbitrary copy. Requiring editor auth on visitor events
would break measurement. Distinct-visitor guarantees or manual completion need their own product
and fraud policy. **Out of scope; residual indirect publication risk explicitly remains.**

## Anchor points

Discovery builder and public transform; `toPublicRows`; staging GET display fallback; upload
handler and its CORS; widget `uploadImage`, `editorAuthHeaders`, `editorTokenBody`. Preserve the
existing publish boundary, not a fourth auth path. ADRs read: 002, 035, 041, 042, 046 and 047.
H2/M5 themselves cite no numbered ADR; these are their governing architecture decisions.
Proposed ADR 076 amends only ADR 046's public fallback contract; 075 belongs to s125.

## Verified APIs / functions

- `buildDiscoveryRows(siteId, contentMap)` produces new-row records; ignore-duplicate upsert is
  the idempotency boundary, not an authorization boundary.
- `toPublicRows(rows: readonly PublicContentSourceRow[]): PublicContentRow[] | null`
  (`public-rows.ts:112`) refuses private-column contamination before projection.
- `validateEditorTokenFromRequest` and `requireEditorPermission`: signatures and precedence
  above. Pass only string multipart token fields in its plain-object `body`, never a FormData
  object or grant in a body/URL. Reuse `ownerCanEditRefusal` for 402/503 semantics.
- `uploadSiteAsset(options)` performs the storage write; authorization belongs in its caller.

## Traps & constraints

- `src/__tests__/api/content/discovery-fidelity.test.ts:330-346` asserts published equals original;
  `:655` calls captured attributes a published baseline. Change these expectations explicitly.
- `src/lib/content/__tests__/public-rows.test.ts` pins original fallback; public route tests at
  `src/__tests__/api/published/route.test.ts:217-229` include NULL rows and compare both routes.
  Keep the private-column rejection test even when an offending row would otherwise be filtered.
- Omitting rows removes them from `serverKnownElementIds` across page loads
  (`recopyfast.src.js:3969-3980`). The widget claims ids before POST and coalesces reports
  (`:3247-3276`), so repeats remain bounded per page view, but future visitors re-report
  unpublished rows. Existing fail-closed limits may delay fresh discovery on busy sites.
- Changing only the writer leaves the NULL fallback exploit. Changing only the widget leaves
  SSR consumers exposed. Using `published_at` as proof misses non-timestamped legitimate writers.
- Existing non-NULL rows, including legacy publications without a timestamp, remain served.
  Empty-string publication remains representable in the API; its widget rendering is pre-existing
  behavior and must not accidentally become a new blanking feature in this security story.
- Source/build coordination with sibling stories is required before eventual merge. No ceiling
  increase: `scripts/build-embed.mjs:431-432` is authoritative. Do not edit generated JS by hand.
- `npm ci` and hooks are required for this docs commit; runtime tests are future execution work.
  No `.env*` reads, production queries, deployment, push, stash, or history rewrite.

## Open questions

1. Approve omission of NULL-publication rows on both public routes (ADR 076), accepting bounded
   repeat discovery requests until publication? This is safer for existing SSR consumers than
   returning a new nullable `current_content` contract they may render incorrectly.
2. Historical planted attributes/objects cannot be identified from this offline review. Should a
   separate, explicitly authorized operator investigation be scheduled? No cleanup is proposed here.
3. Confirm L1 remains a separate follow-up; this story cannot claim every indirect site-token
   publication path is closed while A/B auto-completion exists.

## Real complexity

**4**, matching the appended story: small writes but a consequential public projection contract,
three editor credential transports, cross-origin upload, staging compatibility and byte limits.
Within eight tasks; no split needed for H2/M5. L1 is deliberately split out.


## Phase 1 validation evidence

`npm ci` completed once (1316 packages installed); it warned that the shell's Node 25 differs
from the repository's Node 24 engine. The actual commit hook and serial recheck used Node
24.14.0 and `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

The unbypassed pre-commit hook passed lint (34 warnings, zero errors), full type-check and
format:check. Jest finished with 571 suites passing, one skipped and two failing: the existing
2 MB extraction test returned `too_complex`, and the analytics-context suite lost a worker to
SIGSEGV. Overall: 8569 passing tests, one failing test, two skipped. A serial rerun of those two
suites passed analytics-context but reproduced the extraction failure (102 tests passed, one
failed). The extraction case requires completion within two seconds; observed host load was
326–404, so resource sensitivity is plausible, not proven as the sole cause.

The hook refused the commit. No code, tests, timing thresholds or hooks were modified; no commit
was created, no push/PR attempted. Documentation remains staged pending a clean normal hook run.
Owner plan validation remains pending independently of that operational blocker.
