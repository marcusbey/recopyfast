---
validated: yes
---
# Plan — Story s76-grant-and-edit-token-hardening

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s76-grant-and-edit-token-hardening` (from `origin/main` `72f4cff`).
Research: `docs/research/s76-grant-and-edit-token-hardening.md` — read it first. Decision: ADR 055.
No Design step: no new screen; the "Edit website" tab opens a different address and the widget's
banners and modals are unchanged.

## CTO decisions

1. **Edit link = a one-time signed code in the fragment, spent by the widget's boot check**
   (ADR 055). `editUrl = https://<host>/#rcf_edit=<code>`; code `rcfl1.{e,s,x}.<HMAC>` under a new
   domain tag; 60 s; single use via `last_used_at IS NULL` on the session. Spent only in
   `POST /api/staging/validate`, after signature, site and expiry checks and an exact-host Origin
   check; the response carries `editToken`. Why: the A-29 pins forbid the token anywhere in
   `editUrl` and any query key; a dedicated route measured +88 / +79 gz against zero headroom; the
   session row already holds the single-use state (no migration).
2. **The widget stops reading `rcf_edit_token` from the query** (downgrade and fixation through a
   2–24 h token closed). Old links minted before the deploy stop working; the owner clicks Edit
   website again. Production has no users.
3. **Embed offsets, all in the file the story changes** (measured, research table): `kind:
   result.kind` (fallback dead — the server always sends it), no `rememberDevice` in the refresh
   body (ignored server-side after task 3), `init()` tests `this.stagingMode` alone (it implies a
   token), no `|| undefined` in the boot-check body and `editorTokenBody()` (servers read strings
   only), one `keepEditLink()` for parse time and the swap, destructured restore.
4. **Device grants: the lineage decides, never the body; 30 days from first issue, both kinds.**
   Remembered-ness of a rotation = the span the server chose for the row being rotated
   (`expires_at − created_at > 24 h`). Lineage start travels in the signed grant payload as `l`
   (epoch s); a pre-s76 token falls back to its row's `created_at` once. Past the ceiling,
   validation answers `expired` (the widget prompts for a code); a replacement never expires after
   the ceiling. An undatable lineage is refused. `refreshDeviceGrant` keeps an optional, ignored
   `rememberDevice` so the A-28 suite can prove no value of it moves the lifetime; the route stops
   reading it. Issuance choices (submit-code's checkbox, handoff/create's hub session) are the
   editor's own and unchanged.
   **Remembered-ness superseded by decision 20 (Devin fix pass): the span was the row's, not the
   choice; the choice is signed as `r`.**
5. **L12: exact registered host** for `originBelongsToSite`, with site-auth's `normalizeDomain` /
   `parseOrigin` (one rule with the content routes). Localhost stays a non-production convenience.
6. **R4: "sessions" = the editor's `staging_access` invites on that site** (edit sessions belong to
   `site_permissions` members and are already deactivated on member removal, s68a). Matched with
   `normalizeEmail` in code, never `ilike` (wildcards). Best effort like the grant sweep: validation
   already refuses a revoked address (s68c), so a failed sweep is logged, not fatal.
7. **503 for infrastructure errors** on every editor validation path (edit session, staging invite,
   device grant, `validate-grant`); 401 only for a definitive refusal. The widget already keeps
   credentials on non-401/403 — tests only.
8. **Commits:** the protocol's docs commit, then one story commit. No migration, nothing under
   `server/`, no new dependency.

## Tasks (ordered, test-first)

