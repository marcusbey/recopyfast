# Review — s68c-realtime-grant-parity

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s68c-realtime-grant-parity`
(one commit `23258be` on `a38c703`).

## Verdict summary

Tasks 1–5 done as planned; Task 6 honestly unticked (e2e:parity needs docker). The two s07a majors are closed
(case-insensitive revocation `server/auth.js:292`; the dashboard room requires a live editor grant
`server/index.js:537-561`). ADR 047 holds on the socket (intersection, 24 h, 5 min skew, NULL holder /
created_at refused). User-Agent hashing is byte-identical between server and HTTP (desktop, mobile,
non-ASCII, empty, null, undefined). Full jest 327 suites / 4,259 tests, type-check, type-check:build, lint,
format, build:embed --check green. 22 mutations: 21 bite, 1 equivalent mutant. An independent probe running
the real HTTP validator and the real server resolver on the same rows agrees on 12 row types and diverges on
one (major 1). Forced test changes weaken no guard.

## Findings

### Major

1. `server/auth.js:288-299` — the realtime revocation read discards `error` and fails open, while its new HTTP
   twin (`staging-access.ts:684-686`) fails closed. On a partial DB failure a removed editor with a token
   verified from the same browser in the last 12 h is admitted to the staging room until the next sweep
   (60 s), or survives one more sweep; an unpersisted `content-update` can be relayed. Contradicts
   `auth.js:242-245` and the plan's "no looser for anyone". Fix: destructure `error`, refuse with
   "Editor access could not be verified"; add a parity/integration row for a failing `site_editors` read.

### Minor

2. `auth-parity.test.ts:229-354` — staging parity is pinned only at helper level; adopt a table that runs both
   real validators on the same rows (the probe table), incl. stray spaces in revocation.
3. `staging/access/route.ts:139` / `createStagingAccess` — issuing a staging invite to a removed editor
   succeeds silently but the link is refused everywhere; refuse at issuance with a readable error.
4. `docs/stories.md:2477-2498` — tick the s68c ACs whose tests exist (AC 6 waits for CI e2e, Fly deploy and
   smoke); the PR body must restate the declared test changes.
5. `e2e/realtime-parity.spec.ts` connects with edit tokens only — the device binding is never exercised in a
   real browser; only the operator smoke covers it.

## Not verified

e2e:parity (CI only, and edit-token path only); real browser UA on the WebSocket upgrade vs fetch through
Vercel/Fly; PostgREST semantics beyond the unique indexes; next build; server docker build; production, Fly,
Vercel untouched.

## Orchestrator note

Owner standing rule: fix majors (and cheap minors) before shipping. Major 1 + minors 2, 3, 4 go to a fix run.

Max severity: major
Ship allowed: yes
