# s23 — WebSocket dependency security research

Date: 20 September 2026 UTC. Baseline `320ccc69`. Complexity 2. This is a separate deploy target
and package tree from the Next/Vercel app.

## Verified premise

`server/package.json` declares `express:^4.22.2`. The lock resolves Express 4.22.2 →
body-parser 1.20.6 → qs 6.15.3. A fresh `npm audit --omit=dev --prefix server --json` reports
three moderate package entries, all caused by qs advisories GHSA-x5fp-wj9c-mxmx and
GHSA-4mjr-xmp4-gh2g. There are zero high/critical server findings, but the stated completion
criterion is zero moderate as well.

Registry metadata and a dry-run resolve the compatible patched tree to Express 4.22.3,
body-parser 1.20.8 and qs 6.16.0. No Express 5 migration or override is needed. Raising the
direct Express floor to `^4.22.3` prevents a fresh install from accepting the vulnerable floor.

The server uses Express only to construct the app, parse JSON, expose `/health`, and provide the
HTTP server to Socket.IO. Socket.IO/Engine.IO versions do not need to move. `server/fly.toml` and
ADR 026 require one Fly machine; ADR 023 separately requires websocket-only transport, and scaling
is explicitly out of scope.

## Verification and release surface

- Red/green: exact baseline server lock fails the production audit; patched lock reports zero.
- Clean `npm ci --prefix server`, manifest/lock consistency and full root type/lint/test gates.
- Targeted `server-manifest.test.ts` plus real `server.integration.test.ts` with Socket.IO client.
- Container build/start and `/health` smoke before release.
- Fly deploy from `server/` only; verify exact image/release, one running machine, `/health`, main
  app readiness and two-client realtime propagation. Preserve the prior Fly release for rollback.
- Add a blocking CI server clean-install/audit step at moderate threshold. The current root
  `audit:prod` does not inspect `server/package-lock.json` and its `high` threshold would miss this.

No application source, database migration, Vercel deployment, authentication or protocol change
is justified by this remediation. If compatibility requires editing `server/index.js` or
`server/fly.toml`, stop and revise the plan rather than broadening the patch silently.

Primary advisory references:
- https://github.com/advisories/GHSA-x5fp-wj9c-mxmx
- https://github.com/advisories/GHSA-4mjr-xmp4-gh2g
