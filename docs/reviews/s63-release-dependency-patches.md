# Review — Story s63-release-dependency-patches

> Fresh-context review of `git diff main...feature/s63-release-dependency-patches`.
> Pinned commit: `748e64708b7729e04eed4c066c45aac73043141b`.
> Pinned tree: `19ef191aa12ff624951efb121e6f793fb4c7b0b5`.
> Base: `main` at `9aa492d5afee05268e24440dc679d20214840bc9`.
> Judged against the validated plan, research, `AGENTS.md`, and the existing release gates.

## Summary

The dependency gate is cleared without changing application source, manifests, generated embeds,
runtime configuration, or accepted architecture. I found no critical, major, or minor issue in the
story diff.

The two production dependency trees now audit clean. The installed packages, Next CLI and
production build all resolve the committed patched versions. Replacing both locks with their main
versions in an isolated copy restores the exact vulnerable baseline, so the green audits depend on
this story rather than on a stale install or mocked check.

## Scope and plan compliance

- [x] **The diff is exactly five planned files.** It adds the research and validated plan, appends
  the story to `docs/stories.md`, and changes only `package-lock.json` plus
  `server/package-lock.json`.
- [x] **No dependency or manifest range changed.** `package.json` and `server/package.json` are
  byte-identical to main. There is no force upgrade or major-version change.
- [x] **The root lock changes only the reviewed vulnerable resolutions and matching Next platform
  packages:** Next and `@next/*` 16.3.8, Engine.IO 6.6.11, DOMPurify 3.4.16,
  `glob`'s production `brace-expansion` 5.0.12, `ip-address` 10.7.3 and Moment 2.31.0.
- [x] **The server lock changes only Engine.IO 6.6.11 and DOMPurify 3.4.16.** Engine.IO's removal
  of its former `base64id` dependency is package metadata from the patched release, not unrelated
  lock churn.
- [x] **No product surface drift.** `src/`, `server/` other than its lock, `AGENTS.md`, all embed
  sources/artifacts and both manifests have an empty story diff. `git diff --check` is clean.
- [x] **One story commit.** The branch is one commit directly above the specified main base.

## Dependency and advisory verification

Fresh Node 24 checks on the pinned tree:

| Surface | Result |
| --- | --- |
| Root `npm audit --omit=dev --json` | exit 0; 0 info/low/moderate/high/critical |
| Server `npm audit --omit=dev --json` | exit 0; 0 info/low/moderate/high/critical |
| Root installed tree | Next 16.3.8; Engine.IO 6.6.11; DOMPurify 3.4.16; brace-expansion 5.0.12; ip-address 10.7.3; Moment 2.31.0 |
| Server installed tree | Engine.IO 6.6.11; DOMPurify 3.4.16 |
| Next executable/build | `Next.js v16.3.8` |

`npm ls --all --omit=dev` exits 0 in both roots. Direct reads of each installed package's
`package.json` agree with the locks, so the results do not come from the stale pre-patch install.

## Anti-hallucination and bite proof

- [x] **No invented code API or configuration key.** This story changes no imports, functions,
  application configuration or public contract. Every changed lock path is reachable from the
  unchanged production manifests, as confirmed by `npm ls --omit=dev`.
- [x] **Audit neutralization bites.** In a disposable `/tmp` copy, I kept the current manifests
  and replaced only both locks with `main`:
  - root audit went red with **6 advisories**: 1 critical, 2 high, 2 moderate, 1 low;
  - server audit went red with **2 advisories**: 1 high, 1 low.
  The temporary directory was removed automatically. The reviewed worktree remained clean.
- [x] **Current lock restoration is proven.** After the neutralization, both live audits were
  already independently green, and `git diff --exit-code` plus the pinned SHA/tree check passed.

## Tests and static gates

All reviewer runs used Node 24.14.0 and `/tmp/s59-ci-env.sh`:

- **Dependency-sensitive regression set:** 9 suites, **222/222 tests passed**. This covered the
  content sanitizer, XSS prevention, upload images, image sniffing/processing, page metadata,
  WebSocket integration, auth parity and server-manifest checks.
- **Full precommit:** lint 0 errors / 35 inherited warnings; type-check passed; **309 suites and
  4,009 tests passed**, with 2 suites / 38 tests skipped.
- **Production static checks:** `format:check`, `type-check:build` and embed freshness passed.
- **Normal prepush:** Next 16.3.8 production build passed, followed by the complete coverage run:
  **309 suites and 4,009 tests passed**, with 2 suites / 38 tests skipped. Coverage remained
  63.70% statements, 56.96% branches, 60.22% functions and 64.31% lines.
- **Embed contract:** generated outputs stayed byte-identical to main. Fresh gzip sizes are
  45,880-byte bundle, 33,120-byte widget and 13,141-byte transport, exactly at the existing fixed
  ceilings.

The inert build environment intentionally had no live Redis, Supabase catalogue or Stripe
connection. The build logged the existing fail-closed Redis notice and handled unavailable pricing
fixtures through its existing fallback paths; it still completed successfully.

## PR overlap and release handling

[PR #58](https://github.com/marcusbey/recopyfast/pull/58) is currently open and changes only the
root `package-lock.json`. Its single Dependabot commit overlaps this story only on root Engine.IO
6.6.11 and `ip-address` 10.7.3. It does not contain the remaining root fixes or either server fix.
Do not merge it on top of this branch; the maintainer must close or supersede it manually. This
review did not edit, close, merge or otherwise mutate that PR.

## Findings

None.

## Not verified here

- No merge, deployment, production database/configuration change or live customer request ran.
- The combined s59/s60/s61/s62 candidate was not assembled or retested; the validated plan keeps
  that as a manual integration gate before production approval.
- No external Redis, Supabase, Stripe or customer-domain journey was exercised. This story changes
  lock resolutions only; the full local tests and production build are the relevant regression
  evidence, while live behavior remains a release check.
- `npm audit` reflects the registry advisory state observed on 2026-10-05. A later ship should run
  both audits again because advisory metadata can change without a source commit.

Max severity: none
Ship allowed: yes
