# s24 — Executed Playwright CI research

Date: 20 September 2026 UTC. Baseline `320ccc69`. Complexity 4.

## Verified premise

`.github/workflows/ci.yml` marks E2E successful after a guard when
`E2E_SUPABASE_URL` is absent; install/build/server/Playwright steps are skipped. Four tests—not
the stale comment's two—are skipped: two in `e2e/share-edit-publish.spec.ts` behind
`RUN_RECOPYFAST_CORE_E2E`, and two in `e2e/realtime-parity.spec.ts` behind
`RUN_RECOPYFAST_PARITY`.

The mutating specs accept a service-role URL/key and can operate on whichever target is injected.
There is no loopback assertion. Production-like Next selects Redis; fail-closed write routes return
503 without a shared store. Realtime parity can target the local `server/index.js` when it receives
local Supabase credentials and `NEXT_PUBLIC_WS_URL=http://127.0.0.1:4001`.

## Recommended ephemeral stack

GitHub's Ubuntu runner can use Docker-backed Supabase CLI locally. `supabase start` applies the
repository migrations and provides local anon/service keys; the catalogue migration seeds plans.
The core/parity specs seed their dynamic rows. Add Redis as a workflow service, install root and
server locks, build Next, start Socket.IO against local Supabase/Redis, start `next start`, then run
Playwright with both execution flags enabled.

Before any service-role mutation, a shared E2E guard must parse the Supabase/app/WS URLs and refuse
non-loopback hosts. It must also refuse the known production project reference. Test data names/ids
must be run-scoped, and cleanup must execute in teardown/finally. Do not export browser storage or
tokens as artifacts; Playwright reports may contain only redacted/non-sensitive evidence.

Expected files: `.github/workflows/ci.yml`, `playwright.config.ts`, a shared E2E global
setup/teardown or fixture, `e2e/share-edit-publish.spec.ts`, `e2e/realtime-parity.spec.ts`, package
scripts and focused Supabase test documentation. The current `supabase/README.md` reset warnings
need revalidation because the referenced destructive migrations are already guarded.

## Acceptance evidence

- Local reproduction from clean installs with fresh `supabase start` and Redis.
- Guard mutation test: production/non-loopback inputs abort before data access; loopback passes.
- All Playwright specs execute with no suite skip for core/parity; report records real test count.
- CI logs show install/build/start/test steps ran, not `-` skipped steps.
- Root audits/type/lint/Jest/build/embed gates remain green; no GitHub cloud secrets are required.
- Services and disposable rows stop/clean on failure and success; retrying the workflow starts clean.

This story proves browser behavior in an ephemeral environment. It does not replace the final
deployed Compozit/Stripe/provider evidence or the user's physical second device.
