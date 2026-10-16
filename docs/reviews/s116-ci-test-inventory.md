# Review — s116-ci-test-inventory

Date: 2026-10-16 (Toronto). Fresh independent review of the uncommitted story candidate on
`feature/s116-ci-test-inventory`, against released base
`1cbf586a5c096eb4ee724a574588ede228b47269`, the owner-validated plan, research, architecture,
repository rules and the accepted content-write decisions.

## Verdict

No actionable implementation findings remain. All six plan tasks are represented without a
product, package, dependency, migration, embed or browser-spec change.

The shared Node runner discovers the complete `scripts/**/*.test.mjs` set and compares it with the
six reviewed fixture-only entries before the first child process can start. Each file then runs
sequentially through `process.execPath --test --test-reporter=tap`; the runner retains child output
and refuses a missing or duplicate summary field, zero tests, inconsistent totals, failure,
cancellation, skip or todo. The required CI job invokes this runner once and no longer names a
partial set of script tests. The runner correctly describes its boundary as inventory review, not a
network sandbox. The known suites use loopback servers, injected transports or filesystem fixtures,
and their imported CLIs retain direct-execution guards.

The former ad-hoc database gates are gone. The durable PG17 suites now exercise the current
semantics with real roles and writes: authenticated content UPDATE is `42501` with unchanged content
and no update history; the trigger has a positive insert/history control; authenticated
`site_permissions` INSERT/UPDATE cannot land; `service_role` INSERT/UPDATE does land; and an admin
can delete a non-creator grant without deleting the creator row. The DELETE-policy text assertion is
an additional tombstone after the actor/write proof, not the sole oracle. This replaces the stale
authenticated-INSERT expectation with the accepted service-role boundary from the current migration
chain.

The deleted 30-case `InteractiveHero` file was one fully skipped suite for obsolete copy and
controls. Current demo mounting, homepage placement, reduced motion, attract-loop interruption,
editable text/image and toolbar behavior remain covered by maintained suites; the two real-input
mobile browser cases are unchanged. The related maintained comments now describe the deletion
accurately. The added `playwright-ci-contract` adjustment is required scope: its previous assertion
hard-coded two direct Node commands that the validated plan replaces, and it now pins those files in
the shared reviewed manifest while preserving the existing 106/7 contracts.

## Independent verification

- Exact `/Users/marcusbey/.asdf/installs/nodejs/24.14.0/bin/node`: the real shared runner passed
  **90/90** across all six reviewed files, with zero failed, cancelled, skipped or todo.
- Focused CI and retained API/source contracts passed **66/66** across five suites.
- The mapped current hero/demo/editor suites passed **32/32** across eight suites before the final
  comment-only cleanup; the author reran the affected focused files after that cleanup (**4/4**
  attract and **6/6** editable text/image).
- An independently owned, random-port disposable PostgreSQL 17.11 replay applied the full migration
  chain and passed **21 suites / 190 tests**, with the one declared PostgREST-only skip. The runner
  stopped the server and removed its exact temporary directory.
- A second independently owned loopback PostgreSQL 17.11 cluster ran
  `content-write-privileges.test.ts`: **9/9** passed, including the moved trigger/history and
  authenticated-refusal checks. Its existing PostgREST placeholder was explicit because this bare
  PostgreSQL run had no local Supabase API.
- `git diff --check HEAD` passed. `package.json`, `package-lock.json`, Jest thresholds, both
  Playwright configs, browser specs, migrations, product code and embed code are absent from the
  behavioral diff.

## Mutation proof

Reviewer ownership prohibited shared source edits, so neutralization ran on a byte-identical
temporary copy of `scripts/run-node-tests.mjs` plus its contract suite. Replacing the pre-spawn
inventory refusal with `if (false)` produced exactly **1 red / 11**: the unknown provider-like test
was no longer refused before any child. Restoring that guard and replacing the zero-test refusal
with `if (false)` produced exactly **1 red / 11**: the zero-test case no longer threw. The temporary
copy was restored byte-for-byte, both copies matched SHA-256
`ed3af817684068224fba1981ade6771bd090560cde48603ca41be9ba18662fcf`, and the temporary directory
was removed. Shared source was never mutated by the reviewer.

## Reviewed source binding

The complete 15-path non-doc source/workflow/test manifest below hashes to
`13f6022b8dc7a8a818e1246679a5afa49a1d2bbd8c533f3124d5edfdf347e9fb` when the sorted lines,
including the final newline, are hashed with SHA-256. `DELETED` is a required absence marker. This
content manifest is independent of whether the two new runner files are untracked now or tracked in
the final commit. As a secondary check, the tracked non-doc diff from the base hashes to
`42197b9b4c9e7634c19a0ff796a3673b4b946d4e4bda71b52784d2f1a4b90847`.

```text
6a12e57381c1ea8497cf3e88911a93631e094d444086f1cdb656211af1caaf91  .github/workflows/ci.yml
579890df88f0333c15517ea1c3196aebe0830d4e15e1ee59aff80ccf661bc53e  scripts/__tests__/node-test-runner.test.mjs
e831c2aaf34d2b411d00f15b76e1ca438e930f457394cb602c3c22114976fa94  scripts/__tests__/uptime-check.test.mjs
ed3af817684068224fba1981ade6771bd090560cde48603ca41be9ba18662fcf  scripts/run-node-tests.mjs
dabb7ebb246ed089b649f2ffff868fdede07765f5c3a4d35511b427542a00e03  src/__tests__/api/bulk/update-history-policy.test.ts
51275772579915f919b4eecbe08db5246523f1f71f39a7ece78d6eac956b400c  src/__tests__/api/sites/share-owner-lockout.test.ts
d6a1927f6097379e4a4f6252b96f5caaf6b7730c7e0a190c533cdb26223de808  src/__tests__/api/sites/share-rls.test.ts
22dce79c2bb408361e86a3581aa4903f8771f81e7a69877edb5f52a249a046dd  src/__tests__/ci/release-gates.test.ts
74e41f68953be3274826c403a9363c52b5d39c9be7e905a414dd70a57de5f782  src/__tests__/db/content-write-privileges.test.ts
a1117b7b48b24b49610a173ac4a99bcedcf89e77fefd1be2f08cdbfba1bd894a  src/__tests__/db/replay-privilege-convergence.test.ts
bcdf09a5f16cee79fc29b47d438be4dddd9fa979cb21ea668bb1a2fd8f36f24f  src/__tests__/e2e/playwright-ci-contract.test.ts
f43da3b7031d07e294165d07582a9b14bd35e54a70176cb27d6822500bc6ba53  src/components/landing/__tests__/InteractiveHero.attract.test.tsx
DELETED  src/components/landing/__tests__/InteractiveHero.test.tsx
f23c5ca63cf56f7ab2dbe2b754c5950a66eb172d343e6164f6652943484273d4  src/components/landing/demo/__tests__/EditableImage.test.tsx
c0324aa91432710bfc5214517f4c3a3fb336e9df3a926c7041b13ac93df8513d  src/components/landing/demo/__tests__/EditableText.test.tsx
```

## Not independently verified

This reviewer did not rerun the full Jest coverage pass, production build, lint, both type checks,
format check, production audit or the 106/7 Playwright jobs; those are broader author/hosted gates
and must run on the final manifest-matching commit. Docker was unavailable, so the local
Supabase/GoTrue/PostgREST half of `content-write-privileges.test.ts` was not independently rerun;
required hosted CI remains its release evidence. No provider, production database, deployment,
branch-protection setting, commit, push, PR or merge was touched by this review.

Max severity: none
Ship allowed: yes
