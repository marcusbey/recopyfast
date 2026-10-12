---
validated: yes (architect, 2026-10-11)
---
# Plan — Story s97-csp-checker

> CTO decision, 2026-10-11. Tool 3, "Will a script run on my site?". It answers launch-kit
> objection 5 (`docs/gtm/launch-2026-09-28.md` §8: "The one thing that stops it is a strict Content
> Security Policy").

Branch: `feature/s97-csp-checker`, from `origin/main` **after s96 merges**. Depends on s96's frozen
contracts: `ExtractedPage` (`headers`, `metaCsp`, `generator`, `scriptSrcs`, `scriptIds`,
`stylesheetHrefs`, `rootAttributes`), `Lens`, `Finding` (`code` ≤ 1,000), `LensResult.summary.facts`,
`catalogue.ts`, `lenses/registry.ts`, `ToolPageLayout`, `ToolScanForm`, and the generic report page.
s97 edits **none** of s96's files except one entry in `catalogue.ts` and one line in `registry.ts`.

Research: `docs/research/s97-csp-checker.md`. Design: `docs/designs/s97-csp-checker.md`: the
verdict states pass, warn, fail and "no policy"; the platform fact; `CodeBlock` lines; 390 px. No
migration, no dependency.

## Where the brief met the code

| Brief | Code says | Adaptation |
|---|---|---|
| Verdict for `<script src=…/embed/recopyfast.js>` + "a connect to recopyfast-ws.fly.dev" | The snippet also sets `data-api-url="<appOrigin>/api"` (`src/lib/sites/embed-script.ts:83-103`), and the widget fetches published copy from it (`recopyfast.src.js:49`). Without `connect-src` for the app origin, nothing loads | The verdict checks **three** visitor requirements: script, API connect, WS connect. WS is additive (architecture.md: "HTTP stays authoritative and realtime is additive"), so a blocked `wss:` is **warn**, not fail |
| `wss://` connect | The embed is WebSocket-only: `transports: ['websocket']` (`recopyfast.src.js:3127`) | Only `wss://recopyfast-ws.fly.dev` is checked, with no `https:` polling origin |
| Hard-coded origins | `INSTALLATION_EXAMPLE.appUrl` / `.wsUrl` (`src/lib/docs/installation-content.ts:73-103`) are the public install values | `requirements.ts` derives every origin from `INSTALLATION_EXAMPLE` and `buildEmbedScript`, so a domain move changes one place |
| "The exact directive additions" | Install guidance: "Do not remove CSP or add broad wildcard or unsafe-inline allowances" (`installation-content.ts:220`, `:310`). The editor injects six `<style>` elements (`recopyfast.src.js:1439, 2078, 2528, 4197, 4635, 5947`), all in editor paths (research confirms each) | Visitor lines are exact origins. For **editing**, a blocking `style-src` is reported ("the editor's on-page toolbar may look unstyled; visitors are unaffected") with **no** `'unsafe-inline'` recommendation. Open question for the owner |
| "Install recipe for that stack" | `install-recipes.ts` covers `wordpress`, `nextjs` and `html` only; `/docs/install` anchors are `#add-snippet` (sub-ids `html`, `builders`, `spa`) and `#troubleshooting` | Platform is a **fact with evidence**, and the link is `/docs/install#add-snippet`. No new per-platform instructions; the install content forbids claiming unverified platform integrations (`:310`) |
| — | 28 `innerHTML =` writes in the embed and no `trustedTypes` use | A policy with `require-trusted-types-for 'script'` gets a **warn**: "ReCopyFast's widget does not support Trusted Types yet" (research verifies the writes run on the visitor path) |

## CTO decisions

1. **One page** (`sample: "none"`, `pages.max: 1`). The homepage's response headers and `<meta>`
   policies are what the snippet would meet; other pages can differ, and the report says so.
2. **Every enforced policy must allow** a request (CSP: several policies intersect).
   - Policies come from each `Content-Security-Policy` header, comma-split into separate
     policies, and each `<meta http-equiv>`. A meta policy ignores `frame-ancestors`,
     `report-uri`, `report-to` and `sandbox`.
   - `-Report-Only` policies never block; they produce one info fact.
3. **Directive fallback, exactly as browsers apply it:**
   - script: `script-src-elem` → `script-src` → `default-src`;
   - connect: `connect-src` → `default-src`;
   - style element: `style-src-elem` → `style-src` → `default-src`.

   An absent chain allows.
4. **Source matching is CSP Level 3**, written from the spec text cited in research (§6.7.2.x:
   scheme-part match, host-part match with `*.` wildcards, port-part including the default port,
   path-part with the trailing-slash rule, `*`, `'self'` with the scanned origin, `'none'`).
   - The ws/wss ↔ http/https scheme equivalences are **not** written from memory: each row cites
     the spec, and the Chromium differential test (task 7) must agree.
   - `'strict-dynamic'` in an effective script list makes host, scheme and `'self'` sources
     ignored, so a parser-inserted `<script src>` without the page's nonce is blocked. The verdict
     explains that the snippet would need the page's nonce, which only the site's own code can add.
     It is not a line to paste.
   - A nonce or hash present without `'strict-dynamic'` leaves host sources working.
5. **Replacement lines, not "additions".** For each blocking policy and requirement, the plan emits
   the **full new directive**:
   - When the directive exists: its current sources plus our origin.
   - When the effective one was `default-src`: a new directive with `default-src`'s sources plus
     ours, because adding `script-src https://www.recopyfa.st` alone would drop `'self'` and break
     the site's own scripts.
   - Our origin is never `*`, never `https:`, never `'unsafe-inline'`.

   Lines are capped at 1,000 characters. A longer policy gets "Add `https://www.recopyfa.st` to
   your `script-src` directive" instead.
6. **Verdict copy** is pinned in `src/lib/tools/lenses/csp/copy.ts`. Plain English; never "works on
   any site"; never "secure/insecure".

   | State | Copy |
   |---|---|
   | **pass** | "Yes. Your site's security policy lets ReCopyFast's script load and fetch your published copy." |
   | **no policy** (pass) | "Yes. Your site sends no Content Security Policy, so nothing in it blocks the script." |
   | **fail** | "Not yet. Your security policy blocks {what}. Add the line below, or send it to whoever manages your site." |
   | **warn** | "Mostly. The script and your copy load, but {live updates / editor styles / Trusted Types}…" |

   The caveat is always shown:
   > "We read the policy your homepage sends to anyone. Other pages, plugins or a policy added after
   > the page loads can differ. To be sure, open the page with the /try bookmarklet."
7. **Platform detection** is a rules table (`detect-platform.ts`). Each rule has signals and a
   weight. Result: the highest-scoring platform when its score ≥ threshold and it beats the
   runner-up by a margin, else "unrecognised"; the evidence list is shown. Signals:

   | Platform | Signals |
   |---|---|
   | WordPress | `generator` ~ WordPress; `/wp-content/` or `/wp-includes/` assets |
   | Webflow | `html[data-wf-site]`/`data-wf-page`; `generator` Webflow; `website-files.com` assets |
   | Wix | `x-wix-request-id`; `generator` ~ Wix; `static.wixstatic.com`/`parastorage.com` |
   | Squarespace | `squarespace-cdn.com`/`static1.squarespace.com` assets; `server: Squarespace` |
   | Shopify | `x-shopify-stage`/`x-shopid`; `cdn.shopify.com` assets |
   | Framer | `generator` Framer; `framerusercontent.com` |
   | Next.js | `script#__NEXT_DATA__`; `/_next/static/` scripts; `x-powered-by: Next.js`; `x-nextjs-cache` |

   Platform-specific advice is limited to one sentence each that research verifies against the
   platform's own docs (e.g. where custom code goes). No plan-tier claims ("Wix premium") unless
   sourced and dated.
8. **No new fetch, header or extraction code.** s96 already captures the needed headers
   (`CAPTURED_RESPONSE_HEADERS`) and markup signals. If research finds a missing signal, it is
   added to s96's allowlist in a separate one-line commit named in the PR.

## Tasks (ordered, test-first)

1. [ ] **Parse.**
   - RED `src/lib/tools/lenses/csp/__tests__/parse-csp.test.ts`:
     - directive names case-insensitive; duplicate directive: first wins;
     - empty tokens and empty policies ignored;
     - comma-separated header → N policies;
     - meta drops `frame-ancestors`/`report-uri`/`report-to`/`sandbox`;
     - report-only kept separate;
     - a 4 KB header (the s96 cap) parses linearly; a garbage header never throws.
   - GREEN `parse-csp.ts`.
2. [ ] **Match.**
   - RED `source-match.test.ts`, ≥ 40 table rows, each citing the spec step in a comment:
     - `https:`, `http:` → https upgrade, `*`;
     - `www.recopyfa.st` (scheme inherited from the page);
     - `https://*.recopyfa.st` matches `www.` and not the apex;
     - `https://recopyfa.st` does not match `www.`;
     - ports `:443`/`:*`;
     - paths `/embed/` (prefix) vs `/embed` (exact), and path ignored after a redirect (n/a, noted);
     - `'self'` with the scanned origin; `'none'`;
     - ws/wss rows per the spec;
     - nonce, hash, `'strict-dynamic'`, `'unsafe-inline'` irrelevance for external scripts.
   - GREEN `source-match.ts`.
3. [ ] **Requirements and verdict.**
   - RED `verdict.test.ts`:
     - no policy → pass;
     - `default-src 'self'` → fail, with two replacement lines that keep `'self'`;
     - `script-src 'self' https://www.recopyfa.st; connect-src 'self'` → fail (API), with an exact
       `connect-src` line including both origins;
     - API allowed, wss blocked → warn;
     - two policies, one blocks → fail, its own line;
     - report-only blocks → pass plus an info fact;
     - nonce + `'strict-dynamic'` → fail with the nonce explanation and **no** code line;
     - `require-trusted-types-for 'script'` → warn;
     - `style-src 'self'` → warn (editing), no `'unsafe-inline'` anywhere in output (grep assertion
       across all rows);
     - a 1,000+ char line → the short instruction;
     - origins come from `INSTALLATION_EXAMPLE` (mock it to another origin, then the lines change).
   - GREEN `requirements.ts`, `verdict.ts`, `directive-lines.ts`, `copy.ts`.
4. [ ] **Platform detection.**
   - RED `detect-platform.test.ts`: one synthetic fixture per platform (headers plus markup
     signals, the `ExtractedPage` shape); a WordPress site behind Next-like headers → the stronger
     one or unrecognised per margin; plain HTML → unrecognised; the evidence list exact.
   - GREEN `detect-platform.ts`.
5. [ ] **Lens.**
   - RED `csp-lens.test.ts`:
     - summary facts (Platform, Policies found, Script, Your copy, Live updates, Editor styles);
     - findings: one per blocked requirement per policy; `kind` ∈ `blocked-script |
       blocked-api | blocked-live | blocked-editor-styles | trusted-types | report-only`;
     - `match` = the effective directive (≤ 80, "…"); `code` = the replacement line;
     - a hostile header value is truncated and carried only as text;
     - bounded findings.
   - GREEN `csp-lens.ts`; one `registry.ts` line; one `catalogue.ts` entry (slug `csp-checker`,
     name "Will a script run on my site?", lens `csp`, `sample: none`).
6. [ ] **Page.**
   - RED `src/__tests__/app/csp-checker-page.test.tsx`:
     - canonical; JSON-LD `WebApplication`/`BreadcrumbList`/`FAQPage` = the visible FAQ;
     - the forbidden-claims list plus "works on any site", "secure", "guaranteed";
     - links to `/docs/install#add-snippet` and `/try`.
   - Report-page test: a seeded csp report renders the facts and a `CodeBlock` holding the line.
   - GREEN `src/app/tools/csp-checker/{page,opengraph-image,twitter-image}.tsx` (composes s96's
     `ToolPageLayout`/`ToolScanForm`/FAQ).
7. [ ] **Playwright, +2** in `e2e/tools-csp.spec.ts` (a separate file from s96's, so no conflict):
   1. The tool page renders with no script CSP violation. A seeded csp report (service role) shows
      "Not yet" and the `CodeBlock` line.
   2. **Differential:** for ≥ 10 policies (the verdict suite's interesting rows), the fixture origin
      `https://fixture.test/` is served by `page.route` with the policy as a header. In the page:
      - append `<script src="https://www.recopyfa.st/embed/recopyfast.js">` (routed to a stub that
        sets a flag);
      - `fetch("https://www.recopyfa.st/api/ping")` (routed);
      - `new WebSocket("wss://recopyfast-ws.fly.dev/socket.io/?EIO=4&transport=websocket")`
        (`page.routeWebSocket`, no network).

      It collects `securitypolicyviolation`, then asserts Chromium's allow/block per requirement
      equals `verdict()`'s.
   - Count +2 over main at rebase (96 → 98 if s96 alone has merged) in the three count files.
8. [ ] **Gates and mutations.**
   - Full gates as s96 task 14.
   - **Mutations:**
     - `default-src` fallback ignored;
     - `'strict-dynamic'` ignored;
     - `*.` matches the apex;
     - the replacement line drops existing sources;
     - wss treated as fail;
     - the meta policy's `frame-ancestors` honoured.

## Tests added

| Layer | Files | Count / asserts |
|---|---|---|
| Unit | `parse-csp`, `source-match` (≥ 40 rows), `verdict`, `detect-platform`, `csp-lens` | CSP3 semantics, replacement lines, copy, platform evidence |
| Page | `csp-checker-page.test.tsx`, report-page case | SEO, claims, links |
| E2E | `e2e/tools-csp.spec.ts`, **+2** | CSP-clean render; Chromium agrees with the matcher |

## Security notes

- Header and meta values are attacker-controlled text: capped by s96 (4 KB/header) and here
  (`match` 80, `code` 1,000). They are rendered only as text (React / `CodeBlock`) and never
  interpreted as markup or URLs.
- The tool never recommends weakening a policy: no `'unsafe-inline'`, `'unsafe-eval'`, `*` or bare
  scheme sources (asserted across the verdict table).
- The differential test makes no network call (`page.route`, `routeWebSocket`).
- No new fetch, storage or limiter: s96's pipeline, limits and kill switch apply.

## Performance budgets

- Lens CPU < 20 ms per page (parse + match over ≤ 4 policies); the scan is one page, so p95 ≤ 8 s
  (fetch-bound).
- Page: the s96 marketing budget (Lighthouse mobile ≥ 0.9, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms;
  client JS ≤ baseline + 15 KB gz).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Matcher disagrees with browsers on edge cases (ws/wss, `*`, ports) | Spec-cited rows plus the Chromium differential test; the copy says "we read your policy; the bookmarklet is the final check" |
| Policies set by JS, service workers or per-page differences | The caveat sentence; only the homepage is claimed |
| A platform detection false positive | Margin rule; "unrecognised" over guessing; evidence shown |
| `style-src` advice conflicts with the install guidance | Report-only fact for editing; the owner decides whether to publish a narrow recommendation (open question) |
| Embed origins change | Derived from `INSTALLATION_EXAMPLE` (the test mocks a different origin) |
| Verdict quoted as a guarantee | Copy uses "lets … load"; never "will work"; the `/try` cross-check is suggested |

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
