# Review — Story s07b-realtime-deploy

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff main...feature/s07b-realtime-deploy` (head `da34010`).
> One commit unique to the branch; 9 files, +1405 / −27.

This story is unusual: its infrastructure half was performed manually by the operator before the
implementer ran, and the plan's opening section lists what, with re-verification commands. The
implementer's job was to verify-and-tick, not rebuild. A thin diff is expected. What is judged
below is whether the **verification** is real.

## Plan compliance

- [x] **The code does what the plan specifies, nothing more.** Tasks 1, 2, 3, 4, 6, 7, 8, 9, 10
      ticked; **task 5 (the two-snippet comparison) is left unticked and declared owed** in three
      places — the plan's criteria list, `docs/plans/s07b-realtime-deploy.md:60`, and
      `server/README.md:353`. That is honest reporting, not drift. Nothing in the diff the plan did
      not ask for; the single `package.json` addition (`test:e2e:parity`) is the plan's `e2e/` row
      made runnable.
- [x] **Run interdicts respected, each one checked and named.**
      `server/index.js`, `server/auth.js`, `server/rate-limit.js`,
      `public/embed/recopyfast.src.js`, `public/embed/recopyfast.js` and `src/middleware.ts` — none
      appear in the diff stat, so all five interdicted diffs are empty.
      No blanket `wss:` / `https:` in the CSP (middleware untouched).
      `ALLOWED_ORIGINS` not reinstated — both surviving mentions are prohibitions.
      No `@socket.io/redis-adapter` in either `package.json`.
      `min_machines_running = 1` with `auto_stop_machines = false` (`server/fly.toml:95-97`).
      The compiled-in socket.io prefix is untouched.
      The realtime check cannot 503, cannot contribute to `unhealthy`, and does not reach `HEAD` —
      proven by neutralization below.

## Anti-hallucination

- [x] **No invented API / function / import.** Every symbol the new e2e spec drives was opened:
  - `window.ReCopyFast` is the instance (`public/embed/recopyfast.src.js:6169`), carrying `.socket`
    (`:2899`) and `.persistContentUpdate` (`:2803`). Real.
  - The spec's claim that both editors "reach the staging room" is true, traced end to end:
    `rcf_edit_token` → `EDITOR_MODE` (`:86-87`) → `this.stagingMode = EDITOR_MODE` (`:845`) →
    handshake `stagingMode: true` (`:2904`) → `server/index.js:212` `isStaging` → staging-room join
    (`:323`) → broadcast on `socket.to('site:{id}:staging')` (`:462`), which excludes the sender. So
    B receives over its own connection, not its own echo.
  - The broadcast payload really carries `elementId` (`server/index.js:463`), so
    `expect(parity.elementId).toBe(elementId)` asserts against a real field.
  - `server/auth.js:101 isOriginAllowed` exists. `src/middleware.ts:233` is exactly
    `addOrigin(process.env.NEXT_PUBLIC_WS_URL)`. `server/index.js:129-136` returns exactly the
    `{status, connections, supabase, message}` shape the unit-test double mocks.
- [x] **No plausible-but-wrong value or logic.** The database seed was the one place this could have
      been fiction, and it is not: `sites(id, domain, name, api_key)` all exist; the
      `onConflict: "site_id,element_id,language,variant"` matches the real `UNIQUE` at
      `supabase/migrations/20250817000000_complete_database_setup.sql:38`. Note that
      `permissions: ["view","edit","publish"]` would have been **rejected** by the original CHECK
      (`:372-374` allows only view / edit / admin) — it is legal only because
      `20260803010000_edit_sessions_allow_publish.sql:45-46` widened it. Verified, not assumed.
- [x] **The code matches what it claims to do**, with the exceptions listed as minors below (three
      comments in the e2e spec, and two dead `ALLOWED_ORIGINS` citations).
- [x] **The deployed-image claim matches the tree.** The README's own marker probe, run locally:
      `server/index.js` is 773 lines; `createRealtimeServer=3`, `createRateLimiter=2`,
      `revalidateSocket=4`, `assertProductionEnvironment=2`, `isOriginAllowed=3` — identical to the
      README's "after" column at `server/README.md:379-387`.

## Rules compliance

- [x] Repo conventions (`AGENTS.md`) followed — comment style matches the house standard (long
      comments anchored to the incident that caused them), naming, colocated tests, one commit per
      story, conventional commit message.
- [ ] **An accepted ADR is contradicted** — see finding 1. ADR 004 and ADR 022 are both honoured.
- n/a Design system — this story has no UI.

## Tests

- [x] **Suite run by the reviewer, on the branch: 192 suites passed, 1 skipped; 2530 passed /
      36 skipped / 2566 total; exit 0.** A clean worktree of `main` was also built and run: 2556
      total. The delta is exactly **+10**, matching the 10 new tests — nothing disappeared.
      (The `main` worktree showed 4 failures in `api/ai/*` and `api/content/[siteId]`; those are
      worktree-environment artifacts — the same tests pass in the real checkout on both branches —
      not a `main` regression.)
- [x] `npm run build` exit 0 · `npm run type-check` clean · `npm run lint` 0 errors / 39
      pre-existing warnings · `npm run format:check` clean.
- [x] **Coverage against thresholds.** Global **49.47 % stmts / 41.6 % branches / 46.71 % funcs /
      49.82 % lines**, against the `jest.config.js` floors of 41 / 34 / 39 / 41 — all above, with
      margin. `src/app/api/health/route.ts` alone: 76.69 % stmts / 68.29 % branches.
- [x] **Assertions pin the acceptance criteria.** No assertion-free tests; every case in
      `src/__tests__/api/health/realtime-check.test.ts` asserts both the `status` field and the HTTP
      code, which is the pair that matters.
- [x] **Bite proven by neutralization — 6 mutations, each restored, `git diff --exit-code` clean:**

| # | Mutation | Result |
|---|---|---|
| 1 | Attach `checks.realtime` **before** the severity count | 1 red — *"cannot push the app to unhealthy alongside a second failing check"* |
| 2 | Make `HEAD` probe realtime and 503 on failure | 1 red — *"keeps HEAD reading the database alone, with realtime down"* |
| 3 | Delete the `wss:`→`https:` scheme swap | 1 red — *"probes the service over https when the configured origin is a wss one"* |
| 4 | Make a realtime error never degrade | **3 red** — both degrade cases and the timeout case |
| 5 | Fall back to a default origin when the variable is unset | 1 red — *"omits the check entirely when no realtime origin is configured"* (the kill switch) |
| 6 | Remove the malformed-URL `try/catch` in `getRealtimeHealthUrl` | **0 red** — see finding 3 |

The five asymmetries that matter all bite. The tests are not decorative.

`e2e/realtime-parity.spec.ts` was **read, never run**: it seeds and purges rows in the production
database. It is judged by reading, per instruction.

## Regressions

- [x] **No impact on existing code paths.** The only production file touched is
      `src/app/api/health/route.ts`, and every pre-existing behaviour is preserved: `?quick=true`
      still short-circuits before any dependency, `detailed` still gates `external` and `metrics`,
      the `statuses` array is computed from an object that at that moment contains exactly what it
      contained before, and `HEAD` is byte-for-byte the old logic plus a comment. The two
      pre-existing health suites (12 tests) pass untouched.

---

## Findings

**major — `docs/decisions/023-websocket-only-transport-no-sticky-routing.md` — an accepted ADR is
contradicted by what this story ships, and no superseding ADR travels with it.**
ADR 023 states "The realtime service now runs **two machines**" (`:11`), that
`@socket.io/redis-adapter` and the transport pin "both ship in `s07b`" (`:40`), rejects option (c)
"Scale back to one machine … two machines is the recorded decision" (`:66-68`), and concludes
"AC 4 becomes deterministic. **With the adapter sharing rooms** …" (`:87`). This story ships **one**
machine and **no** adapter, and the diff adds `server/README.md:25-57` and
`docs/architecture.md:50-62` saying exactly that. `AGENTS.md`'s decisions rule is explicit: ADRs are
*"Immutable: a change means a new ADR superseding the old one"*, and story decisions travel with
`feature/<id>` — ADR 023's own `Scope:` line names this story. The hazard is concrete rather than
bookkeeping: ADR 023 tells a reader the adapter shipped, and "the adapter shipped" is the
precondition that would make `fly scale count 2` look safe — which is the silent co-editing outage
this entire story is built to prevent.
*In fairness:* the contradiction **originates on `main`** (commit `cabc16a` corrected the plan
without touching the ADR), not in this diff. But this is the story that turns it into shipped
reality, and the remedy is one new ADR file. Not critical because three louder documents
(`server/fly.toml`'s ⛔ header, `server/README.md`, `docs/architecture.md`) all say ONE and would be
hit first by anyone actually reaching for `fly scale`.

**minor — `AGENTS.md:77` and `CLAUDE.md:98` — still say the service is not deployed.**
The diff corrected that sentence in four places in `docs/architecture.md` and missed the two
repo-root docs: ``Socket.io in `server/` (**not deployed**)`` and
``— in `server/`, **not currently deployed**``. Both are now false, and `AGENTS.md` is the file a
fresh agent is pointed at first.

**minor — `src/app/api/health/route.ts:191-203` — the load-bearing guard is the one untested
branch.** `getRealtimeHealthUrl()` is called *inside* `GET`'s outer `try`, whose `catch` returns
**503 `unhealthy`** (`:403-420`). So the `try/catch` around `new URL(configured)` is what stops a
typo'd `NEXT_PUBLIC_WS_URL` from taking the whole app's health endpoint to 503 — precisely the class
of failure ADR 004's "Watch" forbids, arriving from *configuration* rather than from an outage.
Neutralization 6 proves nothing guards it: removing the `try/catch` leaves all 22 health tests
green. The `ws:`→`http:` swap (`:194`, the local-dev path) is likewise uncovered.

**minor — `e2e/realtime-parity.spec.ts:206-215` — the standing-guard claim is stronger than the
test.** The docstring says *"the day someone makes the socket a second write path, this goes red
without anyone having to remember to pull the switch first."* It cannot go red for that. The test
loads the `/legacy` document, which has no `data-ws-url`, so **no socket exists on that page at
all** (`expect(observed.socketAttempts).toEqual([])` at `:277` confirms it). What it genuinely
guards is ADR 004 **rule 2** — HTTP stays sufficient with realtime off — not **rule 1**, that the
socket never becomes an additional writer.
*The lead's premise does hold:* the legacy document **is** served unconditionally
(`:510-511`, `isLegacy ? "" : data-ws-url`), so the test asserts the same thing whether or not
realtime is configured, and needs no kill-switch drill to be meaningful.

**minor — `e2e/realtime-parity.spec.ts:37-43` — "The parity case is gated" undercounts.**
Two of the three tests sit behind `RUN_RECOPYFAST_PARITY=1` (`:217-221` and `:289-293`), including
the HTTP-save regression the file elsewhere calls "standing". Only the legacy-snippet test is
ungated and reaches CI.

**minor — `e2e/realtime-parity.spec.ts:190-193` — comment overstates the assertion.**
*"Content still arrives the way it always did: over HTTP, authoritative"* sits over an assertion
that only checks a **request** to `/api/content/{siteId}` was issued. With a random site id and a
fabricated token the request is rejected; nothing asserts content came back. (The idiom is inherited
from `s07a`'s `realtime-additive.spec.ts`, so it is not new drift.)

**minor — `server/README.md:100-101` and `server/fly.toml:29` — dead citations behind a correct
policy.** Both say `index.js` "records that [`ALLOWED_ORIGINS`] is no longer consulted";
`fly.toml` cites `server/index.js:174 and :196`. After `s07a`'s rewrite,
`grep -rn ALLOWED_ORIGINS server/*.js` returns **nothing** — the string is gone from the code
entirely, so there is no record to read at those lines or any others. The policy is right and the
prohibition is the right call; the pointer is dead.
Relatedly, the plan's task-1 verification (`grep -n "change to your chosen\|ALLOWED_ORIGINS"
server/` returns nothing) does not literally hold — two hits remain — but both are *prohibitions*,
which is better than the plan's letter, not worse.

**minor — `src/app/api/health/route.ts:299-305` — a public, unlimited endpoint gains an outbound
fetch.** `/api/health` has no rate limiter (pre-existing) and is reachable unauthenticated. Every
GET now issues one cross-network request to `recopyfast-ws.fly.dev`. Bounded destination and a 2 s
timeout, so this is mild amplification rather than SSRF, but `AGENTS.md`'s "rate limit before
authorization" rule has no coverage on the endpoint that just acquired a network side effect.

---

## On the highest-value targets, specifically

**AC 3 — the asymmetry holds, and the limitation is recorded rather than glossed.**
`server/README.md:346-351` states it plainly: production runs `main`, the `realtime` check is not
merged there, so `checks` held only `database` and `storage` in **both** columns of the kill-switch
table and "healthy with the check absent" proved nothing about the asymmetry. It names the unit
tests as the cover and says to re-confirm against production after merge. That is an honest account,
volunteered unprompted. And the unit tests do carry the weight in its place: mutations 1, 2, 4 and 5
each turn one of the four required properties red — realtime is excluded from the severity maths,
capped at `degraded`, absent from `HEAD`, and omitted entirely when the variable is unset.

**AC 4 — the test would genuinely fail if parity broke.** All three properties hold:
- the listener is attached inside page B's own JS context to `window.ReCopyFast.socket`
  (`:335-343`) — a separate browser *context*, separate heap, separate connection, not a shared
  object;
- `expect(socketIdA).not.toBe(socketIdB)` is asserted at `:319`, before the edit — ADR 022's Watch,
  asserted rather than assumed;
- both timestamps are taken **in-page** (`startedAt` inside `pageA.evaluate` at `:345-355`,
  `receivedAt` inside B's own handler), so Playwright IPC is outside the measured interval.
  `startedAt` is captured *before* `await persistContentUpdate`, so the 613 ms figure includes the
  authoritative HTTP write — the conservative reading, not the flattering one.

One residual: both editors share the same `editToken`, so if staging rooms were ever scoped per
*edit session*, the test would still pass. ADR 022's Watch names "per user" and prescribes exactly
the assertion that is implemented, so this is an observation about the ADR's chosen remedy, not a
defect in the execution.

**Cleanup discipline — verified as claimed.** `purgeParityDebris` (`:437-452`) matches on
`.like("domain", "e2e-parity-%.invalid")`, never on the in-memory id; it is called at `:136`
**before** `seedParityData` and again in `afterAll` at `:142`; it deletes `edit_sessions` and
`content_elements` before `sites`, and throws on error. A killed run does self-heal.

**`server/README.md` + `server/fly.toml` — the procedure would prevent the recurrence.**
All three questions are answered explicitly and in the right register:
- no CI deploy, so every merge touching `server/` needs one — `:121-128`, in bold, with the
  14:05 → 15:10 UTC timeline;
- `/health` is not proof a deploy landed, and answered 200 throughout the drift — `:144-146`;
- the marker probe is the real check — `:148-159`, with the line-count-equality rule and the four
  markers, whose local half was re-run and matches.

`fly.toml:11-24` orders `REDIS_URL` **before** the deploy and explains `assertProductionEnvironment()`'s
refusal as ADR 002 rule 4, correctly noting that a deploy arriving ahead of the secret is a crash
loop rather than a degradation. The one hole in the file is the dead citation above.

**Deliberately out of scope, confirmed not findings:** `@socket.io/redis-adapter` is absent on
purpose (one machine; the plan forbids adding it). Task 5's two-snippet comparison and an
independent re-run of the deploy procedure are recorded as owed to a human.

---

## Not verified

Everything below is a gesture only a human can make. None of it was checked by this review.

- **Task 5, the two-snippet comparison.** No signed-in dashboard, so the snippet `SiteDetailView`
  renders was never compared against the one `GET /api/sites` returns. This is the plan's own
  unticked task and a Definition-of-Done line. Residual risk is low but not zero: the CSP carrying
  both origins proves the *runtime* env is right, and the kill-switch drill rebuilt production twice
  with the variable present, which makes a build-time miss unlikely — but "unlikely" is not
  "compared". **Open `/dashboard/<a site>`, copy the snippet shown, `curl` the same site from
  `GET /api/sites`, and diff the two `data-ws-url` values character for character.**
- **`e2e/realtime-parity.spec.ts` was read, never run** — it seeds and purges rows in the production
  database. The 613 ms / 598 ms measurements, the two socket ids and the zero-residue claim are the
  implementer's evidence corroborated by the lead's independent DB count, not by this review.
  **A human re-running `npm run test:e2e:parity` with `RUN_RECOPYFAST_PARITY=1` is what would
  confirm it repeats.**
- **The ungated legacy test was not executed either.** It needs a live app at
  `PLAYWRIGHT_BASE_URL`, and running it against localhost would still POST a content map at the
  production Supabase project through the dev server. Judged by reading only. It **will** run in CI
  (`.github/workflows/ci.yml:188`, against a locally started production build) — **watch the first
  CI run on this branch**, because a widget that logs an uncaught error on a rejected
  `/api/content` call would make `expectNoErrorSurface` red there and nowhere else.
- **Nothing about the deployed Fly image was checked directly.** No `fly` CLI, no `ssh console`.
  Only the *repo's* `server/index.js` was verified at 773 lines with all five markers — the local
  half of the README's probe. That the *deployed* file matches is the lead's independent
  confirmation, not this review's.
- **The second, independent run of the deploy procedure** (plan task 3: "the whole procedure runs a
  second time from a clean checkout by following only the written steps") has not happened and is
  recorded as owed at `server/README.md:353`. **Someone who did not write the document should follow
  it start to finish and note where it is ambiguous.**
- **AC 3 against production.** By construction this cannot be confirmed until the story merges and
  deploys. **After the deploy, stop the Fly machine and
  `curl -s https://www.recopyfa.st/api/health | jq '.status, .checks.realtime'` — expect
  `"degraded"` with HTTP 200 — then `curl -sI -X HEAD` the same path and expect 200. Restart it.**
- **The preview-environment scoping** (task 7) is documented at `server/README.md:180-192` but no
  real preview URL was checked. **Open any preview deployment's issued snippet and confirm it
  carries no `data-ws-url`.**
- **No browser was ever opened**, no dashboard screen rendered, no editing session driven by hand,
  and no third-party call made outside the mocked `fetch` in the unit tests.

---

## Verdict

Max severity: major
Ship allowed: yes
