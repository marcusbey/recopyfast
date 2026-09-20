# s22 — Verified security release blocker

Date: 20 September 2026 UTC. Baseline ee3942dd. Complexity3: same-major/minor dependency
maintenance, no architecture or screen change. The premise is verified by fresh npm audit,
not inferred from old CI summaries. npm registry versions below were confirmed available.

## Current implementation and evidence

Root package.json defines audit:prod as npm audit --omit=dev --audit-level=high.
The first blocking step in .github/workflows/ci.yml executes this before lint/build/tests.
PR18's job failed with one critical, three high and three moderate package findings.
Its separate green Playwright job actually skipped because E2E Supabase secrets are missing.
The same fresh local audit returned seven findings. Package files have not changed yet.

| Package                  | Locked               | Patched target       |
| ------------------------ | -------------------- | -------------------- |
| next                     | 16.2.12              | 16.3.3               |
| sharp                    | 0.35.3               | 0.35.4               |
| browserslist             | 4.28.2               | 4.28.7               |
| fast-uri                 | 3.1.5                | 3.1.7                |
| baseline-browser-mapping | 2.10.38              | 2.11.0               |
| fflate                   | 0.8.2 / nested0.6.10 | 0.8.3 / nested0.6.11 |
| qs                       | 6.15.2               | 6.16.0               |

Next and Sharp require Node>=20.9.0; local production-aligned verification uses24.14.0.
CI uses Node20. The root overrides currently set Sharp^0.35.3 and PostCSS^8.5.25.
Existing Dependabot PR16 changes only package-lock.json for fast-uri3.1.5→3.1.7;
the user approved incorporating that fix in this story while leaving PR16 untouched.

## Primary sources

- https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4
  confirms Next16.3.3 patch for the AVIF image-optimization issue.
- https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c
  and npm audit identify Sharp<0.35.4 as affected.
- Fresh registry npm audit --omit=dev --json and exact npm view version/engine queries.

## Traps and boundaries

Do not misrepresent an advisory as a demonstrated exploit in this deployment. Do not run
malicious image payloads on production. Same-major Next minor can change rendering/build
behavior: verify images, login/editor surfaces and the production build. Target only audited
packages and necessary transitive native binaries; blanket audit fix can churn unrelated deps.
fflate has two separate minor lines and both must be repaired compatibly.

The widget artifact and gzip ceilings are permanent product contracts; Node compressors differ.
server/ has its own manifest/lockfile/Fly deployment and is outside this root-Vercel patch.
Use dummy test configuration, not production secrets. Existing expected-failure tests are not
successful behavior proof. Do not discard them to pass the gate.

## Open evidence

Compatibility and clean-install outcome must be measured after implementation. No changed
package is yet deployed. Real E2E, paid entitlement, physical second-device and third-party
provider behavior require their own evidence; dependency audit does not prove them.
