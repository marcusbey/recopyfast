# Implementer self-check — s96-free-tools-platform

> **Not the review.** This is the implementer's own check, written for the architect's independent
> review that follows. The gate lines at the end stay `pending` until that review sets them.

Branch `feature/s96-free-tools-platform`, from `main` `f4ecaa8`, with `origin/main` `9541589`
(s98, #92) merged in (not rebased). Plan: `docs/plans/s96-free-tools-platform.md`
(validated by the architect, 2026-10-11, decisions appended). No production access was used.

## Commits

| SHA | Commit |
|---|---|
| `7ecf704` | docs: the s96–s101 stories and validated plans |
| `65497ad` | docs: ADR 062, research, design, runbook, GTM research, AGENTS.md / architecture.md |
| `a42aac2` | feat: the `tool_reports` migration, alone |
| `ca4719f` | feat: the story code and tests |
| `c0ec987` | merge `origin/main` (s98): calculator joins the catalogue, "Free tools" crumb, count 97 |

## What was checked, and how

| Gate | Command / method | Result |
|---|---|---|
| Unit, component, route | `npx jest` (merged tree) | 482 suites passed, 6,782 tests passed, 38 skipped (pre-existing) |
| Type check | `npm run type-check`, `npm run type-check:build` | clean |
| Lint / format | `npm run lint`, `npm run format:check` | 0 errors (34 pre-existing warnings), formatted |
| DB / RLS (PG17 replay) | `RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/run-db-invariants.mjs` | 16 suites, 121 passed, 1 skipped (pre-existing); `tool-reports-privileges` named in `REPLAY_SUITES` |
| DB / RLS (PostgREST) | the CI e2e job's DB step, against `supabase start` (CLI 2.117.0, local) | `tool-reports-privileges` 20/20 incl. "anon GET lists nothing", "anon POST refused"; `content-write-privileges`, `function-grants`, `rls-policies`, `column-privileges` green |
| Build | `npm run build` (CI e2e env, local Supabase) | `○ /tools`, `○ /tools/website-spell-checker`, `○ /tools/website-maintenance-cost`, `ƒ /tools/[slug]/r/[id]`, `ƒ /api/tools/scan` |
| Packaging | `.next/server/app/api/tools/scan/route.js.nft.json` | lists `wordlist-english/*.json`, `Copyright`, `index.js`, `expose.js` |
| Playwright | `CI=true npx playwright test --list` | **97** (93 + s98's 1 + s96's 3) |
| Playwright, executed | full strict suite against the merged production build, local Supabase, Redis and WS server (the CI e2e job's env) | **97 passed, 0 failed, 0 skipped, 0 flaky** |
| Embed | `node scripts/build-embed.mjs --check` | unchanged: 45,818 / 33,059 (ceilings untouched) |
| Dependencies | `npm run audit:prod` | 0 vulnerabilities |
| Coverage | `npx jest --coverage` (pre-merge tree) | 74.66 / 68.21 / 72.19 / 75.37 (statements / branches / functions / lines); floors raised 68/61/65/69 → 73/67/71/74 in `jest.config.js` and `release-gates.test.ts` |
| Lighthouse (mobile, ADR 061 profile, 5 runs, median, pre-merge build) | `lhci collect/assert` with `lighthouserc.cjs` | `/tools` 0.98, LCP 1,657 ms, CLS 0.001, TBT 94 ms; `/tools/website-spell-checker` 0.98, LCP 1,653 ms, CLS 0.001, TBT 95 ms |
| One real scan (local production build) | `POST /api/tools/scan` for `www.gov.uk` against `next start` on local data | 200 in 2.2 s, 10 pages checked, dictionary loaded through the runtime `require`; the same URL with `?utm=1` → `cached: true`; `text/plain` → 415; `169.254.169.254` → 422 `blocked_address` |

## False-positive budget (plan decision 11)

The plan's rules alone, run on 20 public homepages (homepage only, robots.txt honoured, fetched
once each, nothing committed), produced far more than the budget: first names at the start of
team cards and testimonials ("Jason", "Laura", "Fred and Brian met…"), brands ("Zapier →
zanier"), menu abbreviations and tech words ("tech → teach", "admin → admit"), craigslist's city
lists. Each class seen got a rule, each rule a fixture, each fixture a mutation that turns it red:

- the suggestion must keep the word's first letter;
- a Capitalised word is never flagged, sentence-initial included (**a deviation**, below);
- blocks of fewer than 4 words (menus, name cards, buttons) are not checked;
- a block whose lower-case words are over 40% unknown is skipped (gov.uk/cymraeg: Welsh text
  under `lang="en"`, seen on the real scan);
- no-vowel words, tripled letters, short words ending in a period, elisions, code-like text
  (`cos(`, `.ing`), hyphen parts of ≤ 4 letters; triplet repeats; a larger supplement.

Re-measured on the same saved homepages:

| | Findings | False positives | Sites with none |
|---|---|---|---|
| Plan rules only (first run; webflow.com unreachable, so 19 sites) | 129 | 127 | 4 of 19 (2 of them skipped pages) |
| Final (squarespace.com in for webflow.com; 20 sites) | 7 | **5** (daringfireball: `ing`, `dinger`, `commoditizes`, `utopic`; joelonsoftware: `assed`) | **18 of 20** |

Mean **0.25 false positives per site**, zero on 18 — within the budget (≤ 1, zero on ≥ 15). The two
true positives were real typos on live pages (`wordlwide` on smashingmagazine.com, `annd` on
css-tricks.com). Sites: basecamp, mailchimp, wordpress.org, gov.uk, python.org, mozilla.org,
stripe, 37signals, smashingmagazine, css-tricks, alistapart, daringfireball, paulgraham,
joelonsoftware, nngroup, ycombinator, gumroad, ghost, craigslist, squarespace.

## Mutations (each red, then restored)

All of the plan's list, plus the rules added above:

literal-host check removed · lookup returns an unvalidated address · `agent: false` removed ·
query kept · decompressed bytes not counted · redirect hop not re-validated · robots not re-asked
on a redirect hop · denylist not applied on a redirect · same-origin guard removed · burst
limiter after the body read · a cache hit spends the daily allowance · IPv4-mapped unwrap removed
· `<mark>` via `dangerouslySetInnerHTML` · `imageSrc` as `<img>` · report page without
`parseStoredReport` · nonce pattern widened to `/tools` · the anon GRANT re-added (PG17 replay:
3 tests red) · capitalised-word skip removed · language gate removed (ratio; and the `lang` check
in both of its layers together) · first-letter rule · short-block rule · foreign-block rule ·
frequent-word rule · identity-word rule · no-vowel / tripled · elision · abbreviation ·
code-like · short hyphen part · repeated-word prose rule · triplet repeat · Sentry targets unset.

Every one is **killed**. (Removing the `lang` check in only one of its two layers stays green by
design: either layer alone skips the page.)

## Deviations from the plan, and why

1. **robots.txt** (architect decision 3) is added to the fetch pipeline: per origin, once per scan,
   RFC 9309 matching, on every hop; 4xx allows, 5xx/unreachable refuses with the real reason,
   `robots_disallowed` otherwise. The "About our scanner" section explains it; no email address.
2. **CTA UTMs** follow architect decision 5 (`utm_medium=free_tool&utm_campaign=<slug>`), not the
   plan's `utm_medium=<slug>&utm_campaign=free_tools`.
3. **Capitalised words are never flagged**, at a sentence start either — the plan checked
   sentence-initial ones. Measured above: on live homepages they were almost all names.
4. **Extra precision rules** (above), all measured, all pinned.
5. **parse5 is bounded** (depth 512, 100,000 elements, 1.5 s in 16 KB chunks through parse5's
   streaming `Parser`). Not in the plan: parse5's tree construction is quadratic, and 200 KB of
   `<ul><li>` took 18 s (research fact 5). A refused page is reported as too large/complex.
6. **Extra 422 reasons**: `redirect_invalid` (a redirect to `file:`/`javascript:`) and
   `unreachable` (connection refused, TLS failure, bad encoding); `no_text` is a stored report
   state (the lens's "skipped"), never a 422.
7. **Origin check** accepts `resolveSiteUrl()`'s origin **or the request's own origin**, so a
   preview deployment can scan its own form. A browser cannot forge `Origin`; a non-browser
   client sends none and is metered like anyone else.
8. **Migration postcondition** uses `has_table_privilege` / `has_any_column_privilege` /
   `has_function_privilege` (as `20261008100000` does) rather than `information_schema`, whose
   rows depend on the running role; and it also revokes UPDATE/TRUNCATE/REFERENCES/TRIGGER from
   the service role, so rows are immutable as the plan states.
9. **`ToolScanForm`** takes an optional `navigate` prop (default `window.location.assign`) so the
   test can observe navigation: jsdom's `location` cannot be redefined. A source test pins the
   default.
10. **The Playwright helper move** also moved `isHydrated` with `watchScriptViolations` (no
    behaviour change).
11. **Coverage floors** were set one point below the integer under each local measurement, since
    CI's environment differs slightly from the local run.
12. **No design mockup `.html`**; the design is the `.md` only.
13. **Docs commits**: the plan's single docs commit is two (stories/plans first, as the
    orchestrator asked; ADR and research second).

## Not done here (needs the architect)

- **`pg_database_size` before the push** — needs production access (query in the runbook).
- **One real scan on a Vercel preview** — needs the migration applied to the database the
  preview uses. The local production-build scan above is the substitute evidence; the
  `.nft.json` check covers the tracing.
- **Migration not applied** to any remote database.
- The `docs/stories.md` acceptance boxes for s96 are left for the review to tick.

## Open risks

- **Precision on the open web.** The budget held on 20 well-known sites; small-business sites
  (Wix, Squarespace, Shopify) will differ. Rare real words SCOWL lacks ("dinger", "utopic") will
  still be flagged now and then; the copy says "possible typo".
- **Recall.** Capitalised words, short lines and foreign-looking blocks are never checked.
- ~~**NAT64 local-use prefix** `64:ff9b:1::/48` is allowed~~ — refused since the security
  review fix pass (minor 2 below).
- **CPU per scan.** Extraction is bounded per page (≤ ~1.5 s); a hostile 10-page scan could use
  ~15 s of CPU, under the 30 s `maxDuration`, metered by the daily and global caps.
- **Soft 404.** As for every streamed page under the root `loading.tsx`, a missing report is
  rendered with a 200 status and `noindex`; the report is `noindex` anyway.
- **The `Origin` relaxation** (deviation 7) is the one place this differs from the plan's
  stricter check.
- **Turnstile** stays deferred (s96b); the global cap and its `error` log are the trigger.

## Security review of `c57f2a9`: findings and fixes

The independent security review of `c57f2a9` found `Max severity: major` and set `Ship allowed: no`.
Every finding is fixed in the commit after `c57f2a9`, test-first (each new test was red on the old
code, except where noted). The gate lines below stay `pending` for the re-review.

### Major 1 — a decompression bomb hung `safeFetch` past every timeout

**Finding.** A ~200 KB gzip body that inflates to 200 MB never settled. The decoded-byte counter
threw only after the response had finished arriving. `pipeline`'s callback then never fired, and
the abort signal could not help because the socket was already closed. A scan hung until the
function was killed. Deflate and brotli bodies behaved the same way.

**Fix** (`src/lib/tools/fetch/safe-fetch.ts`, `readBody`):

- The read settles exactly once, on whichever comes first: the first `error` from any stream
  (response, decoder or counter), the abort signal, or the `pipeline` callback.
- Settling removes the abort listener and calls `destroy()` on every stream.
- The deflate wrapper Transform, which had no `destroy` path, is gone. `safeFetch` reads the
  first chunk, puts it back with `unshift`, and picks `createInflate` (zlib header) or
  `createInflateRaw` from it. Every decoder is now a plain zlib stream that can be destroyed.

**Tests** (loopback fixtures only; bombs built in-process by
`src/lib/tools/fetch/__tests__/bombs.ts`, each decoding to 200 MiB):

| Body | Size on the wire |
|---|---|
| gzip | 203,861 B |
| deflate (zlib) | 203,849 B |
| deflate (raw) | 203,843 B |
| brotli | 317 B |

- `safe-fetch.test.ts` checks gzip, deflate (zlib), deflate (raw) and brotli. Each must resolve
  `too_large` within a 4 s deadline, having counted at most 2 MB + 256 KB decoded.
  - Before the fix, 3 of the 4 timed out at 30 s. Only the 30 KB → 20 MB bomb from phase 1
    passed.
- `run-scan.test.ts` uses `deadlineMs` 3000 and a margin of 1500 ms. It covers:
  - a bombed robots.txt: the scan fails `too_large`;
  - a bombed homepage: the scan fails `too_large`;
  - a bombed sitemap: the scan falls back to the homepage's links;
  - a bombed sitemap page: the page is skipped as too large.

  All four ran past 5 s on the old code.
- A guard test (green before and after): an endless gzip stream is refused `too_large`, and the
  server sees its connection close within 1 s.

**Timings**, as wall-clock milliseconds over 3 runs after the fix:

| Test | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `safeFetch` gzip bomb, Jest (includes building the bomb, ~390 ms) | 405 | 406 | 402 |
| `safeFetch` deflate bomb, Jest | 396 | 410 | 410 |
| `safeFetch` deflate-raw bomb, Jest | 390 | 398 | 398 |
| `safeFetch` brotli bomb, Jest (bomb build ~190 ms) | 193 | 189 | 196 |
| `safeFetch` gzip, fetch only (tsx, bomb prebuilt) | 20 | 13 | 11 |
| `safeFetch` deflate, fetch only | 20 | 76 | 10 |
| `safeFetch` deflate-raw, fetch only | 20 | 19 | 8 |
| `safeFetch` brotli, fetch only | 20 | 18 | 155 |
| `runScan` bombed robots.txt | 19 | 21 | 19 |
| `runScan` bombed homepage | 7 | 7 | 7 |
| `runScan` bombed sitemap (falls back) | 65 | 56 | 58 |
| `runScan` bombed sitemap page | 10 | 9 | 11 |

Every fetch-only run counted 2,113,536 decoded bytes before refusing.

### Minor 2 — IPv6 allowed more than global unicast

**Fix** (`src/lib/security/public-address.ts`). An IPv6 address that ipaddr.js calls `unicast`
must now also be inside `2000::/3`. It must not be in any of these ranges:

- `64:ff9b:1::/48` (NAT64 local-use, RFC 8215);
- `2001:db8::/32` (documentation);
- `3fff::/20` (documentation, RFC 9637);
- `2001:2::/48` (benchmarking).

This also refuses `::7f00:1`, `fec0::/10` (deprecated site-local) and `5f00::/16`. The rule is
shared with the webhook guard, whose suites stay green and whose refusal wording is unchanged.

**Tests** (`src/lib/security/__tests__/public-address.test.ts`):

- Refused:
  - `64:ff9b:1::1`;
  - `::7f00:1`, `fec0::1` and `5f00::1`;
  - `3fff::1` and `3fff:fff::1`;
  - `2001:db8::1` and `2001:db8:ffff::1`;
  - `2001:2::1`.
- Still allowed:
  - `1.1.1.1` and `::ffff:1.1.1.1`;
  - `2606:4700:4700::1111`, `2001:4860:4860::8888` and `2a00:1450:4001:80b::200e`.

### Minor 3 — the per-target cap was keyed on the submitted host only

> Superseded in round 2 (minor 3 below): the final-host-only charge became a charge on every hop.

**Finding.** A site could redirect to a victim and spend the victim's scans from its own bucket.
Subdomains (`a.example.com`, `b.example.com`) also each had a bucket of their own.

**Fix:**

- **`src/lib/tools/scan/registrable-domain.ts`.** The key is now the registrable domain (eTLD+1),
  computed with `getDomain(host, { allowPrivateDomains: true })`. A host on a private suffix
  such as `*.vercel.app` or `*.myshopify.com` keeps its own bucket. IP literals and unknown
  suffixes fall back to the host itself.
  - The function comes from `tldts` 6.1.86 (MIT). It was already in the lockfile through jsdom
    → tough-cookie and is now a direct dependency, a one-line lockfile change.
- **`src/app/api/tools/scan/route.ts`.** The route charges the submitted host's registrable domain
  before the scan.
- **`src/lib/tools/scan/run-scan.ts`.** After the homepage's redirects, `runScan` calls
  `authorizeFinalHost` when the final registrable domain differs. The route charges that domain
  in the same `tools/scan:target` bucket. A refusal stops the scan before any further request
  (`target_limited`). The route returns that limiter's own response: a 429, or a 503 when the
  store is down.
- A redirect within the same registrable domain is not charged twice.

**Tests:**

- `registrable-domain.test.ts` (15 cases), including:
  - `www.example.com` → `example.com`;
  - `a.b.example.co.uk` → `example.co.uk`;
  - private suffixes keep their own host;
  - IPs, `localhost` and bare suffixes fall back to the host.
- `run-scan.test.ts`:
  - a redirect to another domain is refused, with no `/sitemap.xml` request;
  - the same redirect is allowed when the limiter allows it;
  - a same-domain redirect (`www.`) is not charged.
- `scan-route.test.ts`:
  - eTLD+1 identifiers are used;
  - a final-host refusal returns 429 and stores nothing;
  - a store outage at the final-host check returns 503;
  - an allowed final host returns 200 and stores the report.

### Minor 4 — the rate-limit key's expiry slid; reports could vanish before 30 days

**Finding 1.** The rate-limit key's expiry slid forward on every check. `rate-limiter.ts`
re-armed `EXPIRE windowMs` each time, so a key in active use outlived its window, by up to ~48 h
for a daily window.

**Fix 1.** The expiry is now absolute: `PEXPIREAT key windowEnd` (Redis ≥ 2.6). Every check in a
window sets the same instant. This applies to every limiter. *(Round 2, minor 1 below: this
introduced a regression; the expiry is now `windowEnd + 10 s`.)*

**Existing test changed (stated per AGENTS.md).** `src/__tests__/security/redis-rate-limiter.test.ts`:

- The mock pipeline gains `pExpireAt`.
- "two commands" now expects `pExpireAt` once and `expire` never.
- "scopes the key" expects `pExpireAt(key, (window + 1) × windowMs)` instead of `expire`.
- New test: a daily window's two checks set the same `windowEnd`, never later.

The other limiters' suites are unchanged and green.

**Finding 2.** At full volume, the 5,000-row trim can delete a report after about 10 days. The
copy promised 30.

**Fix 2.** The copy now says "kept for up to 30 days" in:

- the report page;
- `/privacy` §1.4 and its retention table;
- `/terms`;
- the hub FAQ and the "About the scanner" block, which also says older reports can be removed
  sooner when many scans run.

The design doc and the ops runbook match. The new wording is pinned by `legal-pages-truth`,
`tools-pages` and `tool-report-page`; `legal-pages-truth` also forbids "deleted after 30 days".

### Minor 5 — two invisible characters were not stripped

> Superseded in round 2 (nit 7 below): the list became the Unicode properties.

**Fix.** `INVISIBLE_CHARACTERS` in `src/lib/tools/text.ts` gains:

- U+061C, the Arabic letter mark (a bidi control);
- U+180E, the Mongolian vowel separator (no longer whitespace to `\s`).

**Test.** `extract-page.test.ts`: `"spell\u061cing check\u180eed"` extracts as "spelling checked".

### Mutations for this pass (each applied alone, then restored)

**Killed:**

- settle-on-stream-error replaced by a no-op (7 red);
- raw-deflate detection removed (2 red);
- the global-unicast rule removed (6 red);
- the final-host check never runs (1 red);
- the final-host check charges a same-domain redirect (1 red);
- the route keys the target on the raw host (1 red);
- the route never charges the final host (2 red);
- the limiter back to a sliding `EXPIRE` (3 red);
- U+061C and U+180E dropped (1 red).

**Survived, and why:**

- **`destroy()` on every stream removed.** On every error path the tests reach, `pipeline` also
  destroys its streams, so the socket still closes (the endless-body guard stays green). The
  explicit `destroy()` covers the case where `pipeline` never calls back.
- **Abort listener removed.** The request carries the same signal. On abort, Node destroys the
  response, which emits `error`, which settles the read. The listener is the second path for a
  stalled decoder.

## Security review of `ae249ad`: findings and fixes

Round 2 found 0 major, 4 minor and 4 nit findings. Minor 1 was a regression introduced by the
round-1 fix. All eight are fixed in the commit after `ae249ad`, test-first: every new test was red
before its fix, except the route rows marked "guard". The gate lines below stay `pending`.

### Minor 1 — `PEXPIREAT windowEnd` could delete a live counter (regression)

**Finding.** PEXPIREAT with a timestamp already in the past deletes the key. A MULTI built in a
window's last milliseconds that reached Redis after `windowEnd` — latency, or clock skew between
the instance and Redis — wiped the counter. Every later INCR in that window then returned 1. This
held for every limiter, including the fail-closed editor-login ones. The reviewer proved it on
Redis 7.2.7.

**Fix** (`src/lib/security/rate-limiter.ts`). The expiry is `PEXPIREAT key (windowEnd +
EXPIRY_GRACE_MS)`, with `EXPIRY_GRACE_MS = 10_000`, so it stays absolute. The key already ends in
the window index (`rate_limit:<type>:<id>:<endpoint>:<floor(now / windowMs)>`), so the grace never
lets two windows share a count. `REDIS_COMMAND_TIMEOUT_MS` (1,500 ms) is exported so the test can
pin `grace > timeout`. The stale "INCR+EXPIRE" comment in `src/app/api/health/route.ts` now says
"INCR+PEXPIREAT".

**Tests** (`src/__tests__/security/redis-rate-limiter.test.ts`):

- New: `Date.now()` is pinned to `windowEnd − 1`, and the MULTI "lands" at
  `windowEnd − 1 + REDIS_COMMAND_TIMEOUT_MS`. The expiry sent must be later than that instant,
  the key must name the ending window, and `EXPIRY_GRACE_MS > REDIS_COMMAND_TIMEOUT_MS`.
- Changed (stated per AGENTS.md): "scopes the key" and "same instant on every check" now expect
  `windowEnd + EXPIRY_GRACE_MS`.

**Live check** against local Redis 7.4.11, three INCR + PEXPIREAT pipelines in a row:

| Expiry sent | Third INCR | Key exists after |
|---|---|---|
| `windowEnd`, already past (round 1) | 1 | no |
| `windowEnd + 10 s` | 3 | yes |

### Minor 2 — non-LDH hosts escaped the registrable-domain key

**Finding.** `tldts` validates host names by default and answered null for `-a.victim.com`,
`a-.victim.com` and `a!b.victim.com`. The key then fell back to the full host, so wildcard DNS
gave every invented subdomain a bucket of its own.

**Fix:**

- **`src/lib/tools/scan/registrable-domain.ts`.** `getDomain(host, { allowPrivateDomains: true,
  validateHostname: false })`.
- **`src/lib/tools/scan/normalize-url.ts`.** Every host-name label must match
  `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`, checked after WHATWG lower-cases the host and turns
  IDN into punycode. IP literals are exempt: IPv4 digits are LDH anyway, and IPv6 is bracketed.
  A refusal is the existing `invalid_url`. Every redirect hop and sitemap URL goes through the
  same normaliser, so they are refused the same way.

**Tests:**

- `registrable-domain.test.ts`: `-a.`, `a-.`, `a!b.` and `a_b.victim.com` each map to
  `victim.com`.
- `normalize-url.test.ts` refuses:
  - `-a.`, `a-.`, `a!b.` and `a_b.victim.com`;
  - an empty label (`a..victim.com`);
  - a 64-character label.
- `normalize-url.test.ts` keeps:
  - `a-b.` and `123.victim.com`;
  - IDN as punycode;
  - a 63-character label;
  - IPv4 and IPv6 literals.
- `scan-route.test.ts` (guard): the three listed hosts get a 400 with the invalid-URL text and
  never reach the scan.

### Minor 3 — other domains a scan reached were not charged

**Finding.** Only the homepage's final domain was charged, and only after it had been fetched.
Fetches of robots.txt, sitemaps and pages, and every intermediate redirect hop, reached other
registrable domains without being charged.

**Fix:**

- **`src/lib/tools/fetch/safe-fetch.ts`.** A new `authorizeHost` option is asked on every hop,
  after the denylist and before the URL authoriser, so before the hop's robots.txt fetch too. A
  reason refuses the hop with the new failure reason `target_limited`.
- **`src/lib/tools/scan/run-scan.ts`, `createTargetAuthorizer`.**
  - It keeps a per-scan map of verdicts, seeded with the submitted domain, which the route has
    already charged.
  - Each new registrable domain is charged once. Concurrent hops share the pending verdict.
  - A throwing charge counts as a refusal.
  - The authorizer is in the base options of every fetch: robots.txt, the homepage, sitemaps and
    pages.
  - `authorizeFinalHost` is gone; `authorizeTargetDomain` replaces it.
- **What a refusal does, by resource:**
  - **The homepage's chain:** the scan fails `target_limited`. The route returns the limiter's
    429, and nothing is stored.
  - **A robots.txt:** ~~treated as unavailable. RFC 9309 allows this when a redirect cannot be
    followed (`robots.ts`).~~ **Wrong, and a misquote of RFC 9309** (verification review F1): a
    robots.txt reached within five redirects MUST be followed. Since the fix after `e7bdd09`, a
    refused charge on a robots.txt chain refuses what that robots.txt gates, like an unreachable
    robots.txt.
  - **A sitemap:** it is skipped, and the scan falls back to the homepage's links.
  - **A page:** skipped as "We couldn't fetch this page."
- **`src/app/api/tools/scan/route.ts`.** It records the first 429 and the first store failure. A
  store failure at any charge returns the fail-closed 503 and discards the scan, even a finished
  one.

**Tests.** In `run-scan.test.ts` the loopback fixture now routes and logs by host. "Zero
requests" means none to any `*victim.test` host, its robots.txt included.

- A homepage redirect to a limited domain: the scan fails `target_limited`, the domain is charged
  once, and the victim gets zero requests.
- ~~A robots.txt that redirects to a victim: the scan goes on, the victim is charged once, and it
  gets zero requests.~~ Flipped after the verification review (F1): the scan is now refused.
- A sitemap that redirects to a victim: the scan falls back to the homepage's links (both pages
  checked), and the victim gets zero requests.
- Two pages that redirect to `victim.test` and `www.victim.test`: the victim is charged once,
  both pages are skipped, the other page is checked, and the victim gets zero requests.
- The chain A → v1 → v2 → A, plus a page that redirects to v1 again: `["v1.test", "v2.test"]`,
  each charged exactly once.
- The chain A → v1 → victim (spent) → A: the scan fails `target_limited` and the victim gets zero
  requests.
- Unchanged: a domain the limiter allows lets the scan go on, and a `www.` redirect on the
  submitted domain is never charged.

In `scan-route.test.ts`:

- a refused page hop still gives a 200 with the report stored;
- a store failure at a page hop gives a 503 with nothing stored, even though the scan finished;
- the three earlier final-host tests now use the new option.

### Minor 4 — a nested decoder's output was not counted

**Finding.** A `.xml.gz` sitemap sent with `Content-Encoding: gzip` goes through two decoders, and
only the last one's output was counted. If the inner file is nothing but empty gzip members, it
decodes to 0 bytes while the outer layer inflates without limit. The reviewer measured a 0.86 GB
intermediate.

**Fix** (`readBody`). A byte counter capped at `maxBytes` follows every decoder.
`bytesRead` is the largest decoded count.

**Test** (`safe-fetch.test.ts`). The bomb is built by `nestedEmptyMemberBomb()` in `bombs.ts`:
511,273 B on the wire, whose outer layer holds 200 MiB of empty gzip members. It must resolve
`too_large` inside a 4 s deadline. Measured over 3 runs on loopback with a prebuilt bomb:

| Code | Run 1 | Run 2 | Run 3 | Result |
|---|---|---|---|---|
| Fixed | 22 ms | 10 ms | 10 ms | `too_large`, 2,113,536 bytes counted |
| `ae249ad` | 830 ms | 799 ms | 765 ms | `ok` with an empty body, after inflating the whole 200 MiB |

The Jest test takes 436, 445 and 478 ms, including ~437 ms to build the bomb.

### Nit 5 — a one-byte first chunk picked raw inflate

**Fix.** `isZlibHeader` decides from the first byte alone: `(b0 & 0x0f) === 8 && (b0 >> 4) <= 7`
means zlib, anything else means raw. The answer no longer depends on chunking.

**Test.** A zlib-wrapped deflate body and a raw one, each sent as a 1-byte first chunk and then
the rest 50 ms later, both decode. The zlib one was red before the fix.

### Nit 6 — an empty encoded body read as `unreachable`

**Fix.** The decoders are created only after the first chunk is peeked (`decodingFor` and
`decodersFor`). An empty body gets no decoder, for any Content-Encoding and for a gzip file.

**Test.** An empty 200 sent with `Content-Encoding` gzip, deflate or br reads as `ok` with body
`""`. All three were red, deflate included.

### Nit 7 — the invisible-character list was hand-kept

**Fix.** `INVISIBLE_CHARACTERS` is `/[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu`. Every
character in the old list is covered; checked on Node 24.14, nothing was left over. Letters,
digits and spaces are untouched.

**Test.** `extract-page.test.ts` strips each of U+034F, U+115F, U+3164, U+FE0F and U+E0041 from
`spell?ing`, leaving "spelling". The test source uses `\u` escapes, not literal characters.
*(Narrowed after the verification review, F2: variation selectors and tag characters are kept.)*

### Nit 8 — not-found copy and cleanup lag

**Fix.**

- `src/app/tools/[slug]/r/[id]/not-found.tsx` now says "kept for up to 30 days".
- `docs/operations/free-tools.md` notes that the daily 03:15 UTC cleanup lags expiry by up to
  about a day. An expired row is never served in that time, because every read filters on
  `expires_at > now()`.

**Test.** `tool-report-page.test.tsx` renders the not-found page and expects "kept for up to 30
days", never "kept for 30 days".

### Mutations for round 2 (each applied alone, then restored)

**Killed:**

- grace removed (3 red);
- grace below the command timeout (1 red);
- `tldts` validation back on (3 red);
- LDH check removed (9 red);
- hop charge removed (7 red);
- hop charge on the first hop only (5 red);
- per-scan verdict cache removed (8 red);
- a robots refusal fails the scan (1 red) — this pinned the F1 defect; the test it broke is the
  one flipped after the verification review;
- the route ignores a store failure on a finished scan (1 red);
- per-decoder counter removed (1 red);
- two-byte zlib check restored (1 red);
- empty-body skip removed (3 red);
- hand-kept list restored (5 red).

**Survived, and why:**

- **The host charge moved after the URL authoriser.** The robots.txt fetch that the URL
  authoriser makes carries the same `authorizeHost`. Even in that order, the victim's robots.txt
  request is refused before it is sent, and the victim still gets zero requests. The guard holds
  at two layers.

### Verification for round 2

- **Jest:** 483 suites passed, 2 skipped; 6865 tests passed, 38 skipped. This round added 39
  tests.
- **DB harness (PG17):** 16 suites, 121 passed, 1 skipped.
- **Playwright `--list`:** 97 of 97 expected.
- **`npm run build`:** passes.
- **Embed check:** up to date, at the byte ceiling (45,818 B of 45,818).
- **Type-check:** clean.
- **Lint of the changed files:** clean. The commit hooks run the full lint and type-check again.

## Verification review of e7bdd09

A fresh-context review of `e7bdd09`, PR #93's head. The reviewer did not change any code. Each
mutation below was applied on its own, run, restored with `git checkout`, and `git diff
--exit-code` was clean before this section was written.

### What was run

| Check | Result |
|---|---|
| `npx jest src/lib/tools src/lib/security --silent` | 21 suites, 541 tests, all passed |
| `npx jest redis-rate-limiter scan-route tool-report legal-pages tools-pages --silent` | 7 suites, 186 tests, all passed |
| Every test file that touches the limiter (74 files, `--runTestsByPath`) | 74 suites, 1,196 tests, all passed |
| Full `npx jest --silent` | 482 suites passed, 2 skipped, 1 failed; 6,864 tests passed, 38 skipped, 1 failed |
| `npx tsc --noEmit -p .` | exit 0 |
| `eslint --max-warnings=0` on the 17 source files changed by `e7bdd09` | exit 0 |
| `gh pr checks 93` | all green except "Comparison Lighthouse", still pending at review time |

The one failure in the full run is `src/__tests__/api/content/[siteId]/route.test.ts` (first-party
CORS). It is environmental:

- The test reads `NEXT_PUBLIC_APP_URL`, and this worktree has no `.env.local`.
- With that variable set, the file passes 42 of 42.
- The branch does not touch that route.

### Round-2 findings, checked against the code

| Round-2 finding | Verdict | Evidence |
|---|---|---|
| Minor 1, expiry at `windowEnd` | Fixed | `rate-limiter.ts:359` sends `windowEnd + EXPIRY_GRACE_MS`. The key still ends in the window index, so two windows never share a count. Only `redis-rate-limiter.test.ts` asserts on the expiry (grep for `pExpireAt` and `ttl` across `src` and `server`). `server/rate-limit.js` has its own `EXPIRE` and is untouched. |
| Minor 2, non-LDH hosts | Fixed | Checked in Node: tldts 6.1.86 returns null for `-a.`, `a-.`, `a!b.` and `..victim.com` with validation on, and `victim.com` with `validateHostname: false`. `normalize-url.ts:104` refuses non-LDH labels. Every redirect hop and sitemap URL goes through the same normaliser. |
| Minor 3, per-hop charge | Fixed, with one new defect (F1) | See "Is every hop charged?" below. |
| Minor 4, nested decoder | Fixed | `safe-fetch.ts:470` puts a capped counter after every decoder. |
| Nit 5, zlib sniff | Fixed | `safe-fetch.ts:303` reads byte 0 only. |
| Nit 6, empty encoded body | Fixed | `safe-fetch.ts:249` returns no decoder for an empty body. `peekFirstChunk` also resolves null on `error` and `close`, and a stall before the first byte is still ended by the request's abort signal. |
| Nit 7, invisible characters | Fixed, with a display side effect (F2) | The old list's 23 code points are all in the new set, checked over U+0000–U+10FFFF on Node 24.14; 4,151 code points are added. |
| Nit 8, not-found copy | Fixed | `not-found.tsx` says "up to 30 days"; the ops doc notes the cleanup lag. |

### Is every hop charged?

Yes. Every hop of every fetch type is charged before it can open a socket.

- **All four fetch types carry the charge.** All four `safeFetch(` calls are in `run-scan.ts`:
  - line 161, robots.txt;
  - line 173, the homepage;
  - line 193, the sitemap and its child;
  - line 208, the pages.

  Each one spreads `base`, which carries `authorizeHost`.
- **The charge comes before the socket and before DNS.** `safe-fetch.ts:542` awaits
  `authorizeHost` on every hop. It runs after the denylist and before the URL authoriser, the
  literal-address check, the request budget and `request()`. DNS only runs inside `request()`,
  through `lookup` at `:396`. So a refused host gets no socket and no name resolution.
- **A new host's robots.txt is covered too.** For a host first reached by a redirect, the robots.txt
  fetch is itself a `safeFetch` with `base.authorizeHost`. That host is charged, or refused,
  before the robots.txt socket opens.
- **There is no unguarded call site in production.** Leaving the charge out allows everything, but
  `runScan` has one production caller, `route.ts:252`, and it always passes
  `authorizeTargetDomain`. No code under `src/lib/tools` or `src/app/api/tools` makes an outbound
  request any other way.

### Can a scan that fails 503 midway leave anything behind?

Nothing is stored. Some caps stay spent, as documented.

- **Storage:** `insertReport` (`route.ts:283`) runs only after the `charges.storeFailure` check
  (`:265`).
- **Caps spent before the scan stay spent:** the caller's daily cap, the /48 cap, the global cap and
  the submitted domain's charge. This matches the route's documented rule that "a limiter counts
  when checked".
- **Other domains stay charged** if they were charged before the store failed.
- **The scan is not stopped.** It keeps fetching from domains it has already charged (at most 24
  requests and 20 s), and then the result is thrown away.

### Mutations (each applied alone, then restored)

| Mutation | Red |
|---|---|
| Host charge removed from `safeFetch` | 7 |
| Host refusal honoured on hop 0 only | 5 |
| Host refusal ignored for robots.txt fetches | 1 |
| robots.txt fetch built without `authorizeHost` | 1 |
| Submitted domain not pre-seeded in the per-scan map | 8 |
| Per-scan verdict cache removed | 4 |
| Route ignores `charges.storeFailure` | 2 |
| robots.txt `target_limited` no longer read as "unavailable" | 1 |
| `PEXPIREAT` back to `windowEnd` | 3 |
| LDH check removed | 9 |
| `validateHostname: true`, on the code line | 3 |
| Counter after the last decoder only | 1 |
| Two-byte zlib check | 1 |
| Empty-body skip removed | 3 |
| Hand-kept invisible-character list restored | 5 |
| Host charge moved after `authorizeUrl` | 0 |

The last row survived because it is an equivalent mutant: the robots.txt fetch charges the host
itself, so the victim still receives nothing. The implementer's note above says the same.

### New findings

**F1 — major — a robots.txt on another domain is ignored when that domain's bucket is spent.**

Where: `src/lib/tools/scan/robots.ts:188`, and the comment at `:16-18`.

What happens: `createRobotsAuthorizer` now reads `target_limited` as "no robots.txt" (`rules: []`),
so the scan goes ahead as if the site allowed everything.

How it is exploited:

1. Site S serves `/robots.txt` as a 301 to `T/robots.txt` on another registrable domain, which
   says `User-agent: * / Disallow: /`.
2. Anyone spends T's 20/hour bucket with 20 cache-missing scans of T.
3. A scan of S now runs robots-free: its homepage, sitemap and pages are fetched, and a public
   report is stored for up to 30 days.

A popular T can spend its own bucket with no attacker at all. The same path opens when the store
fails at that charge, because the route turns a 503 into `false`. The result is then discarded with
a 503, but the requests have already gone out.

Reproduced with a temporary loopback probe in `run-scan.test.ts`, removed afterwards:

- With T allowed, the scan returns `{ ok: false, reason: "robots_disallowed" }`.
- With T's bucket spent, it returns `ok: true` and requests `bakery.test/robots.txt`,
  `bakery.test/` and `bakery.test/sitemap.xml`.

This is a regression introduced by `e7bdd09`: at `ae249ad`, a robots.txt on another domain was always
fetched and obeyed. It contradicts:

- ADR 062 §5, accepted: robots.txt is honoured on every hop; only a 4xx allows, and an
  unreachable file refuses the scan.
- `/privacy`: "the scanner checks robots.txt before reading a page".
- RFC 9309 §2.3.1.2: a robots.txt reached within five redirects "MUST be fetched, parsed, and its
  rules followed". The RFC allows "unavailable" only after more than five redirects.

The `robots.ts` comment and the round-2 text above ("RFC 9309 allows this when a redirect cannot be
followed") misquote the RFC.

Fix, one line: drop `|| result.reason === "target_limited"`, so the verdict is "refused" with
`target_limited`.

- On the homepage's origin, the scan then fails `target_limited`, and the route returns its 429.
- On a page's origin, that page is skipped.
- The test at `run-scan.test.ts:297` flips to expect this. It is the only test that pins the
  current behaviour (mutation above: 1 red).

**F2 — nit — the Unicode property class changes the text shown in reports.**

Where: `src/lib/tools/text.ts:29-30`.

The stripped text is what a report shows:

- a finding's `match`, `before`, `after` and `code` (`lens.ts:94`, `:142`);
- every stored string on read (`report-schema.ts:140`), so older rows change too.

What is newly dropped from the displayed text:

- VS16: ❤️ becomes ❤, and 1️⃣ becomes 1⃣.
- Tag sequences: the England flag becomes 🏴.
- Ideographic variation selectors (U+E0100–E01EF) in CJK names.
- Mongolian free variation selectors.

What is not affected:

- ZWJ and ZWNJ were already stripped before `e7bdd09` (old range U+200B–U+200F), so this commit
  adds nothing for them.
- No false typos: the tokenizer is `[\p{L}\p{M}]+` (`tokenize.ts:29`), the lens is
  English-gated, and none of the added characters is a letter.

The comment "render as nothing" is wrong for ZWJ, ZWNJ, VS and FVS, which change how the
neighbouring glyphs render. The effect is cosmetic only.

**F3 — nit — the per-target charge is opt-in.**

Where: `run-scan.ts:73` and `:154-156`, `safe-fetch.ts:140`.

When `authorizeTargetDomain` is undefined, nothing is charged. Only tests leave it out today.
Making it required on `RunScanInput` would turn a future caller's omission into a type error.

**F4 — nit — some wording does not account for the grace.**

- `rate-limiter.ts:335-336` still says the key "expires exactly at `windowEnd`", and `:346` says
  "PEXPIREAT at `windowEnd`".
- `/privacy` (`page.tsx:174`) says the limiter holds an IP "for at most 24 hours". With the
  10-second grace it is now 24 hours plus 10 seconds.

**Observation (no severity).** A domain is charged before DNS runs, so a redirect to
`nothing.victim.com` spends `victim.com`'s bucket without any request reaching it. One scan can
spend one unit from each of about 23 domains. This comes with "charge before the first request"
and is bounded by the per-caller caps.

### Not verified, and what a human should do instead

| Not verified | Why | What a human should do |
|---|---|---|
| The grace against a real Redis | Only the mocked pipeline was run; the live Redis 7.4.11 table above was not reproduced | On Upstash, `PTTL` a fresh `rate_limit:*` key. Expect the window's remaining time plus about 10 s. |
| Real DNS and the real network | Every fetch ran on loopback with an injected resolver. "Charged before DNS" comes from reading the code. | After F1's fix, on a preview, scan a site whose robots.txt 301s to another domain with `Disallow: /`. Expect 422 or 429, and no report. |
| A store outage in the middle of a scan | The route's store-failure path was only run with a mocked `checkLimit` | No cheap gesture. Rely on the mocked test. |
| Emoji and flags in a rendered report | No page was rendered | On a preview, scan a page with a misspelt sentence next to ❤️ or a flag, and look at the excerpt. |
| Comparison Lighthouse | The CI job was still pending | Wait for it to go green before merging. |

Under this review's gate, only a critical finding blocks the ship. F1 is major, so the ship is
allowed. F1 is a one-line fix with its test already in place, so land it before merging.

## Fixes after the verification review of `e7bdd09`

The fix commit after `e7bdd09` lands all four findings test-first. Each new test was red before its
fix, except the T-allowed control, which is green either way. The gate lines at the end of this
file are the verification reviewer's verdict on `e7bdd09`; they are left as the reviewer wrote
them.

### F1 (major) — a robots.txt on another domain was ignored when that domain's bucket was spent

**Fix.**

- **`src/lib/tools/scan/robots.ts`.** `|| result.reason === "target_limited"` is removed. A
  refused charge on the robots.txt chain is now a refused verdict with reason `target_limited`,
  exactly like an unreachable robots.txt. Only a 4xx, or a non-text answer, still means "no
  robots.txt" (ADR 062 §5).
- **The comment now quotes RFC 9309 §2.3.1.2 correctly.** A robots.txt reached within five
  redirects MUST be fetched and followed; "unavailable" is allowed only past five.
- **The comments in `run-scan.ts` and `route.ts`** say the same.

**What a refusal now does:**

- On the homepage's origin, the scan fails `target_limited`. The route returns the limiter's 429
  and stores nothing.
- On a page's origin, that page is skipped.
- On a sitemap's origin, the sitemap is skipped, and the scan falls back to the homepage's links.

**Tests** (`run-scan.test.ts`):

| Scenario | Before the fix | After |
|---|---|---|
| S's robots.txt redirects to T, T spent (the flipped test) | `ok`, S scanned | `target_limited`; the only request is `bakery.test/robots.txt` |
| S → T, T says `Disallow: /`, T allowed (control) | `robots_disallowed` | `robots_disallowed`; requests `bakery.test/robots.txt` and `victim.test/robots.txt` |
| S → T, T says `Disallow: /`, T spent | `ok`, S scanned | `target_limited`; S's homepage is never fetched, T gets nothing |
| A page redirects to `other.test`, whose robots.txt redirects to a spent T | page checked | that page is skipped, `other.test/a` is never fetched, T gets nothing; the rest of the scan is checked |

**Mutations:**

- Reading `target_limited` as "no robots.txt" again: killed, 3 red.
- Reading `unreachable` and `target_limited` as "no robots.txt": killed, 3 red.

### F2 (nit) — emoji and flags lost their selectors in displayed excerpts

**Fix.** `INVISIBLE_CHARACTERS` is now:

```
/(?![\ufe00-\ufe0f\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}])[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu
```

- **Kept:** the variation selectors and the tag characters a flag is spelt with.
- **Still stripped, as before this PR series:** ZWJ and ZWNJ. Every character of the pre-PR list
  is still covered, checked on Node 24.14; 3,822 code points are stripped in total.
- **Comment fixed:** it no longer says these characters "render as nothing". The joiners change
  how their neighbours join.
- **No false typos:** a typo-lens probe finds no typo in "spell<U+FE0F>ing" or in a ❤️ next to
  prose, while still finding "recieve" in the same text.

**Tests** (`extract-page.test.ts`):

- Kept intact:
  - ❤️ (U+2764 U+FE0F);
  - the keycap 1️⃣;
  - the England flag (U+1F3F4, then tags, then U+E007F);
  - an ideographic variation sequence (U+845B U+E0100).

  All four were red before the fix.
- Still stripped: U+034F, U+115F, U+3164 and ZWJ.
- Removing the exclusion again is killed, with 4 red.

### F3 (nit) — the per-target charge was opt-in

**Fix.** The charge is now a required field in both places, so leaving it out is a type error:

- `RunScanInput.authorizeTargetDomain`;
- `SafeFetchOptions.authorizeHost`.

`runScan` always builds the target authorizer.

**Tests pass explicit allow-all stubs:**

- `safe-fetch.test.ts` `options()`: `authorizeHost: async () => null`;
- `run-scan.test.ts` `scan()`: `authorizeTargetDomain ?? (async () => true)`;
- the route test mocks call `input.authorizeTargetDomain(…)` without `?.`.

### F4 (nit) — wording that ignored the grace

**Fix:**

- **`rate-limiter.ts`.** The comments say the key expires at `windowEnd + EXPIRY_GRACE_MS`, while
  the reset time reported is `windowEnd`.
- **"at most 24 hours" → "about 24 hours"** in:
  - `/privacy`;
  - the scanner's "What we store" copy (`pages-copy.ts`);
  - the `client-key.ts` comment.

**Tests.** `legal-pages-truth` and `tools-pages` expect "about 24 hours" and forbid "at most 24
hours". Both were red before the fix.

### Verification for this fix

- **Jest**, with `NEXT_PUBLIC_APP_URL` set: 483 suites passed, 2 skipped; 6,871 tests passed, 38
  skipped. That is 6 more than at `e7bdd09`.
  - The first full run caught one miss: the child-process proxy test builds its own
    `safeFetch` options and lacked the newly required `authorizeHost`. It now passes an allow-all
    stub, and the suite is green.
- **DB harness (PG17):** 16 suites; 121 passed, 1 skipped.
- **Playwright `--list`:** 97 of 97 expected.
- **`npm run build`:** passes.
- **Embed check:** up to date, at the byte ceiling (45,818 B of 45,818).
- **Type-check:** clean.
- **Prettier and `eslint --max-warnings=0`** on every changed source file: clean.

Max severity: major
Ship allowed: yes
