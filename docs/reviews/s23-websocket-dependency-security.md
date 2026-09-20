# Review — s23-websocket-dependency-security

Initially reviewed commit `63fab7076a6573078f7e72c3d217a1a4d40be39e` against
`origin/main` at `320ccc69e79070f26d5fbc42084444c10a3b52cf`, then rechecked the amended
documentation delta at `8a03abffa8b17382855b825642de6dec24d40c52`. The review used the
validated plan, research, repository rules, architecture, accepted ADRs and realtime-service
runbook as authority.

## Recheck

The only amended line now states that ADR 026 requires one Fly machine and that ADR 023 separately
requires websocket-only transport. That matches both accepted ADRs and resolves the prior minor
finding without changing application source, service behavior or topology.

No findings remain.

## Independent evidence

- Baseline red was reproduced from `origin/main` using Node 24.14.0/npm 11.9.0: a clean
  production install resolved Express 4.22.2, body-parser 1.20.6 and qs 6.15.3, and
  `npm audit --omit=dev --audit-level=moderate` exited non-zero with three moderate package
  findings caused by the two recorded qs advisories.
- Patched green was reproduced from the reviewed manifests using exact CI Node 24.14.0/npm
  11.9.0: clean `npm ci --omit=dev` installed 159 production packages and the moderate-level
  audit reported zero vulnerabilities. The same lock installed successfully under Node 20.11.0/
  npm 10.2.4, covering the production Dockerfile's Node 20 runtime line.
- The installed tree is Express 4.22.3 -> body-parser 1.20.8 -> qs 6.16.0, with Express's
  required path-to-regexp 0.1.13 update. Socket.IO 4.8.1 and Engine.IO 6.6.9 are unchanged from
  the baseline tree.
- Registry metadata agrees with the lock: Express 4.22.3 declares qs `~6.16.0`, body-parser
  `~1.20.5` and path-to-regexp `~0.1.13`; body-parser 1.20.8 declares qs `~6.16.0`.
- The workflow is syntactically simple and matches the repository's existing trigger shape:
  push to `main`, pull requests to all base branches, read-only contents permission, exact Node
  24.14.0, cache keyed by `server/package-lock.json`, clean production install, then a blocking
  moderate-level audit with no `continue-on-error`.
- The manifest, authentication-parity and real Socket.IO integration suites passed together:
  3 suites, 80 tests, 0 failures under safe placeholder CI values. This boots the real realtime
  server on ephemeral ports and drives real Socket.IO clients; no application behavior test was
  added merely to bless lockfile churn.
- Two broad-suite runs each reached 204 passing suites, 2,692 passing tests and one unrelated
  environment/runtime failure. The content-route failure from the intentionally incomplete first
  environment passed on exact rerun with the full placeholder app URL (27/27). The image test's
  `zlib.crc32` failure on the locally installed Node 20.11.0 passed under the story's exact Node
  24.14.0 pin (13/13). Neither failing path is touched by this diff.
- Mutation proof used an isolated archive, not the author worktree: weakening the workflow from
  `--audit-level=moderate` to `--audit-level=high` made the manifest suite fail exactly one test
  (3 passed, 1 failed). The author worktree was proven clean after the mutation run.
- Diff inspection found no changes to `server/index.js`, authentication, rate limiting,
  `server/fly.toml`, Dockerfile, root manifests, embed source/artifact, Socket.IO configuration or
  any application source. The only production dependency changes are the direct Express floor and
  the forced lockfile resolutions described above. The one-machine topology and websocket-only
  transport therefore do not drift in this commit.
- Plan coverage is complete for the reviewable implementation slice. The draft-PR/actual-CI and
  post-merge Fly release tasks remain unchecked in the plan, correctly; this review does not
  convert those external gates into completed work.

## Not verified here

- Docker is unavailable on this host. No container image was built or started and no container
  `/health` response was observed. A Docker-capable runner must still execute the server-context
  build, start the image with safe test configuration and observe `/health` before release.
- GitHub Actions did not run in this local review, and repository branch protection was not
  observed. The new `Realtime server production audit` job must pass on the actual draft PR and
  be treated as required before merge.
- No Fly operation was performed. The exact deployed image/release, one running machine,
  Fly `/health`, post-memo main-app readiness, and rollback release remain unverified.
- No credentialed production two-client parity run was performed. Before completion, the gated
  parity run must report two distinct client connections, propagation under one second and zero
  skipped parity cases; a green run with skipped credential-gated cases is not evidence.

The review gate allows the branch to proceed to draft PR and actual CI. It is not evidence that
the Docker, Fly, main-app readiness or two-client production release gates have passed.

Max severity: none
Ship allowed: yes