0. [x] **Baseline.** Targeted suites green on `72f4cff`; `build:embed -- --check` = 45828 / 33062.
1. [x] **503, not 401, on an outage.**
   - RED `src/lib/auth/__tests__/editor-access-outage.test.ts`: `validateEditorAccess` answers
     `{valid:false, status:503}` when the `edit_sessions` read errors, when the `site_permissions`
     read errors, when the `staging_access` read errors, when the revoked-editor read errors, and
     for a device grant whose row read errors; and still 401 for an unknown edit token, an unknown
     staging token and a revoked grant (no regression of the verdicts).
   - RED `src/__tests__/api/editor/validate-grant/route.test.ts` (new): reason `error` → 503;
     `expired` → 401 with `nextAction`.
   - GREEN: `editor-access.ts` (`maybeSingle`, error → 503 with a fixed message),
     `staging-access.ts` (`unavailable` flag), `validate-grant/route.ts`.
   - PIN (green before and after, mutation-checked): `edit-link-persistence.test.ts` keeps the link
     through a 503 from validate; `editor-auth.test.ts` keeps the grant through a 503.
2. [x] **L12.** RED `src/lib/auth/__tests__/editor-request-origin.test.ts`: exact host (scheme,
   port, case variants) true; `evil.example.com`, `example.com.evil.test`, `notexample.com`, the
   parent of a `www.` registration false; localhost true outside production only; a failed or
   empty site read false. GREEN `editor-request.ts`.
3. [x] **A-28.** Flip the four `test.failing` in `editor-grants-ttl.test.ts`; adjust the two guards
   that described the defect (declared); add: a lineage 25 days old mints no later than its
   ceiling; a minted grant's payload carries the lineage start forward; a pre-s76 token (no `l`)
   anchors on its row's `created_at`; a row with no `created_at` and no `l` is refused;
   `validateDeviceGrant` refuses a lineage at the ceiling with `expired`. Route test: the body's
   `rememberDevice` is not forwarded. GREEN `editor-grants.ts`, `refresh-grant/route.ts`. Fixtures
   that build grant rows gain `created_at` (declared).
4. [x] **R4.** RED `src/lib/auth/__tests__/editor-directory-revoke.test.ts`: revoking deactivates
   the address's active invites on that site in any case, not another address's (`_` in the name),
   not another site's; a failed sweep still reports the editor revoked. GREEN `editor-directory.ts`;
   the DELETE route logs the count.
5. [x] **Edit link — format.** RED `src/lib/auth/__tests__/edit-link.test.ts`: mint/read round
   trip; a tampered payload, a grant-domain signature, a wrong prefix and garbage read as null;
   `buildEditUrl` for `example.com`, `https://example.com`, `https://example.com/path`,
   `example.com:8443`, unparseable → null. GREEN new `src/lib/auth/edit-link.ts` (no Supabase, no
   `@/` imports), `CRYPTO_DOMAIN.editLink`.
6. [x] **Edit link — issuance.** Flip the three A-29 pins in `create-token-leak.test.ts` (signing
   key set in the file, declared) and add: the fragment's code names this session and site and
   expires in ≤ 60 s. GREEN `create/route.ts`.
7. [x] **Edit link — redemption.** RED `src/__tests__/api/staging/validate-edit-link.test.ts`
   (stateful fake): a fresh code → 200, `editToken` = the session's token, `last_used_at` set; the
   same code again → 401, no token; expired, other site, forged → 401 with no database call; other
   origin / subdomain → 403, session unspent; consume error → 503; holder lost the grant → 401; a
   stored raw token still validates with no `editToken` in the answer. GREEN new
   `src/lib/auth/edit-link-redeem.ts`, `staging/validate/route.ts`.
8. [x] **Edit link — widget.** RED in `edit-link-persistence.test.ts`: `/#rcf_edit=<code>` → the
   boot check carries the code, the answer's token replaces it in memory and storage, the address
   bar keeps no fragment; the next page validates with the token; a legacy `?rcf_edit_token=` boots
   a visitor and stores nothing; an ordinary `#section` is untouched; a refused code is forgotten
   and explained once. Convert the suite's other landings, and `ai-suggest-credentials`,
   `editor-terminal-session`, `plan-ended-message` (a tab already holding the session), and
   `editor-auth.test.ts`'s refresh body (declared). GREEN `recopyfast.src.js` (decision 3), rebuild.
