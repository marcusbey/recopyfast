# Review — Story s64-rollout-dependency-refresh

> Fresh-context review of `git diff origin/main...feature/s64-rollout-dependency-refresh`.
> Pinned commit: `75ed52b169adaecf2beca37672e84eb98505cc42`.
> Pinned tree: `5fcec7ece87359499a8ac781861c79b8713b4fe7`.
> Base: `origin/main` at `719eb452c7a2ae6d302fdca1d9f33271476e23f9`.
> Judged against the validated plan, research, `AGENTS.md`, the story entry and the
> repository's existing production audit, test, build and embed gates.

## Verdict

The lock refresh is minimal and correct. Both production dependency trees now resolve the
patched packages named by the fresh registry advisories, both audits report zero vulnerabilities,
and replacing only the two locks with the pinned base versions restores the exact red baseline.
No application source, manifest, generated embed, migration, workflow or runtime configuration
changed. I found no critical, major or minor issue.

This source verdict does not replace hosted CI or production deployment evidence. The maintainer
must still wait for the pinned PR checks before the authorized squash merge, then verify the exact
deployment and public health separately.

## Scope and plan compliance

- [x] **The diff is exactly five files.** It adds research and the validated plan, appends the
  s64 story, and changes only `package-lock.json` plus `server/package-lock.json`.
- [x] **Manifests and product source are unchanged.** `package.json`, `server/package.json`,
  `src/`, `public/embed/`, `supabase/` and `.github/` have no story diff. There is no dependency
  addition, major upgrade, migration, environment change or feature behavior change.
- [x] **The root lock contains only the required resolution graph.** `proxy-addr` moves
  2.0.7 → 2.0.8, `source-map-js` moves 1.2.1 → 1.2.2, and `sharp` plus its matching optional
  platform packages move 0.35.4 → 0.35.5. Sharp's required libvips packages move 1.3.3 → 1.3.4.
  No unrelated package entry changes.
- [x] **The server lock changes only `proxy-addr` 2.0.7 → 2.0.8.** Express and every other
  server package remain at the base resolution.
- [x] **The installed trees agree with the locks.** Root resolves Express 5.1.0 →
  `proxy-addr@2.0.8` and Next 16.3.8 → `sharp@0.35.5` / `source-map-js@1.2.2`; server resolves
  Express 4.22.3 → `proxy-addr@2.0.8`. `npm ls --all --omit=dev` exits zero in both roots.

## Audit and neutralization proof

Fresh Node 24.14.0 checks on the pinned tree:

| Surface | Result |
| --- | --- |
| Root `npm audit --omit=dev --json` | exit 0; 0 info/low/moderate/high/critical |
| Server `npm audit --omit=dev --json` | exit 0; 0 info/low/moderate/high/critical |
| Root patched resolutions | `proxy-addr 2.0.8`, `sharp 0.35.5`, `source-map-js 1.2.2` |
| Server patched resolution | `proxy-addr 2.0.8` |

The audit gate bites. In a disposable archive of the pinned source, I replaced only the root and
server locks with their `origin/main` versions while leaving the current manifests unchanged:

- root audit exited 1 with exactly 1 critical and 2 high findings:
  `proxy-addr`, `sharp`, `source-map-js`;
- server audit exited 1 with exactly 1 critical finding: `proxy-addr`.

The disposable archive was removed from the active workspace. The pinned worktree remained clean.

## Regression and static verification

- **Dependency-sensitive set:** 12 suites, **249/249 tests passed**. This exercised content
  sanitization and XSS protection, image sniffing/processing/upload, page metadata, request-IP and
  rate-limit behavior, staging device identity, WebSocket integration, auth parity and the server
  manifest.
- **Full Jest:** **309 suites and 4,009 tests passed**; 2 suites / 38 tests skipped; zero failures.
- **Coverage gate:** passed at 63.69% statements, 56.94% branches, 60.22% functions and 64.30%
  lines. This also exercises source-map generation with the patched `source-map-js` tree.
- **Statics:** lint passed with 0 errors / 35 inherited warnings; `type-check`,
  `type-check:build` and the configured `format:check` passed.
- **Production build:** Next 16.3.8 compiled, type-checked and generated all routes successfully.
  Expected inert-environment Redis, Supabase and pricing diagnostics remained non-fatal.
- **Embed identity:** the generated widget is byte-identical to `origin/main`, SHA-256
  `6676bd5c5edce7f9f1cee18c79807e5e400e969fe13d7ca0828480547e7b61f9`.
  Node 24.14.0 reports the unchanged fixed ceilings green: 45,880-byte bundle, 33,120-byte widget
  and 13,141-byte transport gzip.
- `git diff --check` is clean, and the tracked worktree has no source or generated-artifact delta
  beyond the reviewed five files plus this report.

## Findings

None.

## Not verified here

- Hosted PR CI was still outside this source review. The maintainer must require every pinned-SHA
  check to pass before merge; this report does not turn a red or pending check green.
- I did not merge, deploy, mutate production configuration, call a provider, or run a customer
  journey. Exact deployment identity and public health remain post-merge evidence.
- Registry advisory state can change without a source commit. The merge check should use the
  current audit result rather than treating this dated review as a permanent waiver.
- The 38 environment-gated tests remain skipped in the ordinary suite. This lock-only story adds no
  database or provider behavior, and the focused package-sensitive paths plus build/coverage are
  the relevant local regression evidence.

Max severity: none
Ship allowed: yes
