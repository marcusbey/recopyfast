# Review — Story s61-stable-copy-loading

> Fresh-context anti-hallucination review of code I did not author.
>
> Pinned source commit: `65e8adca07707d05a9b3951466d78940cb461ba8`
> (`c5822123e4ace1f59c8fa5cfc08fb06503a2a59a` tree).
> Reviewed diff: `git diff main...feature/s61-stable-copy-loading` — 60 files,
> 4,351 insertions and 675 deletions across three commits.
> Generated widget SHA-256: `da603c00edfe3c5f94f86ca02a5aee2eb6e7d249471c862f1d6f7aeeef792842`.
> Judged against the validated plan and research, the s61 design, AGENTS.md, ADRs 001, 002,
> 004, 016, 017, 018, 022, 025, 027, 030, 036, 042, 043 and 044.

## Verdict

The source implementation is coherent at the pinned commit. The native-head bootstrap and
runtime agree on one versioned binding, the 200 ms text gate fails closed, legacy unmarked
installs retain their old path, private content stays separate, and public fallback cannot be
resurrected by polling, sockets or A/B work. Typed installation data is admin-only, existing
embed URLs remain intact, and the generated artifacts fit all fixed byte ceilings.

Production shipping is blocked. Current production timing evidence fails the plan's rollout
precondition, both production dependency audits are red, and the guide, customer-site adapter,
real-host matrix and deployed proof are unfinished. A draft PR is appropriate for integration
work; merging or deploying it is not.

## Findings

### critical — The performance release criterion is unmet

The only production sample is the existing deployed content API, before this candidate. Its 20
operator requests had a 589 ms median, a 507–3,841 ms range, and 20/20 responses over the fixed
200 ms text deadline (`docs/plans/s61-stable-copy-loading.md:86`). It is not a browser-cold or
pixel-timing sample and cannot prove candidate behavior. It is still the best current production
evidence, and the validated plan explicitly records it as rollout-blocking.

Under the marked protocol, missing the deadline reveals authored text and locks out late public
text for that document. That is the correct safety behavior, but it is not successful delivery of
published copy. Release requires the specified cold/repeat browser measurements after the
candidate and customer adapter exist: no more than one authored fallback in twenty representative
cold visits. Do not lengthen the deadline or count authored fallback as a speed success.

### critical — Required production dependency audits are red

Fresh audits at the pinned SHA both exit 1:

| Surface | Production vulnerabilities | Blocking items |
|---|---:|---|
| Root app | 6 | 1 critical (`next`, ImageResponse RCE), 2 high (`brace-expansion`, `engine.io`), 2 moderate, 1 low |
| `server/` | 2 | 1 high (`engine.io` protocol-mismatch DoS), 1 low |

All reported packages have an available fix. CI treats the production audit as blocking, and the
plan says dependency reconciliation remains a release gate. These advisories predate or sit
outside the stable-startup logic, but they still prevent this production story from shipping.

### major — Required integration and real-host proof are incomplete

- PR 56 / s59 must merge, this branch must rebase, and the canonical guide plus agent brief must
  be integrated without duplicating them. The rebased diff requires full/browser gates and a new
  independent review.
- The aicompoz adapter is a separate site-repository story and PR. It has not been implemented,
  deployed or verified at an exact revision.
- The actual aicompoz homepage structure and the expired, revoked, offline and hung grant matrix
  have not been run.
- Ten cold and ten repeat browser runs per required scenario, deployment identity, installation
  migration and post-deploy first-visible-copy proof remain absent.

These are declared partial tasks 6, 7 and 9, not hidden source defects. They are still mandatory
before merge/deploy or any claim that the production flash is fixed.

## Source review

No unresolved source-level defect remains in the reviewed diff. Findings raised during review
were fixed before the pinned commit and rechecked:

- CSP hash sources are quoted, `connect-src` metadata includes API and configured WebSocket
  origins, and the UI scopes those hashes to public startup rather than claiming strict-CSP
  editor compatibility.
- Bootstrap/runtime eligibility now agrees for shorthand and plaintext contenteditable regions
  and split direct text.
- A failed atomic commit clears A/B tests and assignments, so an unshown variant cannot record a
  later conversion.
- Image-only, zero-dimension and mixed slow text/image pages retain legacy image hydration while
  late public text stays locked out.
- CSP/style failure, deadline cleanup and host-delegated shadow hooks restore safely; an
  already-running scan cannot install a post-terminal shadow observer.
- Matched unknown protocol pairs fail closed; unmarked legacy tags remain compatible.
- Same-origin public reads now send only the bare origin Referer needed by the existing mandatory
  domain pin. Cross-origin reads remain no-referrer, cookies and editor credentials stay omitted,
  and no server bypass was added (ADR 044).
- The incidental whole-file widget formatting rewrite was removed. The permanent readable widget
  source is back to a focused 148-addition / 186-deletion diff against main.

## Plan and rules compliance

