# Research — Story s96-free-tools-platform

Verified against `origin/main` at `f4ecaa8` on 2026-10-11 (s89 and s06b merged after the plan was
written against `7185da5`). No production access was used: no production SQL, no connector, no
credentials. SQL ran on the throwaway PostgreSQL 17 built by `scripts/run-db-invariants.mjs` and on
a local `supabase start` stack. No scan of a third-party site was run from a test; the one live
measurement (the false-positive budget, below) fetched public homepages by hand, once each.

## What the plan asked research to confirm

1. **Vercel's `x-forwarded-for`.** Vercel sets `x-forwarded-for` to the client address and does not
   pass a client-supplied value through; the s77 review relied on the same fact for
   `getClientIp` (`src/lib/api/rate-limit.ts:67-74`). `scanClientKey` keys IPv6 callers by /64
   (and /48 for the daily bucket), unwraps IPv4-mapped addresses, and answers 403 for "unknown".
2. **Sentry v10 trace propagation.** Confirmed in `node_modules/@sentry/core` 10.58
   (`build/cjs/utils/tracePropagationTargets.js`): `shouldPropagateTraceForUrl(url, undefined)`
   returns `true`, and the Node HTTP integration
   (`integrations/http/inject-trace-propagation-headers.js`) attaches `sentry-trace`, `baggage`
   and `traceparent` to every outgoing `http.request` it is allowed to. So the scanner's fetches of
   strangers' sites would carry our trace ids. Task 12 applies:
   `src/lib/monitoring/trace-propagation.ts` limits targets to the app and realtime origins, as
   anchored RegExps (Sentry matches a string target as a **substring**, so a bare
   `"https://www.recopyfa.st"` would also match `https://www.recopyfa.st.evil.example/`).
3. **The route table for `[slug]/r/[id]`.** `/tools/website-spell-checker` is a static segment and
   `/tools/[slug]/r/[id]` a dynamic one; Next matches the full path, so
   `/tools/website-spell-checker/r/<id>` resolves to the dynamic route. The production build lists
   `/tools` and `/tools/website-spell-checker` as static (`○`) and `/tools/[slug]/r/[id]` as dynamic
   (`ƒ`) — see the review doc for the build output.
4. **Today's `pg_database_size`.** **Not measured by the implementer** (no production access in this
   story). The architect measures it before the push; `docs/operations/free-tools.md` carries the
   query. The table's own ceiling is ≤ 80 MB.

## Facts found while building (not in the plan)

5. **parse5's tree construction is quadratic** in nesting depth and in a tag's attribute count.
   Measured on Node 24.14, unbounded, on 200 KB inputs: `<ul><li>` × 25,000 → 18.4 s,
   `<dl><dt>` → 16.8 s, `<b><div>` → 14.1 s, `<i></b>` → 2.3 s, one tag with 40,000 distinct
   attributes → 3.2 s. A 2 MB page is ten times larger. The fetch cap bounds bytes, not this. The
   extractor therefore parses through parse5's streaming `Parser` in 16 KB chunks with a tree
   adapter that refuses depth > 512 (Chrome's own parser limit) or > 100,000 elements, and stops
   after 1.5 s of parsing. Every pattern above is refused in < 1 s
   (`extract-page.test.ts`, "refuses … as too complex, quickly").
6. **WHATWG URL** (Node 24.14) rewrites `2130706433`, `0x7f.1` and `0177.0.0.1` to `127.0.0.1`,
   encodes `bücher.example` as `xn--bcher-kva.example`, keeps a trailing dot in `hostname`, and
   throws on a zone id (`[fe80::1%25eth0]`). `normalizeScanUrl` relies on each, pinned by tests.
7. **`NODE_USE_ENV_PROXY=1` + `HTTP_PROXY`** routes Node 24's default agent through the proxy (the
   default agent got `ECONNREFUSED` from a dead proxy port); `agent: false` connected directly with
   the validating lookup consulted. `tsx` itself hangs under that environment (it talks HTTP to its
   own helper), so the test runs an esbuild bundle under plain `node`.
8. **ipaddr.js 2.2 ranges** of the refused addresses in the plan match exactly (loopback, private,
   linkLocal, carrierGradeNat, unspecified, broadcast, multicast, reserved, uniqueLocal, rfc6052,
   6to4, teredo; IPv4-mapped unwraps to the inner range). `64:ff9b:1::/48` (RFC 8215 local-use
   NAT64) is classified `unicast` by ipaddr.js 2.2 — recorded as a residual risk in the review.
9. **`wordlist-english` 1.2.1** loads in ≈ 60 ms / ≈ 17 MB heap (all five dialects, bands 10–70,
   115,780 words after lower-casing). Its `index.js` reads all 40 JSON files at require time, which
   is why the dictionary is required lazily on the first scan.
10. **robots.txt** (architect decision 3) follows RFC 9309: groups naming the product token
    `RecopyFastToolsBot` merge, else `*`; longest match wins, `allow` wins a tie; `*` and `$`;
    4xx → no rules; 5xx or unreachable → the scan is refused with that real reason.
11. **s98 (#92)** will add `buildWebApplicationLd` (identical code, applied here verbatim so the
    merge is clean), a `## Free tools` heading in `llms-txt.ts` and one sitemap row. s96's
    catalogue-driven section and sitemap rows replace both at the merge of `origin/main`.

## Baseline

`npm test` on `f4ecaa8` in this worktree: 447 suites passed, 6,121 tests passed, 38 skipped
(the first commit's pre-commit run). Playwright strict count on `f4ecaa8`: 93.
