# Review — Story s07a-realtime-service-hardening

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s07a-realtime-service-hardening` (`225702a`).
> No UI in this story.

## Tests
- [x] Run by the reviewer. **143 suites / 2003 tests passed, 0 failed**, three consecutive full
      runs. Lint 0 errors, type-check clean, format clean, build exit 0.
- [x] **Bite proven by neutralization.** Six mutations against the integration harness, all bit.
      Named individually under the checkpoints below.

## The eight verification points
1. **The socket no longer persists content — confirmed.**
   `grep -rnE "\.(upsert|insert|update|rpc)\(" server/*.js` returns only `server/auth.js:70`, a
   crypto HMAC `.update()`. Asserted against a recording Supabase double, not against source.
   **ADR 004 rule 1 is met** — the violation at `server/index.js:541-586` is gone.
2. **The M5 re-check exists and is tested.** Neutralizing `server/index.js:407`
   (`if (!(await revalidateSocket(socket)))` → `if (false)`) turns **5 tests red**. But it fails
   open on one realistic input — MAJOR 1.
3. **The additive drill is real and was executed.** `e2e/realtime-additive.spec.ts` — 2 passed in
   a browser with no WS service running. **ADR 004 rule 2 is met**, with a caveat below.
4. **`server/` boots from its own manifest — proven.** With the Docker daemon down, the reviewer
   rsynced `server/` minus `node_modules` outside the repo, ran the Dockerfile's exact
   `npm ci --omit=dev`, and booted: `✓ WebSocket server running on port 4077`, `/health` →
   `{"status":"ok"}`. The `docker build` line is still owed for the PR — it is the only run with
   `.dockerignore` applied.
5. **Origin pin fails closed — confirmed.** No `Origin`/`Referer` ⇒ refused; unparseable ⇒
   refused; a site with `domain: null` ⇒ refused. Neutralizing → 3 red.
6. **Limiter fails closed — confirmed.** `onStoreFailure: "deny"`, positioned in front of the
   `sites` lookup (`db.reads` empty on refusal). Neutralizing → 1 red.
7. **The harness is real, not mocks.** It boots the factory on port 0, spawns real `node` child
   processes for the CLI cases, and drives a real `socket.io-client`.
8. **Scope respected.** No `NEXT_PUBLIC_WS_URL` set, `fly.toml` untouched, embed diff empty,
   `site-auth.ts` untouched, no redis-adapter. Deployment remains `s07b`'s.

## Findings

### MAJOR 1 — the revocation cross-check fails open on email case
`server/auth.js:198-211` uses `.eq('email', access.email)`, which is case-sensitive.
`staging_access.email` is stored verbatim from the invite form (`staging-access.ts:129`, no
normalization in the route); `site_editors.email` is always `trim().toLowerCase()`
(`editor-directory.ts:34`, indexed on `lower(email)`). And `revokeSiteEditor` sweeps only
`editor_device_grants` (`editor-grants.ts:498-517`), never `staging_access` — **so this check is
the only way "remove this editor" reaches a live socket.**

Proven with fixtures differing by one character: `John@Example.com` stayed connected and
received a broadcast after revocation; `john@example.com` was refused and disconnected. Their
fixture is lowercase on both sides (`server.integration.test.ts:949,969`), so the case is never
exercised. One-line fix plus a test with a capitalized email.

### MAJOR 2 — AC 8 unmet for `dashboard:{siteId}`
`server/index.js:479-497` gates `join-dashboard` on site id alone, so any holder of the public
site token joins, and `content-update` (`:461-467`) delivers full unpublished staging content
there. Proven: a plain viewer received `"UNPUBLISHED SECRET DRAFT"`. The origin pin does not
help — a non-browser client sets `Origin` freely.

Byte-identical to `main`, and the research called this handler *"correct"*
(`research/s07-realtime-service.md:80`) — **so this is a research error the plan inherited, not
implementer drift.**

Neither major is a write path, and neither is exposed while the service is undeployed.
**Both must close before `s07b`.**

### Minors
The Redis store has no happy-path test (it is the production path) · one racy assertion at
`server.integration.test.ts:1087-1101` (failed once under load, 0/8 otherwise) · an unreachable
`else` at `server/index.js:450-458` · `jest.setup.js` is not in the plan's file table (necessary
and non-weakening) · the plan's DoD grep is imprecise.

## Not verified
The additive drill's fixture site does not exist in the database, so a save actually *landing*
was never observed. `docker build` was never run with `.dockerignore` applied. No deployed
service, no real customer domain, no second browser.

## Verdict
Max severity: major
Ship allowed: yes
