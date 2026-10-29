---
validated: yes
story: s126-site-token-write-paths
---
# Plan — Story s126-site-token-write-paths

Validation source: owner in chat, 2026-10-28 ("Validate" on the s126–s128 plan checkpoint, Codex-authored plans).

Branch: `feature/s126-site-token-write-paths`
Research: [s126-site-token-write-paths](../research/s126-site-token-write-paths.md) — read first.
Decision proposal: [ADR 076](../decisions/076-discovery-is-not-publication.md).

Owner validation authorizes Phase 2 implementation. Historical investigation is a separate story;
L1 remains out of scope.

## Target story

Discovery may record candidate content but never publish it. NULL-publication rows must not
supply public text, image URLs, hrefs or alt text. Upload requires an editor with edit permission
and the site owner's active entitlement, using existing credential validators. Preserve staged
review/publish, existing publications, upload processing, and the permanent embed URL.
Acceptance: `docs/stories.md` → s126. No new UI/design artifact is needed.

## Tasks (ordered)

1. [x] **Discovery boundary, red → green.** Add route tests for token-only discovery of new text,
       link and image ids: published is NULL; original/current and normalized provenance remain;
       caller-supplied publication/staging fields cannot promote a row. Assert duplicate reports
       leave existing text/attributes unchanged, with the same conflict key and limits. Then set
       the builder's publication to NULL and update the incident comment. Update old tests that
       intentionally expected discovery to publish; record the behavior change in the later PR.
2. [x] **Public projection, red → green.** Add a mixed fixture to `public-rows` and both public
       route suites: hostile NULL rows disappear entirely; non-NULL rows (including empty text,
       no timestamp, shared ids and non-default language/variant) preserve their contract. Keep
       private-field contamination fail-closed **before** filtering. Then omit NULL rows in the
       shared projection and the content GET's inline transform; do not broaden SELECTs or turn
       this into the postponed s65c refactor. Verify route parity, scoping, 304/ETag retraction,
       body cap and public reads during a plan lapse.
3. [x] **Editor continuity and publish round trip, red → green.** Add editor-read coverage for a
       NULL-publication discovery row, and expose its original text only through the authenticated
       staging GET fallback (`staging ?? published ?? original`). Use the existing route/database
       harness to save and publish text and attribute edits from such a row, confirming no public
       effect before publish and intended content/attributes afterward. Also cover duplicate
       discovery after publish. The staging save already requires content; preserve the atomic
       RPC. If the real lifecycle cannot satisfy these tests without schema changes, stop and
       revise this plan; do not add an unreviewed migration or publish a stored original implicitly.
4. [x] **Upload authorization, red → green.** Extend upload route tests and add a real-validator
       suite patterned after AI suggest. Token-only/absent, wrong-site, expired, revoked,
       unverified-device and view-only credentials refuse before entitlement, image processing
       and storage. Test successful device-grant, edit-session and staging-token uploads; lapsed
       or missing owner refuses via `ownerCanEditRefusal`, lookup errors return 503, no storage.
       Then replace site-token authorization with `validateEditorTokenFromRequest` and grade
       `edit`. Map only string `editToken`/`stagingToken` multipart fields into `body`; grants
       remain header-only. Canonicalize siteId once. Order: IP limiter → bounded form validation
       → credential validation → edit grade → per-site limiter → owner gate → processing/storage.
       Keep both limits fail closed and assert casing shares a bucket. Update the storage helper's
       authority comment only; its behavior stays unchanged.
5. [x] **Upload transport/CORS, red → green.** Execute the real embed source with a fake XHR:
       device grant header, edit token field, staging token field; no public-site bearer as upload
       authority, no credential query parameters, no cookie mode, correct `this` binding inside
       the Promise. Then use `editorAuthHeaders()` and `editorTokenBody()` in `uploadImage`,
       adding only nonempty string fields. Reuse public CORS helpers for POST and bodyless 204
       OPTIONS (`POST, OPTIONS`); test the grant header allowance and absence of Allow-Credentials.
       Keep browser-generated multipart boundaries, progress, timeout and error messages.
6. [x] **Host-markup regression, red → green.** A fixture drives token-only POST → public read →
       real widget boot/rescan, and a snapshot-host rendering check. Host text, image src, href
       and alt stay unchanged despite hostile candidate values. Authorized staged edits remain
       private until publish; afterward the existing application behavior works. Test authored
       and computed ids plus a page/shared-row case. Verify repeated discovery is coalesced and
       capped; do not add an unbounded retry or a new endpoint to recover omitted known ids.
7. [x] **Contract documentation and build.** Update the snapshot integration document and the
       relevant architecture paragraph with the NULL-row omission and editor-only upload rule;
       retain old ADRs unchanged and accept ADR 076 only after owner validation. Document the
       repeated-discovery tradeoff and historical-content limitation. Rebuild using
       `node scripts/build-embed.mjs`, then `node scripts/build-embed.mjs --check`; measure the
       resulting sizes against unchanged ceilings. If over budget, make the scoped transport
       change smaller; do not borrow unrelated refactors or raise the gate.
8. [x] **Verify and prepare the independent-review handoff.** Run focused suites, then lint, full
       type-check, production type-check, format:check, full Jest and coverage, and a local build
       using explicit test-only configuration. Run the relevant scratch-PostgreSQL lifecycle
       tests with a loopback-only disposable DB; no hosted DB. Report unavailable checks honestly.
       Review the complete story diff against the actual branch base; obtain `/ks-review` and
       `Ship allowed: yes` before a later authorized `/ks-ship`. No push/PR in Phase 1.

