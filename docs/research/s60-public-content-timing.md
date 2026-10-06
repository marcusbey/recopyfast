# Published content timing research

## Reproduced symptom

The user changed the production aicompoz.com hero to “A personal home designer
in your pocket.” The server HTML still contains “Snap a room. See it redesigned
and priced.” A regular visitor initially receives the authored HTML and later
sees the saved text applied by ReCopyFast.

Two browser measurements from the same live page:

| Load | First contentful paint | Published-content response end | Fetch duration | Paint to response |
| --- | ---: | ---: | ---: | ---: |
| First | 816 ms | 2097 ms | 1257 ms | 1281 ms |
| Reload | 288 ms | 1220 ms | 871 ms | 932 ms |

These are response-availability measurements, not exact pixel-change timestamps.
The browser also visibly showed the old and new hero strings. No production copy
was changed during diagnosis. Font downloads finished before content fetching in
the measured load, so API latency is the first target.

## Verified source

- `src/app/api/content/[siteId]/route.ts:GET` awaits IP rate limiting, resolves the
  authorized principal, reads page/shared content and then **awaits** the advisory
  `recordSiteReport` write before returning the published response. Its own
  comment says bookkeeping must not delay content. Existing `next/server` after
  usage in other routes provides an established deferred-work mechanism.
- `src/lib/content/paged-elements.ts:collectPages` always waits for an empty
  terminal response, even when the first page has only 223 rows. This is deliberate:
  a configured PostgREST max_rows may be smaller than the requested range, so a
  short page by itself cannot prove completion. Do not regress that protection.
- `fetchPageScopedRows` reads the page and shared scopes concurrently. The new
  optional exact count must belong to each individual scope. Other callers must
  continue to work without counts.
- `public/embed/recopyfast.src.js:init` runs DOM readiness, existing editor/staging
  authentication, font readiness, scan and saved-content hydration in order.
  The full font wait may cost three seconds on cold-font failures, but it does
  not explain the measured API response delay. Font gating also protects editing
  geometry, so changing it is deferred from this bounded first improvement.
- The aicompoz loader uses afterInteractive to avoid fighting React hydration.
  Changing it to beforeInteractive or hiding the entire page is not this fix.

## Compatibility constraints

Only page-scoped public GET opts into exact count. Legacy all-site reads and
other shared pagination callers keep their unknown-count behavior. Never use
an estimated count to terminate reads. Refresh the termination target from
later valid exact counts: freezing count 200 across two capped 100-row responses
can miss an existing tail if an insertion shifts offsets and raises the count
to 201. The third page must still be read. If a later count is missing or invalid,
that scope returns to empty-page termination. Preserve every row returned.
Existing offset-pagination races are not otherwise claimed fixed.

The frozen deployed widget matched local generated source SHA-256
6676bd5c5edce7f9f1cee18c79807e5e400e969fe13d7ca0828480547e7b61f9.
This story changes the API path first and does not spend additional embed bytes.

## Release constraint

Current main has production dependency audit failures already reported by s59:
one critical, two high, two moderate and one low. This story must not bypass that
release gate or claim production readiness while it remains red.

## Read-only pagination benchmark

Five paired reads, alternating execution order after warming both modes, used
the same production site/page/language/variant and the public content projection.
Every pair returned identical 258-row results, including the shared scope.
Existing pagination made four PostgREST requests; exact-count termination made
two. Median pagination time was 420 ms versus 213 ms (49% lower). This measures
the database-fetch portion from the operator machine, not the deployed API's
end-to-end latency or the browser's visual swap. No content was written.

| Pair | Existing ms | Exact-count ms | Identical rows |
| --- | ---: | ---: | --- |
| 1 | 528 | 228 | yes |
| 2 | 319 | 250 | yes |
| 3 | 433 | 168 | yes |
| 4 | 343 | 171 | yes |
| 5 | 420 | 213 | yes |

## Review correction

Independent isolated reproduction of the growing-count case failed the first
implementation (one tail row omitted, two reads instead of three). The helper
owner added the regression and corrected the count/fallback state; the helper
suite now passes all 24 tests. This is a
correctness refinement of the approved pagination optimization, not a change
to authentication, payload fields or page boundaries. Legacy reads with omitted
page_path retain their original unknown-count query behavior.

## Final implementation benchmark

The final candidate helper and the actual unchanged base helper were imported
directly and exercised against the same scoped production rows, alternating
order after warmup. Five paired reads again returned identical 258-row results
and reduced requests from four to two. Median read time was 346 ms versus
268 ms (23% lower); one candidate run was slower, so this does not establish
a uniform per-request speedup. This final-code result is the primary evidence;
the earlier 49% exploratory measurement remains above as a record of variability.
Neither result is a deployed full-API or first-paint timing measurement.

| Pair | Base helper ms | Final helper ms | Identical rows |
| --- | ---: | ---: | --- |
| 1 | 358 | 321 | yes |
| 2 | 287 | 372 | yes |
| 3 | 346 | 173 | yes |
| 4 | 284 | 268 | yes |
| 5 | 348 | 150 | yes |
