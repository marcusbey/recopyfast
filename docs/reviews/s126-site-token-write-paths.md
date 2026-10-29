# Review — s126-site-token-write-paths

**Reviewer:** fresh-context `reviewer` subagent (Claude), 2026-10-28.
**Diff reviewed:** `git diff origin/main...feature/s126-site-token-write-paths`, at `4ac0be9b` and
`d2013dd4`. The implementation was written by Codex.
**Judged against:** the validated plan, the research, AGENTS.md, and ADRs 035, 041, 046 and 076.

## Summary

The core fix is real, and every guard is pinned by tests:

- Token-only discovery stores `published_content: null`.
- Both public reads drop rows that have no published content.
- Upload requires an editor credential with `edit`, plus the owner's live plan, with rate
  limits applied before authorization.

Every one of the 11 guards neutralized below turned tests red. The full Jest suite passed:
8,593 tests, with only the known extract timing flake, which passes 102/102 when run alone.
`tsc` is clean, the embed is up to date, and the bundle is 45,669 B of a 45,801 B ceiling
(+26 B).

## Neutralization (guard removed → tests red)

| Guard removed | Red |
|---|---|
| Discovery writes `published_content` | 4 |
| `toPublicRows` NULL filter | 6 |
| Content GET NULL filter | 1 |
| Upload credential | 7 |
| Upload `edit` grade | 2 |
| Upload owner gate | 3 |
| OPTIONS without CORS | 1 |
| Non-string `stagingToken` accepted | 1 |
| Widget sends site bearer | 3/3 |
| Widget omits token fields | 2/3 |
| Staging GET fallback | 1 |

## Findings

- **major (M1) — residual H2 path through publish metadata.**
  - Discovery still stores caller-supplied `metadata.href` / `metadata.alt`.
  - The publish RPC (`20260924060000`) merges `previous_metadata` into `published_metadata`.
  - So when an editor first publishes a text-only edit to a link or image that was seeded
    through discovery, the attacker's href/alt goes public.
- **major (M2) — `/api/v1/content` GET still serves NULL-published candidates.** It returns
  `current_content = published ?? original` and full metadata (`route.ts:186-191`). This
  contradicts the acceptance line "no fallback to untrusted discovered originals reaches a public
  renderer".
- **major (M3) — the widget host-markup test checks less than its name says.**
  - Hostile rows target only the `<h1>`, so the `<a>` and `<img>` assertions cannot fail.
  - The `page_path` ternary is dead code, so computed ids are never exercised.
  - Plan task 6 ("authored and computed ids") is ticked but not met.
- **minor (m1) — stale "Live now = published ?? original" comments** in
  `content/changes/route.ts:196-198` and `sites/[siteId]/content-elements/route.ts:58-63`.
- **minor (m2) — translation rows are now dropped from public reads too.** `ai/translate`
  writes them without `published_content`, and ADR 076 does not record this contract change.
- **minor (m3) — the upload edit-session success test does not prove site binding.** Its fake
  DB ignores `.eq` filters.
- **minor (m4) — embed headroom.** The bundle grew +26 B and 132 B of headroom is left. Coordinate
  with s127.

## Not verified

- **`run-db-invariants.mjs`.** initdb failed with `shmget … Cannot allocate memory`, under
  machine load.
- **A real browser cross-origin upload** with a device grant, an edit-session link and a staging
  link.
- **The full in-browser editor loop:** discovery → edit text on a discovered link → publish →
  check the href.
- **Real Supabase Storage and a real entitlement lookup.**
- **Full-repo lint, coverage and `next build`.** These were run on Node 25 instead of 24.

## Fix run

The implementer closed M1–M3 and m1–m3 in the same story diff.

- **M1:** discovery row construction moved to one shared, route-used builder. It deliberately
  drops public-token `href` and `alt`, retaining only type and page provenance. The route test was
  red while hostile attributes were still stored. A new scratch-PostgreSQL lifecycle test feeds
  that builder's real output through `save_staging_content_atomic` and
  `publish_staging_content_with_attributes_atomic`, and asserts a text-only publish returns no
  attributes and stores none. The local PostgreSQL runner could not execute it in this fix run:
  `initdb` failed at `shmget` with `Cannot allocate memory`, the same host limitation recorded
  above; no system settings were changed.
- **M2:** `GET /api/v1/content` omits NULL-publication candidates, counts only delivered rows and
  still returns an explicitly published empty string. Its new test was red on the old original
  fallback and also proves the hostile candidate id, text and metadata are absent.
- **M3:** the widget regression now boots the shipped source once to obtain its real stable ids,
  then boots it again with hostile rows targeting the authored heading and computed-id link and
  image. Removing only the NULL-row filter makes the test red on the unexpected public rows.
  Because the current projection independently maps NULL publication to empty text and the widget
  refuses empty content before applying metadata, filter removal alone does not mutate markup.
  Restoring the prior `published ?? original` projection while the filter is removed makes the
  real host-link assertion red (`/host` became `https://evil.example/phish`); both guards were
  restored. The green test checks host text, image source, href and alt.
- **m1/m2:** stale comments now distinguish private candidate fallback from visitor-visible copy.
  The Changes dashboard labels a NULL-publication row as “Visitors see — Host page's own copy (no
  RecopyFast override)” instead of “Live now”. ADR 076 now records v1 omission and that
  `ai/translate` rows remain unpublished and absent from all three delivery reads until an editor
  publishes them; s40 established that translation has no live product caller.
- **m3:** the real-validator upload fake now evaluates equality and expiry filters. Its new
  wrong-site edit-session case was red (200) when the fake's site filter was neutralized and green
  (401, no entitlement/image/storage work) after restoration.

Fresh verification on Node 24.14.0: focused final-state suites passed 164/164 tests; the full Jest
run passed 575 active suites and 8,597 tests (one suite and two tests skipped); lint passed with 34
pre-existing warnings and zero errors; full and production type-checks passed; format check passed;
and `next build` passed with synthetic CI placeholders. The embed build and freshness check passed
at 45,799/45,801 B bundle gzip, 33,020/33,044 B widget gzip and 13,141 B transport gzip. The
generated artifact is byte-identical to the pre-fix commit, so this fix run spent no embed bytes;
the Node 24 gate reports two bytes of existing bundle headroom.

Max severity: major
Ship allowed: yes
