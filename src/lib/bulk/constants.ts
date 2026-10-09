/**
 * The import size limit, in bytes of the raw request body.
 *
 * One constant, imported by both the route that enforces it and the dashboard
 * card that quotes it, so the number an owner is told can never drift from the
 * number the server actually applies — the failure mode being a UI that
 * accepts a file the API then refuses, with no explanation the owner can act
 * on.
 *
 * **4 MB rather than a rounder, larger number, and this is the reason:** Vercel
 * caps a serverless function's request body at 4.5 MB, and that rejection
 * happens in the platform *before* the handler runs. It arrives as an opaque
 * 413 with no JSON body — so a limit set above 4.5 MB does not merely fail, it
 * fails in a way this code cannot phrase: the dashboard reads `response.json()`
 * off a non-JSON response and the owner is shown a parse error instead of
 * "split the file". Staying under the platform ceiling keeps the refusal ours.
 * `src/app/api/upload/image/route.ts` picked 4 MB for exactly this reason and
 * says so; `docs/architecture.md` records Vercel as the host. Raising this
 * means moving to direct-to-storage uploads, not a bigger number here.
 *
 * 4 MB is still roughly a 16,000-row export of ordinary marketing copy — far
 * above any real site's content.
 */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** For the message the owner reads: "The import limit is 4 MB." */
export const MAX_IMPORT_LABEL = `${MAX_IMPORT_BYTES / (1024 * 1024)} MB`;

/**
 * The most operations one `POST /api/bulk/update` request may carry (s77, s69
 * R2). Over it is a 400, before the session is read.
 *
 * The route took any length. Each operation is a sequential element read plus
 * up to one service-role write inside a single function invocation, and the
 * whole array is stored in `bulk_operations.configuration` — so the limiter in
 * front (10 requests a minute) bounded requests, not the work inside one.
 *
 * 100 because the only caller, the dashboard's batch form, builds operations
 * by hand one row at a time; it never comes near. That bounds one request at
 * about 200 round trips, and one address at about 1,000 element writes a
 * minute. A bigger change is a bulk import (one RPC, ADR 008), not a bigger
 * number here.
 */
export const MAX_BULK_UPDATE_OPERATIONS = 100;