9. [x] **Bytes.** Ratchet `MAX_*` and `SEEDED_MAX_*` to the measurement with an itemised ledger.
   Stop rule: above 45828 / 33062 → stop and report.
10. [x] **e2e.** `share-edit-publish.spec.ts` mints a code for its seeded session and lands on
    `#rcf_edit=`; `realtime-parity.spec.ts` starts both contexts from a tab holding the session.
    `--list` count unchanged.
11. [x] **Docs and truth.** `docs/stories.md` s69 L12/R4 → closed by s76; comments that describe
    `rcf_edit_token` landings (`useEditSession.ts`, `Benefits.tsx`) say what is true.
12. [x] **Gates, mutations, commit.** Full jest, type-check (both), lint, format, `build:embed
    --check`, Playwright `--list`. Mutation per guard (report table). One story commit.

## Review fix pass (2026-10-09)

Rebased on `origin/main` `fc5968b` (s73, the deps bump; `docs/stories.md` kept both entries in id
order). The review found no critical or major; six minors were fixed, test-first. CTO decisions:

9. **Check, then spend** (minor 3). The redemption validates the session the code names as any
   stored session is validated (ADR 047) *without recording a use* (`validateEditorAccess`'s new
   `recordUse: false`, honoured by the edit-session branch only), and only then runs the
   conditional spend; the token is answered only for a session confirmed valid. A 503 at any step
   — the site, the session, the holder's grant, the spend itself — leaves the code unspent; the
   widget keeps it on a 5xx (ADR 036), so a reload within the minute spends it. Rejected: answering the token on a post-spend 503 (a session nobody confirmed
   is still its holder's); un-spending after a failed validation (a compensating write during the
   outage that caused it). The spend keeps every filter, as a second look atomic with the write.
10. **No verdict is not a refusal** (minor 2). `originBelongsToSite` answers `null` when the
   `sites` read fails; all three callers answer 503 (edit-link redemption, `handoff/redeem` with
   reason `unavailable`, `submit-code` with `error: "unavailable"`). A caller that forgot the
   null would still refuse (`!null`), never admit.
11. **A legacy `?rcf_edit_token=` is stripped, never read** (minor 4): tested for presence only.
   Paid for in the same file by dropping `window.` from globals that always exist (never from
   one that may be missing, e.g. `visualViewport`); ceilings ratchet 45827 / 33059 → 45813 / 33052.
   **Offset superseded by decision 13 (review fix pass 2): it was a defect.**
12. **Edit Board outages** (minor 6): one helper, `stagingRefusalStatus`, at all fifteen call
   sites, census-pinned like A-10.

13. [x] **Minor 1 — redundant guards bite.** `readEditLinkCode` refuses a missing, string or null
    expiry (`edit-link.test.ts`); the offline expiry check is written "not unexpired" and a code
    whose expiry is no date (`x: 1e300`) is refused before any database call; the spend's
    `last_used_at`, `expires_at`, `is_active` and `site_id` filters are each pinned by a test that
    changes the session between the checks and the write (`validate-edit-link.test.ts`).
14. [x] **Minor 2 — `sites` read failure → 503.** `editor-request-origin.test.ts` (null, declared
    split of the "cannot be read" case), `validate-edit-link.test.ts`, `handoff/redeem/route.test.ts`,
    `submit-code/route.test.ts`.
15. [x] **Minor 3 — check, then spend.** `validate-edit-link.test.ts`: an outage reading the
    session or its holder's grant → 503, code unspent, the retry spends it; a failed spend is
    retried within the minute.
16. [x] **Minor 4 — legacy token leaves the address bar.** `edit-link-persistence.test.ts`: the
    query loses `rcf_edit_token` and keeps the page's own parameters and fragment, nothing is
    validated, stored or sent; a page's own query is never re-serialised.
