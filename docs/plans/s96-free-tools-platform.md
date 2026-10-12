---
validated: yes (architect, 2026-10-11)
---
# Plan — Story s96-free-tools-platform

> CTO decision under the owner's GTM direction, 2026-10-11. The architect's decisions are fixed;
> where the code disagrees with them, this plan says so and adapts (§ "Where the brief met the code").
> An independent gap analysis (analyst pass, 2026-10-11) was folded in. Its findings are marked
> **[A]**.

Branch: `feature/s96-free-tools-platform` from `origin/main` `7185da5`. Local `main` was at
`b0a84dc`; s17 (#89) merged since and changed `sitemap.ts`, `json-ld.ts`, `llms-txt.ts` and the
Playwright count, 91 → 93.

Research: `docs/research/s96-free-tools-platform.md` (run `/ks-research` first; this plan names
what it must confirm). Design: `docs/designs/s96-free-tools-platform.md` (run `/ks-design`). It
covers these screens and states:
- the hub, with an "About our scanner" section;
- the tool page: idle, scanning, refused, rate-limited, daily capacity reached, store down;
- the report: findings, zero findings, partial, not English, no text found, 404/expired;
- 390 px and 1440 px widths.

Decision: ADR 062.

## Where the brief met the code

| Brief | Code says | Adaptation |
|---|---|---|
| "`POST /api/tools/scan` or a server action" | AGENTS.md § Stack: "No server actions — the backend is … `route.ts` files" | Route only |
| SSRF-guarded fetch via `webhook-url-safety.ts` | `assertSafeWebhookUrl(rawUrl): Promise<ValidationResult<string>>` (`:129`) returns "Webhook URL…" errors that echo resolved addresses (`:200`). Its header (`:19-27`) leaves the DNS-rebinding window open because `fetch()` re-resolves | Extract the address classifier, unchanged, into `src/lib/security/public-address.ts`. The tools fetcher is a pinned-address fetcher on `node:http`/`https`: IP literals are classified before connecting, and hostnames go through a validating `lookup`. Refusals use fixed text. The webhook path keeps its exact behaviour and tests |
| 10/day, Turnstile from the 3rd scan "if it exists" | Turnstile is absent: no import under `src/`, nothing in `package.json`. Adding it would mean `frame-src`/`script-src` for `challenges.cloudflare.com` in the marketing CSP, which is `frame-src 'none'` today (ADR 059 territory) | The stricter limit: **5 misses/day per /64 (or IPv4), 20/day per /48, 5/min burst, 500 misses/day globally, 20/hour per target host**, all fail-closed, plus a same-origin guard **[A]**. Turnstile becomes follow-up **s96b**, triggered when the global cap is hit (logged; ops SQL) |
| "Public read of non-sensitive report JSON by unguessable id" with RLS | An `anon` `SELECT … USING (true)` policy lets anyone holding the public anon key run `GET /rest/v1/tool_reports?select=*`, which lists every report and defeats "unguessable" | No web-principal policy or grant; precedent `editor_verification_codes` (`20260801100000_editor_access_2fa.sql:183-189`). The report page reads one row by id through `createServiceRoleClient`, with a fixed projection. A named unauthenticated exception, ADR 062 (like ADR 046) |
| Reports are public marketing pages | The marketing policy is `script-src 'self' 'unsafe-inline'` (`content-security-policy.ts:143`); s79 put the dashboard under a nonce *because* it renders text scraped off customers' pages | The report route, and only it (`^/tools/[^/]+/r/[^/]+/?$`), joins the **nonce policy** and renders per request **[A]**. Escaping stays the first defence; the nonce is the second |
| HTML parser "already in deps if any" | `jsdom` 26.1.0 is a direct dep (`content-sanitizer.ts`); `parse5` 7.3.0 MIT comes through it | `parse5`, promoted to a direct dependency at `^7.3.0` (0 new install bytes): no DOM, no script execution and no resource loading by construction. jsdom is rejected for its memory cost on 2 MB pages |
| Word list, "check bundle and serverless size" | Measured in a scratch install (Node 24.14, 2026-10-11): `dictionary-en`+`nspell` loads in 106 ms / 15 MB but is en-US only (flags "colour", "organised") and ESM with top-level await (bundling risk). `wordlist-english` 1.2.1 (MIT, SCOWL data, 1.49 MB, no deps, CJS): `require` 43 ms plus union 15 ms, 115,780 words for sizes ≤ 70 across five dialects, ≈ 8 MB heap; it accepted 1 of 50 common typos ("calender") | `wordlist-english`, server-only, in `serverExternalPackages` (`index.js` reads JSON through an `expose.js` `__dirname` trick), plus `outputFileTracingIncludes` covering its `*.json` and `Copyright`. A scan verified on a Vercel preview **[A]** |
| CTA "→ /try" | `/try` is a bookmarklet preview with no `?fixes=` parameter, desktop only (launch kit §11), and it cannot edit alt text (`public/try/rcf-try.js`: every "alt" is `altKey`) | `/try?utm_…#install` with pinned honest copy. A second CTA variant (`"alt-text"`) for s101 ships here, so s101 never edits `ToolCta` |
| "Analytics events if an analytics helper exists" | None for visitors (`src/lib/analytics/tracker.ts` is the dashboard's service-role tracker); launch kit §12: "No visitor analytics; UTMs not stored at sign-up" | No events and no package. Measurement is `tool_reports` rows per tool per day (read-only SQL in the ops doc). CTA clicks stay unmeasured (open question) |
| — | Sentry server tracing is on (`sentry.server.config.ts:21`, `tracesSampleRate` 0.1) with no `tracePropagationTargets` | Research confirms whether `@sentry/nextjs` v10 attaches `sentry-trace`/`baggage` to outgoing `http.request`. If so, set `tracePropagationTargets` to our own origins so scanned sites never receive them **[A]** |
| — | `docs/stories.md:1408-1410` lists "the two free public tools" as "no story, by choice" | The docs commit amends it: free tools are s96–s101, and the content extractor and translate preview stay unplanned |

## CTO decisions

1. **One public route**, `src/app/api/tools/scan/route.ts`: `runtime = "nodejs"`, `maxDuration = 30`.
   Body `{ tool, url }` through `readBoundedJson(request, 4096)`. Answers:

   | Status | Body / meaning |
   |---|---|
   | 200 | `{ reportId, reportUrl, cached }` |
   | 400 | `{ error }`: fixed strings, `redactControlCharacters` |
   | 403 | cross-site or unidentifiable caller |
   | 415 | not `application/json` |
   | 422 | `{ error, reason }`, fixed message per `reason` ∈ `blocked_address | blocked_port | dns | timeout | too_large | not_html | http_status | redirect_limit | no_text | denylisted`; **no resolved address is ever echoed** **[A]** |
   | 429 / 503 | from `enforceRateLimit` |

   - No CORS header.
   - `TOOLS_SCAN_DISABLED=1` → 503 before anything: the operator's kill switch.
2. **Guards, in order.** Every limiter goes through `enforceRateLimit` with `onStoreFailure:
   "deny"`, justified in a comment: the route spends outbound fetches, function seconds and rows,
   with no authorization behind it.
   1. **Same-origin guard [A]** (stateless, so before any store):
      - `Content-Type` must be `application/json` (415). A cross-site `no-cors` `text/plain` POST
        needs no preflight.
      - `Sec-Fetch-Site`, when present, must be `same-origin` (403).
      - `Origin`, when present, must equal `resolveSiteUrl()`'s origin (403).

      A browser always sends one of the last two on a cross-site POST. Non-browser clients send
      neither, scan from their own address, and are metered below. Without this guard, any third
      party page could spend the global cap from every visitor's browser.
   2. `scanClientKey(request)`:
      - `getClientIp` (`rate-limit.ts:67-74`; Vercel overwrites `x-forwarded-for`, per the s77
        review);
      - unwrap an IPv4-mapped IPv6 address first **[A]**;
      - IPv4 as is; IPv6 → its /64, plus its /48 for the daily /48 bucket;
      - `"unknown"` → **403**, fail closed **[A]**; unreachable on Vercel.
   3. `tools/scan:burst`: `TOOLS_SCAN_BURST` 5/min per client key, **before the body is read**.
   4. Body, then `normalizeScanUrl`, then the host denylist (`TOOLS_SCAN_DENYLIST`, comma-separated
      hostnames and their subdomains, from env; 422 `denylisted`). The denylist is the opt-out path
      for a site owner.
   5. Cache lookup (one indexed service-role read).
   6. On a miss only, `tools/scan:daily` checks:
      - `TOOLS_SCAN_DAILY` 5/day per /64-or-IPv4;
      - `TOOLS_SCAN_DAILY_48` 20/day per /48 (IPv6 only);
      - `tools/scan:global` `TOOLS_SCAN_GLOBAL_DAILY` 500/day;
      - `tools/scan:target` `TOOLS_SCAN_TARGET_HOURLY` 20/hour per normalised target hostname.

      A global refusal is logged at `error` and answers "Today's free scans are used up. Try again
      tomorrow."

   **Counter semantics [A]:** a limiter increments when checked (`rate-limiter.ts:326`). A request
   refused at a later limiter has spent the earlier ones, which errs strict. A scan that fails at
   fetch has spent its daily allowance; otherwise failed scans would be a free probe.

   New presets go in `RATE_LIMIT_CONFIGS` (`rate-limiter.ts:419`), and
   `RateLimitConfig.identifierType` gains `"global" | "host"` (`:52`; key format unchanged). The
   global cap is a named constant, overridable by `TOOLS_SCAN_GLOBAL_DAILY_CAP` for launch day
   (validated positive integer, else the constant).

   **Rejected:** per-resolved-IP keying. CDN anycast addresses (Cloudflare, Squarespace) front
   thousands of sites, so it would throttle unrelated scans. Wildcard-subdomain amplification
   against one victim is bounded by the global cap (≤ 500 × 24 requests a day).
3. **URL normalisation** (`normalizeScanUrl`):
   - trim; add `https://` when no scheme;
   - `http:`/`https:` only, **default ports only** (80/443; otherwise `blocked_port`). Our egress
     cannot probe arbitrary public services, and refusal timing reveals nothing;
   - user info refused;
   - **query and fragment dropped**, which keeps reset links, edit tokens and tracking ids out of
     fetches, rows and logs; the form says so;
   - host lower-cased, **trailing dot stripped** before both keys;
   - IDN as punycode (WHATWG `URL`, verified);
   - ≤ 2,048 characters; control characters refused.

   `cache_key` = SHA-256 hex of `` `${tool}\n${href}` ``.
4. **Pinned-address fetcher** (`src/lib/tools/fetch/`). On every hop:
   - **An IP-literal host is classified with `classifyAddress` before any socket opens**, because
     Node never calls `lookup` for a literal **[A]**. `127.0.0.1`, `[::1]`, `2130706433`,
     `0x7f.1` and `[::ffff:7f00:1]` must open zero sockets.
   - A hostname goes through `https.request`/`http.request` with:
     - `lookup: createValidatingLookup(policy, resolver)`. It resolves with `dns.lookup({ all:
       true, verbatim: true })` and refuses the host if **any** address fails. It answers the
       array form (`{ all: true }`, which Node 24's `autoSelectFamily` uses, verified) and the
       single form.
     - **`agent: false`**. Verified on Node 24.14 with `NODE_USE_ENV_PROXY=1` + `HTTP_PROXY`: the
       default agent went to the proxy, `agent: false` connected directly. Through a proxy the
       validating lookup never runs.
     - `servername` = hostname (TLS verifies the name).
     - `rejectUnauthorized` at its default (true).
     - `signal: timeoutSignal(8_000)`.
   - Request headers:
     - `User-Agent: RecopyFastToolsBot/1.0 (+https://www.recopyfa.st/tools)`;
     - `Accept: text/html,application/xhtml+xml` (XML for the sitemap);
     - `Accept-Encoding: gzip, deflate, br`;
     - no cookie, no Referer.
   - Redirects are manual, at most 3. Each `Location` is resolved, re-normalised (scheme, port,
     user info, denylist) and re-guarded.
   - Body decompressed through `zlib`. **The 2 MB cap counts decompressed bytes** (zip-bomb
     defence): `content-length` over the cap refuses early, and the stream is destroyed at the cap.
   - Content types: `text/html` or `application/xhtml+xml`; for the sitemap, `application/xml`,
     `text/xml`, `text/plain`, plus `application/gzip` / `.gz` sitemaps decompressed under the same
     cap **[A]**.
   - Charset comes from `Content-Type`, then `<meta charset>` in the first 1 KB, via `TextDecoder`
     (WHATWG labels: `iso-8859-1` decodes as windows-1252).
   - `MAX_REQUESTS_PER_SCAN = 24`: homepage, ≤ 2 sitemap fetches, ≤ 9 pages, plus redirects.
     Concurrency 3.
   - **Captured headers** (`CAPTURED_RESPONSE_HEADERS`), each value ≤ 4 KB. These are the ones s97
     needs, so s97 never edits this file:
     - `content-security-policy` and `content-security-policy-report-only`;
     - `server`, `x-powered-by`, `x-generator`, `via`;
     - `x-shopify-stage`, `x-shopid`, `x-wix-request-id`;
     - `x-vercel-id`, `x-nextjs-cache`, `x-nf-request-id`;
     - `x-frame-options`.
   - The policy and resolver are parameters with strict defaults. Tests inject them; production
     code reads no environment bypass.
5. **Extraction** (`src/lib/tools/extract/extract-page.ts`, `parse5`) freezes the `ExtractedPage`
   contract for every lens. The image, meta, script and header fields are consumed by s97 and s101,
   which are fixed by the architect, so they are not speculative. Keeping them here stops three
   parallel PRs editing one file. The analyst's "cut it" was weighed and declined for that reason.
   - **Text and identity:**
     - `title`;
     - `lang`;
     - `baseUrl` (honours `<base href>` **[A]**);
     - `blocks` (tag, text; ≤ 2,000 blocks, ≤ 2,000 chars each, ≤ 200 KB per page);
     - `siteName` (`og:site_name`);
     - `generator`;
     - `metaCsp[]`;
     - `metaRefresh` (`no_text` notice **[A]**).
   - **Assets and links:**
     - `images[]`: absolute `src` (falling back to `data-src`, then the first `srcset` candidate),
       `alt: string | null` (null = absent), `role`, `ariaHidden`, `width`/`height`, `inLink`,
       `linkHasText`; ≤ 200;
     - `scriptSrcs[]`, `scriptIds[]`, `stylesheetHrefs[]` (≤ 50 each);
     - `rootAttributes` (html and body, ≤ 40, values ≤ 200);
     - `sameHostLinks[]` (≤ 100).
   - **Excluded from blocks:** `script`, `style`, `noscript`, `template`, `svg`, `math`, `code`,
     `pre`, `kbd`, `samp`, `textarea`, `select`, `iframe`, `object`, `[hidden]`,
     `[aria-hidden=true]`, and `style` containing `display:none`/`visibility:hidden`.
   - **Cleaning:** strip bidi controls (U+202A–U+202E, U+2066–U+2069), zero-width characters
     (U+200B–U+200F, U+FEFF) and **soft hyphens (U+00AD)** **[A]**, so words don't split and report
     text can't be visually reordered.
   - A page with fewer than 20 words of block text → the lens reports `no_text`: "This page shows
     almost no text in its HTML — it may build its text with JavaScript, which this check doesn't
     run."
6. **Lens contract** (`src/lib/tools/lens.ts`): `Lens { id, tool, pages: { max, sample: "none" |
   "sitemap" }, analyze(pages, ctx): LensResult }`. `ctx` = `{ now, finalUrl, hostname }`.
   - `LensResult = { summary, findings }`.
     - `summary`: `headline`, `verdict` (`pass | warn | fail | info | skipped`), `facts:
       {label, value}[]` ≤ 8, `score?`.
     - `findings` (generic `Finding`): `page`, `kind`, `match` (≤ 80), `before`/`after` (≤ 120),
       `note?` (≤ 300), `suggestion?` (≤ 80), `code?` (≤ 1,000), `imageSrc?` (`https`, ≤ 2,048).
   - `boundFindings(findings, { dedupeKey })` keeps ≤ 40, and collapses findings repeated across
     pages (a footer ©, a logo) into the first, with "Also on N other pages" in `note`.
   - The report page needs **no per-tool renderer**: `code` renders in `CodeBlock`; `imageSrc` as a
     "View image" link (`rel="noopener noreferrer nofollow ugc"`), **never an `<img>`**. A
     hotlinked image would hand every report viewer's IP to the scanned site **[A]**.
   - Shared helper `src/lib/tools/lenses/language.ts` (`isLikelyEnglish(pages, tokens)`) for s99
     and s100.
   - Registry: `src/lib/tools/lenses/registry.ts` (server-only), one line per lens.
7. **Report schema v1** (`src/lib/tools/report/report-schema.ts`): `{ v: 1, tool, url, finalUrl,
   scannedAt, summary, findings, pages: { url, status: "checked" | "skipped", reason? }[],
   truncated }`.
   - `serializeReport` keeps **compact JSON ≤ 12 KB (`Buffer.byteLength`)** by dropping findings
     from the end and setting `truncated`. The DB CHECK is 16 KB on `report::text`, which prints a
     space after every `:` and `,`. The 4 KB gap is the headroom **[A]**, and a DB test inserts the
     largest report the app can produce, multibyte text included.
   - `parseStoredReport` re-validates on **read**: shape, caps, `http(s)` page URLs, `https`
     image sources. A row that fails is a logged 404.
8. **Storage** `public.tool_reports` (migration below):
   - RLS on, one policy `FOR ALL TO service_role`; enumerated revokes; postconditions.
   - `SELECT, INSERT, DELETE` for `service_role`; immutable rows.
   - **Budget:** TTL 30 days, ≤ 16 KB per row and **≤ 5,000 rows**: ≤ 80 MB worst case on Supabase
     Free's 500 MB (going over makes the whole database read-only **[A]**). Typical rows are 2–6 KB.
     Under a spike the ceiling can retire rows before 30 days; the 404 says so.
   - Research records today's `pg_database_size` before the push. The ops doc carries the size query.
   - The cache is the same table: `cache_key = $1 AND created_at > now() - 24h AND expires_at >
     now()`, newest first, `LIMIT 1`.
   - Two concurrent misses on one URL can both scan and insert. That is harmless (the cache returns
     the newest) and bounded by the burst limiter, so there is no Redis lock.
9. **Cleanup**: `public.prune_tool_reports(p_max_rows integer DEFAULT 5000)`.
   - `LANGUAGE sql SECURITY INVOKER`: not a definer, so `function-grants` (definer-only) is
     untouched. EXECUTE goes to service_role only. One function, because two deletes are a
     multi-step write.
   - Called by `GET /api/cron/tool-reports-cleanup`: `isAuthorizedCronRequest` first, daily
     `15 3 * * *` in `vercel.json`. It logs the counts and is idempotent.
10. **Sampling** (`src/lib/tools/scan/sample-pages.ts`), for `sample: "sitemap"`:
    - `<final origin>/sitemap.xml`, following one child of an index (≤ 2 fetches).
    - `<loc>` read with a linear, bounded scanner: no XML parser, so no DTD or entity expansion **[A]**.
    - URLs on the **final** host only; non-HTML extensions dropped; dedupe; sorted by path depth,
      then length; ≤ 9.
    - No sitemap → `sameHostLinks`.
    - Pages not reached by the 20 s deadline are `skipped` (`time_limit`), and the report says it is
      partial. A page over the size cap is `skipped` (`too_large`) **[A]**.
11. **Typo lens** (`src/lib/tools/lenses/typos/`), precision first.
    - **Dictionary:** `wordlist-english` (`english`, `english/american`, `english/british`,
      `english/canadian`, `english/australian`, sizes ≤ 70), a band map for ranking, and
      `SUPPLEMENT_WORDS` (web and business vocabulary, ≤ 300, lowercase, sorted, unique). Loaded
      once per isolate.
    - **Tokenizer:**
      - URLs and emails removed;
      - letter runs with internal `'`/U+2019;
      - hyphen parts checked separately;
      - contractions reduced (`'s`, `n't` with an exception set, `'re`, `'ve`, `'ll`, `'d`, `'m`).
    - **Not flagged:**
      - digits, length < 3 or > 24;
      - ALL CAPS, inner capitals;
      - a non-initial Capitalised word;
      - words in `title`, `siteName` or hostname labels;
      - any word used ≥ 3 times across the scanned pages.
    - **Flagged** only with a Damerau-1 candidate among common bands (sizes ≤ 50). At most **500
      unique unknown words** get suggestion work per scan **[A]**. Words without a candidate are
      counted, never listed.
    - **Repeated words:** adjacent identical words, minus a pinned allowlist.
    - **Language gate:** `lang` set and not `en*`, or > 40% unknown → `skipped`.
    - **False-positive budget [A]:** before review, run the lens on 20 live public homepages
      (fetched at execution, never committed). Record ≤ 1 false positive per site on average and 0
      on ≥ 15 of 20 in the execution notes.
12. **Pages and SEO.**
    - `/tools` and `/tools/website-spell-checker` are static server pages under the marketing
      policy (`data-theme="light"`, the `/compare` and `/try` pattern, composed from
      `src/components/ui/`).
    - JSON-LD `buildWebApplicationLd({ url, name, description })` (new in `json-ld.ts`; s98 uses the
      same signature) emits:
      - `@type: "WebApplication"`;
      - `applicationCategory: "UtilitiesApplication"`;
      - `operatingSystem: "Web"`;
      - `isAccessibleForFree: true`;
      - `offers: { "@type": "Offer", price: 0, priceCurrency: "USD" }`;
      - no rating or review (ADR 032 §5).
    - Plus `buildBreadcrumbListLd` / `buildFAQPageLd` over a visible FAQ.
    - OG through `src/lib/tools/og-image.tsx` (`ImageResponse`, no gradient); each tool segment has
      `opengraph-image.tsx` / `twitter-image.tsx`. No page text is ever drawn into an image.
    - `/tools` has an **"About our scanner"** section: what the UA is, what is fetched (≤ 12 public
      pages, once per 24 h per address), what is stored, and how a site owner opts out (denylist on
      request; the contact address is an open question while the support mailbox bounces).
13. **Report page** `src/app/tools/[slug]/r/[id]/page.tsx` (+ `layout.tsx` awaiting `connection()`,
    `not-found.tsx`):
    - Full-path routing: `/tools/website-spell-checker/r/:id` resolves to `[slug]`, confirmed by
      the analyst; research records the build route table.
    - `requireUuid` before any read; a non-UUID never reaches Postgres (else 22P02 → 500 **[A]**).
    - The slug must be a catalogue entry with a lens **and** equal the row's `tool`, else 404.
    - **Nonce policy:** `usesNoncePolicy` (`content-security-policy.ts:42`) also matches
      `^/tools/[^/]+/r/[^/]+/?$` **only**. Deeper paths keep the static policy and static 404, so no
      nonce-less 404 page exists. Rendered per request, no ISR.
    - The scan form enters a report with **`window.location.assign(reportUrl)`**, a new document
      (architecture.md § CSP: "The policy belongs to the current document"). Every link to a report
      is a native `<a>`.
    - `robots: { index: false, follow: false }`. Not in the sitemap. **Not** disallowed in
      `robots.ts`, so the noindex stays readable.
14. **CTA copy**, pinned in `src/lib/tools/cta-copy.ts`. Variant `"fix-on-page"`, label "Fix it on
    your live page". Sub-line:
    > "Opens our free preview. On desktop, click the line on your own page and retype it. Only your
    > tab changes, and nothing is saved. Install ReCopyFast to keep the change; visitors see it on
    > their next page load."

    Footnote:
    > "Search engines that don't run JavaScript keep reading your original text. Fix
    > search-critical copy in your site's source."

    - `href="/try?utm_source=tools&utm_medium=<slug>&utm_campaign=free_tools#install"`.
    - Variant `"alt-text"` (for s101; `/try` cannot edit alt): label "Fix alt text on your live
      page", links `/signup` and `/docs/install`, no `/try`; wording per
      `docs/plans/s101-alt-text-checker.md`. Catalogue entries carry `cta`.
    - The CTA never implies we edit titles, meta tags or what crawlers see **[A]**.
    - Sign-up links are native `<a>`. `ToolCta.tsx`, `ToolScanForm.tsx`, `FindingList.tsx` and
      `src/app/tools/page.tsx` join `MARKETING_BOUNDARY_FILES`
      (`app-document-boundary-links.test.ts:14`).
15. **Middleware**: `isSessionlessPath` (`middleware.ts:113`) gains `/tools` (segment-exact) and
    `/api/tools/`, with a comment.
    - The nonce for a report path is still computed first (`:137-139` runs before the sessionless
      return), so the report gets its nonce with no GoTrue round trip.
    - Nothing under `/tools` is protected.
16. **Logs** carry tool, host, outcome and `durationMs`. They never carry the full URL, the client
    address, page text or exception text to the caller.
17. **Docs and commits.**
    - **Docs commit:**
      - `docs/stories.md`: the s96–s101 entries plus the `:1408-1410` amendment;
      - `docs/gtm/search-and-tools.md`;
      - research and design docs;
      - this plan;
      - ADR 062: the exception, the nonce for reports, the dependency licences including SCOWL's
        notice;
      - AGENTS.md: a Data access sentence;
      - `docs/architecture.md`: the integration row, the data model, and the CSP section's path list;
      - `docs/operations/free-tools.md`: limits, the storage query, the kill switch, the denylist,
        usage SQL.
    - **Migration commit:** the SQL alone.
    - **Story commit:** everything else.

## Migration sketch — `supabase/migrations/20261011120000_tool_reports.sql`

```sql
-- ============================================================
-- tool_reports: free-tool scan reports — service role only (s96, ADR 062)
-- ============================================================
-- WHY NO anon POLICY. A report is public to whoever holds its link, so
-- "USING (true) TO anon" looks right — and it would let anyone with the public
-- anon key run GET /rest/v1/tool_reports?select=* and list every scanned
-- address (pre-launch staging hosts included). Unguessable ids only protect
-- anything if there is no listing. So no web principal gets a policy or a
-- grant; the report page reads ONE row by id through the service role, with a
-- fixed projection (ADR 062; named exception like ADR 046). Shape precedent:
-- editor_verification_codes (20260801100000:183-189). Revokes enumerated,
-- never REVOKE ALL (20261008100000's reasoning).
-- SIZE. The app caps compact JSON at 12 KB; report::text prints ", " and ": ",
-- so 16 KB here is the ceiling with headroom, not the app's budget.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tool_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tool        text        NOT NULL CHECK (tool ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  cache_key   text        NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  url         text        NOT NULL CHECK (char_length(url) <= 2048 AND url ~ '^https?://'),
  report      jsonb       NOT NULL CHECK (
                jsonb_typeof(report) = 'object'
                AND octet_length(report::text) <= 16384),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT tool_reports_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS tool_reports_cache_lookup_idx
  ON public.tool_reports (cache_key, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_reports_expires_at_idx
  ON public.tool_reports (expires_at);
CREATE INDEX IF NOT EXISTS tool_reports_created_at_idx
  ON public.tool_reports (created_at DESC);

ALTER TABLE public.tool_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages tool reports" ON public.tool_reports;
CREATE POLICY "Service role manages tool reports"
  ON public.tool_reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.tool_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.tool_reports TO service_role;

-- Expired rows first, then the oldest beyond the ceiling. One function: two
-- deletes are a multi-step write (AGENTS.md). INVOKER — runs as service_role,
-- so function-grants.test.ts (SECURITY DEFINER only) is not involved.
CREATE OR REPLACE FUNCTION public.prune_tool_reports(p_max_rows integer DEFAULT 5000)
RETURNS TABLE (expired bigint, trimmed bigint)
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  WITH e AS (DELETE FROM public.tool_reports WHERE expires_at <= now() RETURNING 1),
       keep AS (SELECT id FROM public.tool_reports
                WHERE expires_at > now()
                ORDER BY created_at DESC LIMIT greatest(p_max_rows, 0)),
       t AS (DELETE FROM public.tool_reports r
             WHERE r.expires_at > now() AND NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = r.id)
             RETURNING 1)
  SELECT (SELECT count(*) FROM e), (SELECT count(*) FROM t);
$$;
REVOKE EXECUTE ON FUNCTION public.prune_tool_reports(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_tool_reports(integer) TO service_role;

-- Postcondition: the push aborts if any web principal kept anything.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_privileges
             WHERE table_schema = 'public' AND table_name = 'tool_reports'
               AND grantee IN ('PUBLIC', 'anon', 'authenticated')) THEN
    RAISE EXCEPTION 'tool_reports: a web principal holds a table privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.column_privileges
             WHERE table_schema = 'public' AND table_name = 'tool_reports'
               AND grantee IN ('PUBLIC', 'anon', 'authenticated')) THEN
    RAISE EXCEPTION 'tool_reports: a web principal holds a column privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p
             WHERE p.polrelid = 'public.tool_reports'::regclass
               AND p.polroles <> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'service_role')]) THEN
    RAISE EXCEPTION 'tool_reports: a policy names a role other than service_role';
  END IF;
  IF has_function_privilege('anon', 'public.prune_tool_reports(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.prune_tool_reports(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'tool_reports: prune function executable by a web principal';
  END IF;
END $$;
```

Rollback: a new forward migration dropping the function and the table. Deploy order: either order
is harmless (no reader before the app ships; the app tolerates no table only in that it 503s
scans; the report page 404s).

## Tasks (ordered, test-first)

0. [x] **Docs commit** per decision 17. Research confirms (all but `pg_database_size`, which needs production access and is left to the architect):
   - Vercel's `x-forwarded-for` overwrite;
   - the Sentry v10 propagation default;
   - the route table for `[slug]/r/[id]`;
   - today's `pg_database_size`.

   Baseline: the targeted suites green on `7185da5`.
1. [x] **Address classifier, extracted.**
   - RED `src/lib/security/__tests__/public-address.test.ts`:
     - Refused, each verified against ipaddr.js 2.2 on 2026-10-11: `127.0.0.1`, `10.1.2.3`,
       `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1` (carrierGradeNat), `0.0.0.0`,
       `255.255.255.255`, `224.0.0.1`, `198.18.0.1`/`192.0.2.1` (reserved), `::1`, `::`, `fe80::1`,
       `fd00:ec2::254` (uniqueLocal: AWS IMDS v6), `::ffff:169.254.169.254` (mapped → linkLocal),
       `::ffff:7f00:1`, `64:ff9b::a9fe:a9fe` (rfc6052), `2002:7f00:1::` (6to4), `2001::1` (teredo).
     - Unreadable → refused.
     - Allowed: `1.1.1.1`, `2606:4700:4700::1111`.
   - GREEN: move `refusalFor`/`RANGE_DESCRIPTIONS`/`unwrapHostname` into
     `src/lib/security/public-address.ts`; `webhook-url-safety.ts` imports them. **Every existing
     webhook suite passes unchanged.**
2. [x] **URL normalisation, cache key, denylist.**
   - RED `src/lib/tools/scan/__tests__/normalize-url.test.ts`:
     - `example.com` → `https://example.com/`; `HTTP://Example.COM:80/a?b#c` → `http://example.com/a`;
     - user info refused; `:8080` → `blocked_port`;
     - `javascript:`/`file:`/`ftp:`/`data:`/`blob:` refused;
     - `example.com.` → `example.com` in href and both keys;
     - `bücher.example` → `xn--bcher-kva.example`;
     - `http://[fe80::1%25eth0]/` refused (WHATWG throws, verified);
     - `http://2130706433/`, `http://0x7f.1/`, `http://0177.0.0.1/` normalise to `127.0.0.1` (verified;
       refused in task 3);
     - control characters and 2,049 chars refused;
     - the cache key is stable and tool-scoped;
     - the denylist matches host and subdomains, not look-alike suffixes (`evilexample.com`).
   - GREEN `normalize-url.ts`, `cache-key.ts`, `denylist.ts`.
3. [x] **Pinned-address fetcher.**
   - RED `src/lib/tools/fetch/__tests__/safe-fetch.test.ts`. It runs a real `http.createServer` on
     127.0.0.1, counting connections, with an injected resolver and policy:
     - **IP literals [A]:** `http://127.0.0.1:<port>/`, `[::1]`, `2130706433`, `0x7f.1`,
       `[::ffff:7f00:1]` with the **default** policy → `blocked_address` **and the server's
       connection count is 0**. A redirect to `http://169.254.169.254/` → refused, 0 connections there.
     - The default policy refuses the test host; a mixed answer refuses the host.
     - **Rebinding:** the resolver answers allowed then refused on alternate calls; each connection
       reaches only the address its own lookup validated (assert `remoteAddress`); a later hop that
       rebinds is refused.
     - `{ all: true }` and single lookup shapes.
     - Redirects: 3 ok, 4 → `redirect_limit`; to `file:`, `:8080`, a private host or a denylisted
       host → refused; relative `Location` resolves.
     - Timeouts: hung server → `timeout`; trickle → `timeout` (injected 200 ms).
     - Size: `content-length` 3 MB → `too_large` with no body read; streamed 2 MB + 1 →
       `too_large`; 30 KB gzip → 20 MB stops at ≤ 2 MB decompressed (assert the counter); `br` and
       `deflate` decode; a `.gz` sitemap decodes.
     - MIME: `application/json` / missing type → `not_html`.
     - Charset: `iso-8859-1` and `windows-1252` "café" and curly quotes decode.
     - Status: 404 → `http_status`.
     - Headers: captured from the allowlist, truncated. `NODE_USE_ENV_PROXY=1` + `HTTP_PROXY`/
       `HTTPS_PROXY` at a dead port → still direct, and the lookup ran. No `cookie`/`referer`
       sent; UA exact.
     - `MAX_REQUESTS_PER_SCAN` enforced across hops.
     - **No resolved address appears in any refusal string.**
   - GREEN `validating-lookup.ts`, `safe-fetch.ts`, `captured-headers.ts`.
4. [x] **Extraction.**
   - RED `src/lib/tools/extract/__tests__/extract-page.test.ts`:
     - excluded elements; hidden and `aria-hidden`;
     - entities; inline merge; whitespace;
     - bidi, zero-width and soft-hyphen stripped (`spell­ing` → `spelling`);
     - `<base href>` resolves relative image and link URLs;
     - `metaRefresh` captured; < 20 words → `no_text`;
     - caps; `title`/`lang`/`siteName`/`generator`/`metaCsp`;
     - images (null vs "", `data-src`/`srcset` fallback, `inLink`/`linkHasText`); scripts; root
       attributes; same-host links;
     - malformed and binary input and a 2 MB page never throw; 2 MB in < 2 s.
   - GREEN `extract-page.ts`, `package.json` (`parse5` `^7.3.0`).
5. [x] **Sampling.**
   - RED `sample-pages.test.ts`:
     - final host only; one index level; `.pdf`/`.jpg` dropped; dedupe; shallow first; ≤ 9;
     - fallback to links;
     - `<!DOCTYPE … [<!ENTITY …>]>` is inert (no expansion);
     - a 2 MB pathological sitemap in < 1 s.
   - GREEN.
6. [x] **Lens contract and Typo lens.**
   - RED, all with synthetic fixtures (`src/lib/tools/lenses/typos/__tests__/`):
     - `dictionary.test.ts`;
     - `tokenize.test.ts`: U+2019 contractions, soft-hyphen-free input, URLs and emails;
     - `suggest.test.ts`: recieve/seperate/accomodation/definately/becuase;
     - `typo-lens.test.ts`: the exact corpus findings; one row per skip rule; repeated words;
       language gate; caps; the 500 unique-unknown cap; the "N unrecognised" count;
     - `src/lib/tools/lenses/__tests__/language.test.ts`;
     - `lens.test.ts` (`boundFindings` dedupe and "Also on N other pages").
   - GREEN:
     - `lens.ts`, `lenses/registry.ts`, `lenses/language.ts`, `lenses/typos/*`;
     - `next.config.ts`: `serverExternalPackages: ["wordlist-english"]`,
       `outputFileTracingIncludes: { "/api/tools/scan": ["./node_modules/wordlist-english/*.json",
       "./node_modules/wordlist-english/Copyright"] }`;
     - test `src/__tests__/next-config-tools-packaging.test.ts`.
7. [x] **Report schema and store; migration (its own commit).**
   - RED `report-schema.test.ts`:
     - round trip;
     - compact ≤ 12 KB enforced by truncation;
     - `parseStoredReport` refuses `javascript:` pages, `http:` image sources, oversized strings,
       unknown versions, extra or prototype keys.
   - RED `report-store.test.ts` (schema-strict fake client): cache filters and order;
     `getReportById` projection and the `expires_at` filter; insert errors surface.
   - RED `src/__tests__/db/tool-reports-privileges.test.ts`, modelled on `edit-sessions-privileges`:
     - RLS on, exactly one `service_role` policy;
     - no table or column privilege for PUBLIC/anon/authenticated (TRUNCATE, REFERENCES and TRIGGER
       included);
     - `SET LOCAL ROLE anon`/`authenticated` SELECT and INSERT → 42501;
     - the CHECKs;
     - **the largest app-serialisable report (12 KB compact, multibyte) inserts** **[A]**;
     - `prune_tool_reports` expired-then-ceiling, not executable by web roles;
     - the migration re-applied converges.
     - Added to `REPLAY_SUITES` (`scripts/run-db-invariants.mjs:42`).
     - PostgREST step: an anon-key `GET /rest/v1/tool_reports` returns no row (401/404), named in the
       `ci.yml` e2e DB step beside `content-write-privileges`.
   - GREEN: migration, `report-schema.ts`, `report-store.ts`.
8. [x] **Scan route.**
   - RED `src/__tests__/api/tools/scan-route.test.ts` (dependencies mocked at module boundaries):
     - **Same-origin [A]:** `text/plain` → 415; `Sec-Fetch-Site: cross-site` → 403;
       `Origin: https://evil.example` → 403. All before any limiter (assert no `checkLimit`).
       Same-origin and no-header clients pass.
     - **Client key:** `unknown` IP → 403, no limiter.
     - **Limiter order:**
       - burst refused → 429 before the body is read;
       - store down → 503;
       - cache hit → 200 `cached: true`, no daily/48/global/target check, no fetch;
       - miss → daily, /48 (IPv6), global, target, then fetch;
       - each refusal → nothing fetched or stored.
     - **Global refusal:** its own message, logged at `error`.
     - **Bad input:** malformed JSON, 4,097 bytes, unknown `tool`, a lens-less catalogue entry,
       bad URL, denylisted host → 400/422 fixed text.
     - **Failures:** fetch failures → 422 `reason`, nothing stored.
     - **Success:** stores, returns `reportUrl` `/tools/website-spell-checker/r/<uuid>`.
     - **Errors and switches:**
       - insert error → 503, logged;
       - `TOOLS_SCAN_DISABLED=1` → 503;
       - a bad `TOOLS_SCAN_GLOBAL_DAILY_CAP` → the constant.
     - **Always:** no `Access-Control-Allow-Origin`; deadline → a partial report.
   - RED `client-key.test.ts`: IPv4; IPv6 → /64 and /48; `::ffff:1.2.3.4` → `1.2.3.4` **[A]**;
     `unknown` → null.
   - GREEN `route.ts`, `run-scan.ts`, `limits.ts`, `rate-limiter.ts` presets and identifier types.
9. [x] **Pages and components.**
   - RED:
     - **`ToolScanForm.test.tsx`:**
       - labelled `type="url"` input; the query-string hint;
       - pending state, `Skeleton` and a polite status;
       - 400/403/415/422/429/503 → destructive `Alert` with the server message, never the empty
         state;
       - success → `window.location.assign(reportUrl)` only for `/tools/<slug>/r/<uuid>`.
     - **`FindingInSentence.test.tsx`:** hostile strings render as text; `<mark>` wraps only
       `match`, with SR text; the suggestion is shown.
     - **`FindingList.test.tsx`:**
       - grouping and exact `rel`;
       - non-http → no link;
       - `code` → `CodeBlock`;
       - `imageSrc` → a "View image" link and **no `<img>` element**;
       - zero findings → success `Alert`; `skipped`/`no_text` → info.
     - **`ToolCta.test.tsx`:** both variants' exact copy and links; the `alt-text` variant has no
       `/try`; native sign-up anchor.
     - **`tools-pages.test.tsx`:**
       - canonical and `og:url`;
       - JSON-LD (`WebApplication`/`BreadcrumbList`/`FAQPage` = the visible FAQ);
       - "About our scanner" present;
       - the forbidden-claims list (the llms-txt suite's, plus "free plan", "free forever",
         "no login", "instantly", "any website", "works everywhere").
     - **`tool-report-page.test.tsx`:**
       - non-UUID → 404 with no client constructed;
       - unknown or expired → 404;
       - invalid stored JSON → 404, logged;
       - slug ≠ row tool → 404;
       - valid → findings and CTA;
       - robots `noindex, nofollow`;
       - neither the anon nor the cookie client used.
     - `json-ld.test.ts`: `buildWebApplicationLd`.
     - A grep test: no `dangerouslySetInnerHTML` under `src/components/tools/` or `src/app/tools/`.
   - GREEN:
     - **App pages:**
       - `src/app/tools/page.tsx`;
       - `website-spell-checker/{page,opengraph-image,twitter-image}.tsx`;
       - `[slug]/r/[id]/{layout,page,not-found}.tsx`.
     - **Components:** `src/components/tools/{ToolScanForm,ToolPageLayout,ToolCard,ToolCta,
       ReportSummary,FindingList,FindingInSentence}.tsx`.
     - **Lib:** `src/lib/tools/{catalogue,cta-copy}.ts`, `og-image.tsx`, `json-ld.ts`.
     - `MARKETING_BOUNDARY_FILES` += 4.
10. [x] **Discovery, CSP path and middleware.**
    - RED:
      - **`src/__tests__/app/tools-discovery.test.ts`:**
        - the hub renders exactly the live entries;
        - every live slug has `src/app/tools/<slug>/page.tsx`;
        - lens entries ↔ registry lines;
        - slugs unique and match the DB CHECK.
      - **Discovery files:**
        - `sitemap.test.ts`: `/tools` and tools in, no `/r/`;
        - `llms-txt.test.ts`: a "Free tools" section, with every link in the sitemap;
        - `robots.test.ts`: report path not disallowed;
        - `seo-canonicals.test.ts`: the two pages added, **and the report page in the NOINDEX list** **[A]**.
      - **CSP and middleware:**
        - `src/lib/security/__tests__/content-security-policy.test.ts`: `usesNoncePolicy` is true
          for `/tools/x/r/<id>` and `/tools/x/r/<id>/`, false for `/tools`, `/tools/x`,
          `/tools/x/r` and `/tools/x/r/<id>/y`;
        - `nonce-routes-render-dynamically.test.tsx`: the report layout awaits `connection()`;
        - `middleware-matcher.test.ts`: `/tools`, `/tools/x/r/y`, `/api/tools/scan` sessionless;
          `/toolsx` not.
    - GREEN:
      - `sitemap.ts` (`buildStaticSitemapRoutes` takes the catalogue);
      - `llms-txt.ts` (`buildLlmsTxt(siteUrl, comparisons, tools)`);
      - `content-security-policy.ts` (a `NONCE_POLICY_PATH_PATTERNS` constant beside the prefixes,
        with a comment);
      - `middleware.ts`;
      - `Footer.tsx` "Free tools".
11. [x] **Cleanup cron.**
    - RED `src/__tests__/api/cron/tool-reports-cleanup.test.ts`:
      - wrong bearer → 401, no RPC;
      - right → `rpc("prune_tool_reports", { p_max_rows: 5000 })`, counts logged, 200;
      - RPC error → 500;
      - `vercel.json` has the path once, daily.
    - GREEN the route and `vercel.json`.
12. [x] **Sentry propagation (if research confirms the default propagates) [A].**
    - RED `src/__tests__/sentry-trace-propagation.test.ts`: the server and edge configs set
      `tracePropagationTargets` to the app origin and the realtime origin only.
    - GREEN the two configs.
    - If research shows v10 does not propagate by default, the test pins that the option stays
      unset, with the evidence in a comment.
13. [x] **Privacy copy.** `src/app/privacy/page.tsx`, a "Free tools" paragraph (owner-approved
    wording). `legal-pages-truth.test.tsx` pins:
    - the 30-day storage statement;
    - the query-string removal;
    - the 24-hour rate-limit key;
    - the opt-out sentence.
14. [x] **Playwright** `e2e/tools.spec.ts`, +3. Against the CI production build with the disposable
    Supabase stack. Moves `watchScriptViolations` from `e2e/csp.spec.ts` to
    `e2e/support/csp-violations.ts` (no behaviour change).
    1. `/tools` → tool → `/tools/website-spell-checker`: hydrated, no script CSP violation,
       canonical.
    2. Seed a row (`e2e/support/local-supabase.ts`, service role); `page.route('**/api/tools/scan')`
       answers its id; submit → a **new document** at the report:
       - the response CSP has a nonce;
       - the typo is inside `<mark>` in its sentence;
       - the CTA `href` starts `/try?utm_source=tools`;
       - robots `noindex`.
    3. A seeded report with `<img src=x onerror=alert(1)>` and `<script>…</script>` in
       `before`/`match`/`after`: no `dialog` event, no CSP violation, the strings visible as text.
    - Count 93 → 96 in:
      - `playwright.config.ts`;
      - `.github/workflows/ci.yml`: lines 205, 255, 407, 449–451, 456 on `7185da5`;
      - the contract test: comment, name and five expects.
    - A real end-to-end scan is impossible by design (no environment bypass). Task 3's real-socket
      suite proves the network behaviour.
15. [ ] **Gates, measurements and mutations.** _(Done except the real scan on a Vercel preview, which needs the migration applied — deferred to the architect; see `docs/reviews/s96-free-tools-platform.md`.)_
    - **Gates and builds:**
      - `npm test`, `type-check`, `type-check:build`, `lint`, `format:check`;
      - offline `build`: `/tools` and the tool page `○`, the report `ƒ`; the scan route's `.nft.json`
        lists `wordlist-english/*.json` and `Copyright`;
      - `build:embed --check`, `audit:prod`;
      - the DB replay; `playwright test --list` = 96;
      - **one real scan on a Vercel preview** (record the URL, duration and that the dictionary
        loaded) **[A]**.
    - **Measurements:** the false-positive budget (decision 11) and Lighthouse (budgets below).
    - **Coverage:** floors raised in `jest.config.js` and `release-gates.test.ts`, never lowered.
    - **Mutations** (each red, then restored):
      - the literal-host check removed;
      - the lookup returns an unvalidated address;
      - `agent: false` removed;
      - the query is kept;
      - decompressed bytes not counted;
      - the redirect hop is not re-validated;
      - the same-origin guard removed;
      - the burst limiter moved after the body read;
      - a cache hit spends the daily allowance;
      - the IPv4-mapped unwrap removed;
      - `<mark>` via `dangerouslySetInnerHTML`;
      - `imageSrc` as `<img>`;
      - the report page without `parseStoredReport`;
      - the nonce pattern widened to `/tools`;
      - the anon GRANT re-added;
      - the capitalised-word skip removed;
      - the language gate removed.

## Tests added (summary)

| Layer | Files | Asserts |
|---|---|---|
| Unit | `public-address`, `normalize-url`, `cache-key`, `denylist`, `client-key`, `extract-page`, `sample-pages`, `lens`, `language`, `typos/{dictionary,tokenize,suggest,typo-lens}`, `report-schema`, `report-store`, `next-config-tools-packaging`, `json-ld`, `content-security-policy`, `sentry-trace-propagation` | Guards, caps, precision, schema-on-read, nonce path |
| Network (real socket, Jest) | `safe-fetch.test.ts` | Literal IPs open 0 sockets; pinning; rebinding; redirects; timeouts; zip bomb; MIME; charset; proxy-ignore; no IP echo |
| API route | `api/tools/scan-route.test.ts`, `api/cron/tool-reports-cleanup.test.ts` | Same-origin guard, limiter order, fail-closed, no work when refused, kill switch |
| Component / page | `ToolScanForm`, `FindingInSentence`, `FindingList`, `ToolCta`, `tools-pages`, `tool-report-page`, `tools-discovery`, `sitemap`, `llms-txt`, `robots`, `seo-canonicals`, `middleware-matcher`, `nonce-routes-render-dynamically`, `app-document-boundary-links`, `legal-pages-truth` | Escaping, states, SEO, claims, boundaries |
| DB / RLS | `db/tool-reports-privileges.test.ts` (replay + PostgREST step) | No web principal reads, lists or writes; CHECKs; largest report fits; prune |
| E2E | `e2e/tools.spec.ts` (+3 → 96) | CSP-clean render; report as a nonce document; stored-XSS inertness |

## Security notes

- **SSRF:**
  - Literal IPs are classified before connect (Node skips `lookup` for them).
  - Hostnames connect only to addresses their own lookup validated.
  - Every redirect hop is re-normalised and re-guarded.
  - Ports 80/443 only; no user info.
  - `agent: false` keeps any env proxy out (verified).
  - WHATWG normalises decimal, hex and octal IPv4 and refuses zone ids (verified).
  - Refusal text never echoes an address.
- **CSRF and drive-by:** JSON content type plus `Sec-Fetch-Site`/`Origin` checks before any store,
  so no third-party page can spend our caps from its visitors' browsers.
- **DoS:**
  - burst, daily, /48, global and per-target limits;
  - 8 s per request, a 20 s deadline, `maxDuration` 30;
  - ≤ 24 requests and concurrency 3 per scan;
  - the decompressed-byte cap, extraction caps, linear scanners;
  - the 500 unique-unknown-word cap;
  - kill switch and denylist.
  - Reflection against one host is ≤ 20 scans an hour, and ≤ 500 × 24 requests a day even with
    wildcard subdomains.
- **Caching:** a cache hit reveals only a scan of the same public URL. The query string is never
  part of it.
- **PII:**
  - no client address is stored (Redis keys only, TTL ≤ 24 h, never logged);
  - URLs are stored without query or fragment;
  - excerpts are public text, ≤ 120 characters either side;
  - 30 days; `/privacy` says so;
  - logs carry the host only;
  - no thumbnails, so report viewers' IPs never reach scanned sites;
  - no Sentry trace headers to scanned sites (task 12).
- **Stored XSS:**
  - React text nodes only (grep test);
  - URLs validated on write **and** read; bidi, zero-width and soft hyphens stripped;
  - JSON-LD through `serializeJsonLd`; no page text in OG images;
  - the report route is under the nonce policy, so an escaping bug would still not run an injected
    inline script or handler.
- **Enumeration:** no web-principal grant on `tool_reports`; UUIDv4 ids; no listing route;
  noindex.
- **SEO abuse:** reports are noindex, outside the sitemap, and their links are `nofollow ugc`.

## Performance budgets

| Budget | Target | How measured |
|---|---|---|
| `/tools`, tool page (mobile, ADR 013/061 profile) | perf ≥ 0.9, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms | `lighthouserc.cjs` settings against `next start`, 5 runs median, recorded (joining the s17 CI gate is follow-up) |
| Tool page client JS | ≤ marketing baseline + 15 KB gz; no `framer-motion`/`three` | `next build` route table |
| Report page | Dynamic SSR, one PK read; server p95 ≤ 300 ms | route timing |
| Single-page lens scan | p50 ≤ 3 s, p95 ≤ 8 s | `durationMs` log |
| Typo scan, 10 pages | p95 ≤ 20 s (deadline), partial beyond | same |
| Dictionary cold load | ≤ 100 ms, ≤ 20 MB heap (measured 58 ms / 8 MB) | unit log |
| Extraction | 2 MB HTML < 2 s; a scan's peak heap < 300 MB | unit test; local `process.memoryUsage` |
| Storage | compact ≤ 12 KB/report, ≤ 5,000 rows (≤ 80 MB) | CHECK + prune + ops query |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| False positives (brands, jargon, UK spelling) | Five dialects, flag-only-with-suggestion, pinned skip rules, the language gate, the measured 20-site budget, "possible typo" wording |
| `wordlist-english` not traced on Vercel | `serverExternalPackages` + `outputFileTracingIncludes` + a config test + the `.nft.json` check + a real scan on a preview |
| Report links die early under a spike (ceiling) or after 30 days | The 404 explains and offers a new scan; the TTL and ceiling are open questions |
| A launch spike hits the global cap | An env override, a distinct message, an `error` log, ops SQL |
| Site owners object to being scanned | The honest UA linking to "About our scanner"; the env denylist; ≤ 12 requests per 24 h per URL. The contact address depends on the support mailbox gate (open question) |
| The nonce policy on reports costs CDN caching | One PK read per view (acceptable); the hub and tool pages stay static |
| s97–s101 conflicts | Only `catalogue.ts` (+1), `registry.ts` (+1) and the three Playwright count files; s96 freezes `ExtractedPage`, `Finding`, `LensResult` and the CTA variants |
| Vercel `x-forwarded-for` trust | Research re-confirms (the s77 review says Vercel overwrites it); `unknown` fails closed |

## Merge points with the other tool stories

- **s96 owns:**
  - `src/lib/tools/{lens,catalogue,cta-copy}.ts`;
  - `fetch/`, `extract/`, `scan/`, `report/`;
  - `lenses/{registry,language}.ts`;
  - `src/components/tools/*`, `src/app/tools/{page.tsx,[slug]/}`;
  - the migration;
  - the middleware, CSP-path, sitemap, llms, json-ld, footer, privacy and Sentry edits;
  - `docs/stories.md`.
- **Later stories:** one catalogue entry, one registry line, their own `lenses/<id>/` and
  `app/tools/<slug>/`, their own `e2e/tools-<id>.spec.ts`, and the Playwright count.

## Architect decisions (2026-10-11)

> Binding answers to the open questions of s96–s101, recorded by the architect when the plans
> were validated. Where they differ from the plan above, they win.


1. Report TTL: 30 days.
2. Global daily cap: 500 scans/day, env override `TOOLS_SCAN_GLOBAL_DAILY_CAP` for launch day.
3. Site-owner opt-out: the scanner fetches and honours `robots.txt` for its user agent (Disallow for `RecopyFastToolsBot` or `*` on the path → refuse with reason `robots_disallowed`, 422, fixed message). "About our scanner" page explains the robots.txt opt-out. The env denylist stays as the operator override. No email address is published until support@ works.
4. Turnstile: deferred to a later story (s96b), built only when the global cap is actually hit.
5. CTA measurement: CTA links carry `utm_source=tools&utm_medium=free_tool&utm_campaign=<slug>`. Capturing UTMs at sign-up is a separate later story.
6. s97 style-src: say plainly the editor's styles need the site's `style-src` to allow our origin; never recommend `'unsafe-inline'`; link /docs/install.
7. s97 per-platform steps: yes, name where custom code goes for Wix, Squarespace, Shopify, Framer and Webflow, each with a link to the vendor's own doc (verified at implementation time).
8. s101 claims-ledger row: the s101 PR adds "Alt Text Checker finds missing, empty or filename-like alt text. It never claims accessibility compliance." to docs/gtm/launch-2026-09-28.md §12.
9. /privacy and /terms: add only factual wording — what a scan processes (the submitted URL without query, public page text, the caller's IP used only for rate limiting and never stored), that reports are public to anyone with the link and deleted after 30 days, and how to opt out (robots.txt).
10. A scan refused by the per-site limit still counts against the caller's daily allowance.
