# Research — s63-release-dependency-patches

Fresh production audits against main 9aa492d on 2026-10-05 confirm root: one critical, two
high, two moderate and one low; server: one high and one low. Reports are redacted npm
metadata under /tmp/s62-current-{root,server}-audit.json. Existing installed dependency
ranges permit npm's non-force fixes. No dependencies are being added.

Root vulnerable resolutions: next16.3.5, engine.io6.6.9, brace-expansion5.0.9,
ip-address10.4.0, moment2.30.1 and dompurify3.4.13. Server engine.io and DOMPurify overlap.
Root package ranges are next^16.3.3, socket.io^4.8.1, dompurify^3.2.6; server has its own
lockfile and socket.io^4.7.2/DOMPurify^3.2.6. PR58 is open and only fixes two root paths.

Primary advisories from npm: GHSA-vcvr-r3jv-pc5j (Next ImageResponse RCE),
GHSA-2gc4-cqfq-p2gv (Engine.IO protocol revision DoS), GHSA-q2hr-2g5m-vwhr,
GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p (brace expansion DoS),
GHSA-4p3w-j4w9-5jqw (moment locale traversal), GHSA-p98j-92pf-mc4p (DOMPurify),
and GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv,
GHSA-h3mg-xc3c-68pw (ip-address). Inspect fixed versions using npm metadata before edits.

Known application mitigations do not make an audit pass. The widget bundles socket.io-client
and editing rules; a server Engine.IO patch should not change that client. Rebuild/check
artifacts and existing ceilings rather than assuming this. Preserve inherited lint warnings,
all API/auth/cookie/CSP behavior and normal hooks. Test sanitizer security paths and websocket
parity. No production config, Stripe/catalogue, live database or deployment mutation is needed.

Complexity 2, no UI design or structural ADR. A major-only fix or required behavior change
stops this bounded patch task for a separately documented decision.

## Implemented lock resolutions

The pre-change Node 24 production audits reproduced the research baseline exactly: root exited 1
with 1 critical, 2 high, 2 moderate and 1 low advisory; server exited 1 with 1 high and 1 low.
`npm audit fix --omit=dev --package-lock-only --ignore-scripts` then generated the following
within the existing manifest ranges:

| Resolution | Root | Server |
| --- | --- | --- |
| Next.js and matching `@next/*` platform packages | 16.3.5 → 16.3.8 | n/a |
| Engine.IO | 6.6.9 → 6.6.11 | 6.6.9 → 6.6.11 |
| DOMPurify | 3.4.13 → 3.4.16 | 3.4.13 → 3.4.16 |
| brace-expansion under production Sentry glob | 5.0.9 → 5.0.12 | n/a |
| ip-address | 10.4.0 → 10.7.3 | n/a |
| moment | 2.30.1 → 2.31.0 | n/a |

The direct dependency ranges and both manifests are unchanged. The root lock diff changes those
six vulnerable resolution paths plus Next's matching environment and platform binaries; the
server lock diff changes only Engine.IO and DOMPurify. Fresh production audits now report zero
advisories at every severity in both projects. PR 58 overlaps only the root Engine.IO and
ip-address resolutions; it remains open and untouched, and must be closed or superseded by the
maintainer rather than merged on top of this complete lock patch.