17. [x] **Minor 5 — customer docs name `#rcf_edit=`.** `installation-content.ts`,
    `install-recipes.ts`; tests in both formats (and `install-recipes.test.ts`'s
    `rcf_edit_token` expectation replaced, declared).
18. [x] **Minor 6 — Edit Board 503.** `staging-outage.test.ts`: helper, census of the fifteen call
    sites, `GET /api/edit-board/styles` → 503 on a failed token read, 401 for an unknown token.
19. [x] **Gates, mutations, one commit.**

## Review fix pass 2 (2026-10-09)

The re-review found one major and three minors; all four fixed, test-first. CTO decisions:

13. **`window.` on every name a host page can shadow** (major; supersedes decision 11's offset).
   A bare `open` / `history` / `addEventListener` / `removeEventListener` / `localStorage` /
   `sessionStorage` resolves to the page's own top-level `let` / `const` / `class` first: a page's
   `let open = false` made the widget's `open(…)` throw into the host window (non-negotiable #4).
   `window` itself is unforgeable, so `window.open` cannot be shadowed. Restored on all fifteen
   uses, five of which were bare on main too (the parse-time strip's `history` ×2, the edit link's
   `sessionStorage` ×3 — "every name", not only the ones fix pass 1 touched). `location` stays bare
   on all 13 references, on 11 lines (the 11 fix pass 1 un-prefixed and the story's two
   `location.hash` reads; counted with the census's ESLint rule, see decision 19): measured with
   Playwright in Chromium 145 and WebKit 26, a page's top-level
   `let` / `const` / `class location` is a SyntaxError, `function location(){}` throws, and
   `var location` leaves `location === window.location` (it is [LegacyUnforgeable]). jsdom does not
   model this (its `let location` succeeds), so the new suite never declares it.
   Bytes: restoring measured 45823 / 33064, over main's widget ceiling by 2. Paid by writing the two
   `24 * 60 * 60 * 1000` products as `864e5` (esbuild keeps them as `1440*60*1e3`): −5 / −5.
   Ceilings 45813 / 33052 → **45818 / 33059**: up from fix pass 1's pair, which never reached main,
   and down from main's 45828 / 33062. Tried and rejected, each larger: the scroll listener on the
   editor's AbortSignal (+6 / +5), a local for `window.visualViewport` (+16 / +10), one storage
   helper (+9 / +5), one captured sessionStorage (+0 / +1).
14. **`recordUse` defaults to true, pinned** (minor). The redemption's check-before-spend is its only
   `false` caller; every other validation must stamp `last_used_at`.
15. **Grant dates that cannot be believed are refused** (minor). Both expiry checks — the signed `x`
   and the row's `expires_at` — are written "not unexpired", so a NaN refuses. The lineage start is
   bounded from above: an age below −60 s (`LINEAGE_CLOCK_SKEW_MS`) is refused as `expired`, as an
   undatable lineage is. `l` is stamped by this application and a pre-s76 row's `created_at` by the
   database, two NTP-synced clocks; a minute is the drift allowed, the reviewer's figure. Rejected:
   the edit sessions' five minutes, which agree with a migration's backfill this path does not have.
16. **The handoff/redeem comment tells the truth** (minor): on a 503 the code is left unspent, but
   nothing presents it again — the widget strips `?rcf_handoff=` at parse time and redeems once.

20. [x] **Major — host-page globals.** RED `src/__tests__/embed/host-page-globals.test.ts` (new): a
    page script declares `let open = false; let history = 1; let addEventListener = 0; let
    removeEventListener = 0; let localStorage = null; let sessionStorage = null;` (the fixture is
    checked to bite); a share link leaves the address bar and is kept; the next load restores it and
    a refusal forgets it; a handoff code leaves the address bar; a grant in either storage boots the
    editor; the inline editor guards navigation on the real window and stops when it closes;
    Re-authenticate keeps the draft and opens sign-in; Preview Live opens the page; nothing escapes
    into the host window; and a census finds no bare use of the six names. GREEN
    `recopyfast.src.js`, `864e5`, rebuild, ceilings and ledgers (`build-embed.mjs`,
    `build-size-gate.test.ts`).
21. [x] **Minor — `recordUse` default.** `validate-edit-link.test.ts`: the validator every other route
    uses stamps a stored token's `last_used_at`.
22. [x] **Minor — grant dates.** `editor-grants-ttl.test.ts`: a signed expiry that is a string or an
    object is refused before any database read; a row `expires_at` missing or unparseable is
    refused; a lineage start two minutes ahead (signed `l`, or a pre-s76 row's `created_at`) is
    refused; thirty seconds ahead still validates (control). The file's `grantRow` helper gains
    `signedExpiry` and `rowExpiresAt` overrides (declared). GREEN `editor-grants.ts`.
23. [x] **Minor — handoff/redeem comment.**
24. [x] **Gates, mutations, one commit.**

## Verification fix pass (2026-10-09)

Verification of `bc0c6bb` found no critical or major (ship allowed); three minors, all fixed. Rebased
on `origin/main` `122ad2e` — s74 (the Playwright strict contract is now 81) and s75 (CI enforces
the coverage ratchet; `engines: node 24.x` in the lockfile, `npm ci` rerun); neither changes an
embed byte. `docs/stories.md` keeps s74, s75 and s76 in id order. s77 is not on main, so
`staging-outage.test.ts` keeps its `site-123`. CTO decisions:

17. **The census asks the scope analysis, not a regex** (minor 1). The regex census cut comments
   with `/\/\*[\s\S]*?\*\//`, which read the `/*` in `// … /api/editor/*` (src.js 187 and 996) as a
   block comment and deleted src.js 188–216 and 997–1199 — 232 lines never checked; its object-key
   and member-access guards also hid `a ? open : b` and `...history`, and it flagged a parameter
   that shadows the name. Replaced by ESLint's `Linter` (eslint is a direct dependency) running
   `no-restricted-globals` on the six names over the source, as a classic browser script
   (`FlatCompat.env({ browser: true })` from `@eslint/eslintrc`, already a direct dependency;
   `sourceType: "script"`, `ecmaVersion: "latest"`); a parse error is reported, never passed.
   `location` stays out of the list, with the reason in a comment: it is [LegacyUnforgeable]
   (decision 13), so its 13 bare references defend against nothing and would cost bytes. The census
   moves to its own `@jest-environment node` file, `host-page-globals-census.test.ts`, as the repo's
   other source guards do (`radius-guard`, `native-select-guard`): ESLint needs `structuredClone`,
   which jest's jsdom environment lacks. Rejected: polyfilling `structuredClone` into the jsdom
   suite (a test-only shim that would hide the next missing global), the `globals` package (only a
   transitive dependency).
18. **The skew boundary is pinned from both sides** (minor 2): a lineage start 59 s ahead validates,
   61 s ahead is refused as `expired`, with `Date.now` frozen on a whole second so the signed `l`
   (epoch seconds) carries the probe exactly.
19. **Exact ledgers and comments** (minor 3): `location` is 13 bare references on 11 lines, counted
   with `no-restricted-globals` on `location` alone — the census's rule, run once by hand since the
   census excludes the name (the 11 fix pass 1 un-prefixed, the story's two `location.hash` reads;
   the review's "10 lines" is 11: src.js 74, 93, 121 ×2, 618, 1094 ×2, 1587, 2367, 2515, 2518,
   3216, 6662); `build-embed.mjs` and decision 13 say so. The `x` comment in `editor-grants.ts` says
   what is true: a numeric string coerces, only a non-coercible `x` is NaN, and only a token this
   application signed can carry one. The jsdom suite's `unhandledrejection` listener is removed —
   jsdom 26 never dispatches that event — with a comment saying what the escape record covers.

25. [x] **Minor 1 — census.** RED: the census's own fixtures (`host-page-globals-census.test.ts`)
    against the regex — a use after `// … /api/editor/*`, a ternary operand and a spread were
    missed, a shadowing parameter was flagged; each of the six names, and a parse error reported
    as such. GREEN: `bareUses` on ESLint. Probes on the real source: a bare `open('x')` inserted at
    src.js:190 and :1000, `this.editorAuth ? open : null` and `[...history]` at :1000 — all four
    missed by the regex, all four red; source restored.
26. [x] **Minor 2 — skew boundary.** `editor-grants-ttl.test.ts`: +59 s valid, +61 s `expired`.
    Mutations 60→90 (+61 s red) and 60→30 (+59 s red).
27. [x] **Minor 3 — wording.** `build-embed.mjs`, decision 13, `editor-grants.ts`, the jsdom
    suite's escape record.
28. [x] **Rebase, gates, mutations, one commit.**

## Devin fix pass (2026-10-09, PR #84)

Devin Review raised two findings on `621f936`, one critical and one minor; both fixed, test-first. CTO
decisions:

20. **The remembered choice travels signed in the grant, as `r`** (critical, "Remembered grants
   expire early near ceiling", `editor-grants.ts:473`; supersedes decision 4's "remembered-ness
   of a rotation = the span the server chose for the row being rotated"). The span describes the
   row, not the editor's choice: `issueDeviceGrant` caps every replacement at the lineage
   ceiling, so a remembered grant rotated in its final day gets a row spanning under 24 h, and the
   next rotation read it as session-only: 12 h, and an emailed code before the 30 days. Now
   `issueDeviceGrant` signs `r: 1 | 0` from the choice it was given (the editor's checkbox at
   submit-code, the hub session's signed `r` at handoff, the lineage's own `r` at rotation), and
   `validateDeviceGrant` reads `remembered` off it. `r` is inside the HMAC, beside `l`, so
   rewriting it breaks the signature (`malformed`); no holder can promote a session-only grant. A
   token without `r` (minted before this) falls back to its row's span once. Its row was never
   capped, so the span is truthful there, and the replacement is signed. A present `r` other than
   1 reads as session-only (the narrower). Written `1 | 0`, not omitted when unticked as the hub
   session's `r` is, because here absence must mean "minted before the flag", not "session-only".
   Rejected: deriving it from the lineage's first grant (walking `rotated_from` is unbounded, one
   read per rotation); a `remembered` column (a migration, a backfill, and a migration-first
   deploy for a bit the signed payload already carries safely). The widget needs no change: it
   carries `remembered` across a refresh from its own record, and infers it from the expiry only
   for a handoff, which starts a new lineage.
21. **The invite sweep pages in a total order, then writes in bounded batches** (minor, "Editor
   revocation misses later invites", `editor-directory.ts:376`). The single read of a site's
   active invites was capped by PostgREST's `max_rows` (1000, `supabase/config.toml`), so an
   invite past the first page stayed active. Matching in the database was weighed and rejected,
   because no PostgREST filter expresses `normalizeEmail` exactly. `eq` misses the case variants
   `staging_access.email` keeps. PostgREST rewrites every `*` in an `ilike` pattern to `%` with no
   escape, and `*` is legal in an address. `imatch` would need a regex escaper and still not
   reproduce JS `trim()` / `toLowerCase()`, and an over-match ends somebody else's access.
   `lower(email)` needs a computed column or an RPC, which means a migration. So: read pages of
   `id, email` ordered by `id` (the primary key, a total order) with `.range()`, advancing by the
   rows returned until an empty page, so a server that caps lower still reads every row. Every
   page is read before anything is written, so the sweep's own updates never shift a later
   page. Then update by id in batches of 100: every invite is a new row (no uniqueness on
   `site_id, email`), the ids ride in the URL at about 40 bytes each, and one request for all of
   them would outgrow a request line. A failed batch logs and reports what landed. Matching stays
   in code with `normalizeEmail` (decision 6). Concurrent edits to the site's invites during the
   sweep can shift an offset by a row; best effort, as before. Every staging validator already
   refuses a revoked address (s68c), so a missed row is stale, not access.
   The schema-strict double gains s88's `range`, chained `order` keys with PostgreSQL null
   placement and a `maxRows` option, ported verbatim from `499bbe0` so the two branches merge
   cleanly.

29. [x] **Critical — remembered to the ceiling.** RED `editor-grants-ttl.test.ts` (new block, with
    a stateful grant table and a clock frozen on a whole second): a remembered lineage minted
    by `issueDeviceGrant`, rotated on schedule (days 6, 12, 18, 24), then twice in its final day
    (+1 h, +2 h). Each final-day replacement expires exactly at the ceiling, its token is signed
    `r: 1`, it still validates `remembered: true`, and it is `expired` at 30 days. Red before the
    fix: the +2 h replacement ended 10 h early. Also: a session-only lineage rotated every
    11 h for the whole 30 days (65 rotations) gets exactly `min(now + 12 h, ceiling)` each time and
    stays `r: 0`. A pre-fix token (no `r`) is judged by its row once, and its replacement is
    signed 1 / 0. A session-only token whose payload is rewritten to `r: 1` is `malformed` for
    validation and refresh, and nothing is minted. GREEN `editor-grants.ts`.
30. [x] **Minor — every invite.** RED `editor-directory-revoke.test.ts` (new block, on the
    schema-strict double with `maxRows`, rows seeded out of id order). With 2,500 invites capped at
    1,000 per response, the editor's invites on pages 1, 2 and 3 are all ended, and a lookalike
    address, a neighbour and another site's invite are not. A server capping at 7 still reaches
    rows 8, 15 and 29. Every paged read is ordered ending on `id` (4 reads: 3 pages + the empty
    one). 250 of the editor's own invites are ended in batches of ≤ 100 ids. The file's
    hand-rolled fake gains `order` (no-op) and `range` (declared) so its four tests run on the
    paged read. GREEN `editor-directory.ts`, `schema-strict-supabase.ts` (s88 port).
31. [x] **Docs.** This section; research § 2 corrected.
32. [x] **Gates, mutations, one commit.**

Follow-ups (not s76): **the same shadowing class predates s76** — names bare on main before this
story: `fetch` ×17, `setTimeout` ×15, `clearTimeout` ×4, `alert` ×4, `confirm` ×3, `crypto` ×3,
`navigator` ×2, `requestAnimationFrame` ×2, `cancelAnimationFrame`, `setInterval`,
`queueMicrotask`, constructors (`URL`, `Image`, `ResizeObserver`, …). A page's `let alert` or
`let fetch` breaks the widget the same way; widening the census and paying ~1 gz B per site is a
story of its own. **s95** — `site-auth.normalizeDomain` throws for a registered domain that
starts with "http" (e.g. `httpbin.org`), review finding 8, its own story. `submit-code` spends the
emailed code before its origin check, so a 503 there costs the editor a new code (the order
predates s76; worth its own look).

## Rollout

Application only: the Vercel deploy serves the new route behaviour and the new
`/embed/recopyfast.js` together. No migration, no Fly deploy. Edit links minted before the deploy
stop working (by design). After deploy: (1) Edit website from the dashboard → the tab's address
ends in `#rcf_edit=…`, the page is editable, the address bar shows the bare URL; (2) the same URL
opened again → "Invalid or expired staging link."; (3) click to a second page → still editing.

## Run interdicts

- Ceilings only go down; the artifact is rebuilt, never edited.
- No migration, nothing under `server/` or `supabase/`, no new dependency.
- Never `next dev`; never print env files; never push or merge.