| Plan task | Result |
|---|---|
| 1 — lock behavior and reproduce the swap | complete |
| 2 — head coordinator, gate, protocol, CSP and recovery | complete |
| 3 — early request handoff, font separation and private isolation | complete |
| 4 — atomic baseline/A/B commit and terminal lockout | complete |
| 5 — explicit-token fast auth and preflight max-age | complete |
| 6 — generation, recipes, diagnostics, guide and adapter | partial: ReCopyFast surfaces complete; guide and adapter pending |
| 7 — generic/React/real-host browser matrix | partial: repeatable fixtures complete; aicompoz and grant matrix pending |
| 8 — gates, coverage and independent review | partial: source gates/review complete; audits fail and coverage remains a pre-push/release gate |
| 9 — representative measurements, PR, deploy and production proof | blocked/pending |

Rules checked:

- `public/embed/recopyfast.src.js` remains the readable source; the generated artifact is fresh.
- `/embed/recopyfast.js` remains the permanent URL. The legacy builder's exact one-tag output is
  pinned by tests.
- No byte ceiling was raised: Node 24 measures 45,840 / 45,880 bundle, 33,085 / 33,120 widget,
  and 2,497 / 2,500 configured bootstrap bytes gzip.
- No dependency or migration was added. Node crypto appears only in build/test code; generated
  browser constants are static strings.
- Explicit credentials never fall through to dashboard-cookie auth. OPTIONS remains uniform 204,
  grants only allowed origins, sets `Vary: Origin`, and caches only preflight permission.
- Site token, legacy snippet and the typed installation remain admin-only; regeneration replaces
  every displayed credential and returns `Cache-Control: no-store`.
- ADR 044 supersedes only ADR 043's unconditional no-referrer sentence. Earlier accepted
  authorization, page identity, token rotation, private credential and service-role boundaries
  remain intact.
- The automatically generated Next.js AGENTS block is unstaged and excluded from all three story
  commits. The pre-existing untracked `.lavish/` directory was preserved.

## Verification

### Independent reviewer run

All commands used Node `24.14.0` and `/tmp/s59-ci-env.sh` inert CI values.

| Check | Result |
|---|---|
| `npm run lint` | pass, 0 errors; 34 warnings, all outside changed story files |
| `npm run type-check` | pass |
| `npm run type-check:build` | pass |
| `npm run format:check` | pass |
| `node scripts/build-embed.mjs --check` | pass; artifact fresh and all three ceilings green |
| Full Jest (`--ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`) | 311 suites passed, 2 skipped; 4,061 tests passed, 38 skipped, 0 failed |
| `e2e/stable-copy-startup.spec.ts`, Chromium | 1 test passed with 9 internal scenarios |
| Root production audit | failed: 6 production vulnerabilities |
| Server production audit | failed: 2 production vulnerabilities |

The normal commit hook independently reported the same 311 / 4,061 green result. A production
Next build and `type-check:build` both exited 0 at the pinned SHA; the route manifest is recorded
in `/tmp/s61-final-build.log`.

### Anti-hallucination mutation proof

Mutations ran in an isolated archive of the pinned commit with its own generated artifacts. The
shared worktree was never modified. Each mutation was reversed, the artifacts were rebuilt, all
five archived source/generated files compared byte-for-byte, and the targeted suite plus
`build-embed --check` passed again.

| Mutation | Red tests |
|---|---:|
| `DEADLINE_MS` 200 → 2000 | 2 red, 14 passed: scheduled release and monotonic commit check |
| Removed A/B state clearing after atomic rollback | 1 red, 11 passed: unshown experiment state remained live |

After restoration, the shared commit was still `65e8adc`, its tracked story tree had no diff, and
the generated widget retained SHA-256 `da603c00…`.

## Not verified

- The complete 45-test Playwright stack was not run by this reviewer. The new startup spec ran in
  real Chromium, and Jest pins the strict 45-test CI contract; disposable Supabase, Redis, Next
  and WebSocket end-to-end flows remain PR-CI evidence.
- No candidate revision is deployed. The production timing sample measures the old endpoint, not
  the token-fast-path candidate, browser preflight, cold DNS/TLS, runtime arrival or glyph paint.
- The actual aicompoz page, adapter, host animation, editor URL analytics suppression and install
  migration were not exercised.
- Invalid private-grant browser states (expired, revoked, offline, hung) were not run end to end.
- Browser evidence is Chromium-only and frame-sampled CSS visibility; it is not guaranteed glyph
  paint timing or a cross-browser result.
- Strict-CSP public startup is covered. Full editor styling under a strict host `style-src` still
  needs compatible host policy or a separate nonce integration, as the UI now states.
- Several captured `.webm` evidence files are zero bytes. Screenshots and the JSON probe show
  final state and rAF visibility ordering, not independent timing proof.
- Real provider/database behavior was not needed for these source changes and was not exercised;
  route authorization tests use mocks.

## Release gate

Draft PR only. Before a new review can allow ship:

1. Clear the root and server production audits.
2. Merge PR 56, rebase this branch, integrate the canonical guide/agent brief, rerun all gates,
   and obtain a fresh independent review of the rebased diff.
3. Implement and review the aicompoz adapter in its own repository, then deploy exact revisions
   only with explicit authorization.
4. Run the required cold/repeat browser measurements and meet the fallback threshold without
   extending 200 ms.
5. Run the real aicompoz structure and private-grant matrix, then verify deployed identity and
   first-visible copy after installation migration.
6. Keep merge manual. Do not use this report as deployment authorization or as proof the live
   original-copy flash is fixed.

Max severity: critical
Ship allowed: no