Implementation verification is complete. Independent `/ks-review` remains pending and no
`docs/reviews/s126-site-token-write-paths.md` exists yet, as required for a fresh-context review.
The host-markup proof is split across the real token-only discovery route test, the shared public
projection/route parity tests, and the shipped-source widget fixture rather than one large
database-mocked test. The disposable PostgreSQL test separately proves the authenticated
save/publish round trip.

## Run interdicts

- The owner validated this plan on 2026-10-28; the prior documentation-only interdict is satisfied.
- No production access of any kind: no Supabase/Fly/Vercel/Stripe calls, deploys, linked database
  operations or production URLs. Never read `.env*`; use explicit synthetic configuration.
- No edits to existing migrations, no historical row/object deletion, no new dependencies.
  No schema change is planned; a need for one requires a revised plan first.
- No changes to `credit_purchases`, `copy_styles`, `src/app/api/edit-board/styles/*`, `server/*`,
  A/B tracking/lifecycle, billing policy, editor-access semantics or sibling-worktree files.
- Preserve public GET authorization, CORS, page/shared scoping and the CDN lifetime. Do not gate
  public reads/discovery on a plan. Keep bounded install bookkeeping behavior.
- No raising embed ceilings, moving the public script URL or hand-editing generated artifacts.
- Never `git stash`, rewrite history, bypass hooks, push or open a PR in this run.

## The point everything turns on

**A stored discovery observation is not a publication.** NULL alone is insufficient while either
public read manufactures display text from the original or delivers untrusted attributes.

- Compare both public transforms with ADR 046 and a real SSR consumer: omitting the entire row
  avoids a blank-string/null sentinel being mistaken for an override. Keep private-column failure
  checks and existing non-NULL publications intact. Do not use truthiness or `published_at` as
  the publication test.
- Compare the private staging projection and real atomic publish with the new initial state:
  editors must see candidates and publish deliberately, including attribute edits. No fallback
  may move from the private projection back into the visitor projection.
- Compare XHR multipart credentials with `extractEditorToken` precedence: `editorAuthHeaders`
  alone excludes edit-session/staging editors; the old public bearer is insufficient; omitted
  CORS permission silently breaks cross-origin device-grant uploads.

## Files touched

Phase 1: `docs/stories.md`, this plan, its research, ADR 076 and the supplied audit copy only.

Anticipated implementation files:
- `src/app/api/content/[siteId]/route.ts`
- `src/lib/content/public-rows.ts`
- `src/app/api/staging/content/[siteId]/route.ts` (private display fallback only)
- `src/app/api/upload/image/route.ts`
- `src/lib/storage/upload.ts` (authority comment only)
- `public/embed/recopyfast.src.js`, generated `public/embed/recopyfast.js`
- `src/__tests__/api/content/discovery-fidelity.test.ts`, relevant content GET/page-scope suites
- `src/lib/content/__tests__/public-rows.test.ts`, `src/__tests__/api/published/route.test.ts`
- `src/__tests__/api/staging/content-attributes-projection.test.ts`
- `src/__tests__/db/content-attributes-lifecycle.test.ts` (new-row lifecycle regression)
- `src/__tests__/api/upload/image/route.test.ts`, new `editor-auth.test.ts` beside it
- `src/__tests__/embed/content-attributes.test.ts`, new `image-upload-credentials.test.ts`
- `docs/architecture/published-snapshot.md`, `docs/architecture.md`, story/plan/review documents

No source changes are made by this plan. Keep any additional test-fixture edits bounded to these
behavior changes and explain them to the reviewer.

## Test strategy

Route tests exercise guards and prove absence of downstream calls, not merely status codes.
Real editor-validator tests use synthetic signed credentials and stubbed database transport,
covering live grants/revocation and device context; never mock all auth to unconditional success.
Public-projection tests prove both routes agree and do not leak candidate rows or attributes.
A disposable PostgreSQL round trip proves actual NULL/save/publish semantics, and executable
widget tests prove host markup preservation and multipart/CORS compatibility. Existing image
format/size/normalization/storage tests remain. No production proof is claimed from local tests.

Run `export NEXT_PUBLIC_APP_URL=http://localhost:3000` for checks and commits. Use the repository's
Node 24 engine. Existing fallback/baseline assertions will intentionally change; identify those
changes in the review/PR. Keep coverage thresholds and build-size tests unchanged.

## Definition of Done

Phase 1: story/research/unvalidated plan/decision proposal plus audit committed on the requested
branch after `npm ci` and the unbypassed pre-commit hook. Stop for owner review; no code or push.

Later implementation: all eight tasks and story acceptance satisfied, required local checks
passing (or explicit blockers), exact generated artifact fresh and within budget, independent
review ending `Ship allowed: yes`, one scoped PR under the manual merge strategy. Deployment and
production verification require their own authority and evidence; they are not part of this run.

## Owner answers recorded at validation

1. ADR 076's omission of NULL rows and bounded repeat discovery are accepted.
2. Historical-content/storage inspection is a separate story with separate production authority.
3. L1's automatic A/B promotion remains a separate follow-up.
