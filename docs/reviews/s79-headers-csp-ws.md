# Review — s79-headers-csp-ws

Reviewed `git diff origin/main...e5d603d08420026174fa3c73839d4490c70e72ac` against the validated plan, research, ADR 059, AGENTS.md, the accepted architecture, and the prior review's nine minor inputs. The merge base was `origin/main` `0dea1c05babed48834ecc72700cfebef01ae6733`.

## Verdict

No critical, major, or minor finding remains in the reviewed diff. The implementation matches the validated scope: nonce CSP on the four app segments, the static marketing policy preserved, HSTS set once for all Next responses, the fidelity harness removed from `public/`, the Express HTTP surface hardened, handshake database work bounded before authorization, per-site buckets spent only after verification, and rotated site keys rechecked on message paths and the shared sweep.

## Plan and anti-hallucination review

All 12 plan tasks are present. The recovery amendments are declared in the plan: dynamic catch-alls for unknown nonce-section URLs, IPv6 and mapped-address normalization, `content-map` current-key revalidation, the 86 to 91 Playwright integration, the two behavior-preserving lint repairs, and the previously undeclared test changes.

The referenced APIs and boundaries exist with the signatures used:

- Next 16.3.8 exports `connection()`, and its installed `getScriptNonceFromHeader` reads the request policy with the nonce shape generated here.
- The root layout renders the same `THEME_INIT_SCRIPT` constant the policy hashes, and the constant reads `THEME_STORAGE_KEY`.
- `verifySiteToken(siteId, apiKey, token)`, `resolveGrant(options)`, Supabase's `maybeSingle()`, Node's `isIP()`, and the realtime factory methods all match their call sites.
- Engine.IO still owns `/socket.io/` and its CORS; the new fixed headers apply to Express `/health` and Express 404s only, as the updated architecture and server documentation now say.
- The server lock keeps `cors` transitively through Engine.IO while removing the unused direct dependency.
- The diff adds no migration, no dependency, no embed-source or generated-bundle change, and no multi-machine realtime assumption.

The earlier nine minor inputs were rechecked rather than inherited as a verdict. Unknown nonce-section URLs now render beneath dynamic layouts; the document-scoped marketing-to-app navigation limitation is recorded as accepted current architecture; the integrated Playwright contract is 91; test changes are declared; stale comments and docs are corrected; Express versus Engine.IO scope is accurate; IPv6 is grouped by `/64` with dotted and hexadecimal mapped IPv4 preserved per host; `content-map` rechecks the current key before fan-out; and the added message-path read is documented as bounded by the socket limiter.

## Independent verification

Node `v24.14.0`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, no production environment imported:

| Check | Result |
| --- | --- |
| Full Jest with coverage, `--runInBand` | 418 passed + 2 skipped suites; 5,687 passed + 38 skipped tests; exit 0 |
| Coverage ratchet | 71.75% statements, 64.79% branches, 69.01% functions, 72.29% lines; passed |
| Focused CSP/layout/realtime baseline | 3 suites, 121/121 tests passed; normal exit |
| Playwright `--list` | 91 tests in 16 files |
| Frozen-source restoration | `git diff --exit-code` passed; all four mutated file blobs matched HEAD; focused 121/121 baseline passed again |

The CI strict reporter intentionally treats a list-only run as 91 skipped tests and exits non-zero. A list run with the ordinary line reporter exited 0 and printed `Total: 91 tests in 16 files`; this is inventory evidence, not an E2E pass.

## Mutation proof

Five changed, high-risk guards were neutralized one at a time:

| Neutralized guard | Tests red |
| --- | ---: |
| Request CSP forwarding to Next | 6 |
| `/login/[...missing]` calling `notFound()` | 1 |
| IPv6 `/64`, IPv4-mapped, and malformed-address normalization | 15 |
| Pre-authorization per-address handshake check | 1 |
| Current-key revalidation before `content-map` fan-out | 1 |

Each mutation ran behind an EXIT restoration trap. Intentionally failing WebSocket assertions can abort before `server.close()`: the address mutation emitted Jest's open-handle warning after its 15 red assertions, so its exact owned process was terminated and the trap restored the file; the two later WebSocket mutations used `--forceExit` after their expected red assertions. The unmutated focused suite exited normally, both before and after the mutations. Final blob hashes matched `e5d603d` exactly.

## Browser evidence and limits

The recovery evidence records a fixture-correct production build and four passing public Chromium CSP cases: `/` and `/pricing` hydrate under the static policy; `/login`, `/signup`, `/edit`, and each segment's unknown route hydrate under fresh nonce policies with no script-policy violation. I inspected the captured unknown-login page and confirmed the built Page not found UI rather than the error boundary.

The following remain separate evidence lanes and were not represented as locally verified:

- The signed-in dashboard CSP case needs CI's disposable Supabase stack. The draft PR's E2E result is the authority for that case.
- Vercel must be checked after deployment for fresh per-request nonces and HSTS on app, static, asset, redirect, and 404 responses. The apex redirect's `includeSubDomains` behavior remains a Vercel domain-setting concern.
- Fly must be checked after deployment for the reduced `/health` body, fixed Express headers, no Express CORS or `X-Powered-By`, a green health check, and proxy overwrite behavior for `Fly-Client-IP`.
- Rotation and the one-read-per-site sweep were exercised against the test double, not real Supabase. A post-deploy test-site rotation remains the live check.
- CSP1/CSP2 fallback behavior is reasoned from the policy and Chromium evidence; Safari and Firefox were not exercised here.

Max severity: none
Ship allowed: yes
