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
window sets the same instant. This applies to every limiter.

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

Max severity: pending
Ship allowed: pending
