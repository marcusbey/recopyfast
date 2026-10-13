# Research — Story s108-native-operation-ids

Verified against `origin/main` `bc6e503` on 2026-10-12. The primary checkout stayed clean and no
package install, temporary dependency tree, provider call, production request, commit or push was
performed. GitHub PR/check metadata and hosted job logs were read through `gh`; registry metadata
was read through `npm view` only.

## Premise: PR #91 is a module-runtime incompatibility, not a product UUID defect

[PR #91](https://github.com/marcusbey/recopyfast/pull/91) changes only `package.json` and
`package-lock.json`, raising the direct production dependency from `uuid` 11.1.1 to 14.0.0. Its
reviewed head is `900ad10815f144471fde77baeb3db69c58363e77`.

The hosted CI evidence is exact:

- Run `38223184014`, job `114724171995`, reached the coverage Jest step after production audit,
  lint, formatting, production type-check, embed freshness and the Next build all passed.
- Seven suites failed to load at `node_modules/uuid/dist-node/index.js:1` on its first `export`,
  with `SyntaxError: Unexpected token 'export'`: `owner-plan-gate`, `bulk/import-outcomes`,
  `bulk/import`, `bulk/roundtrip`, `bulk/update-literal-only`, `bulk/update-operations-cap` and
  `bulk/update-limiter`. The same run passed 477 suites and 6,772 tests; two suites and 38 tests
  were skipped. Branch coverage then measured 66.92%, under the 67% ratchet only because those
  seven suites never executed.
- The E2E job `114724171891` stopped earlier in its real PostgREST preflight:
  `content-write-privileges.test.ts` imports both bulk routes and hit the same UUID export. Its
  production build and 97-test Playwright step were skipped, so PR #91 has no E2E result.
- TypeScript, the Next production build, the built-embed fixture, the realtime production audit,
  Vercel preview and the comparison Lighthouse job all passed. That separates a Jest loader
  failure from an observed production-runtime failure; the Jest gate remains blocking.

The upstream explanation matches the log. UUID 12 removed CommonJS support; UUID 14 exposes its
Node entry as ESM. UUID's [v12.0.0 release](https://github.com/uuidjs/uuid/releases/tag/v12.0.0)
records the CommonJS removal, and its current README says consumers that require CommonJS should
remain on 11. Jest's own [ESM guide](https://jestjs.io/docs/ecmascript-modules) still describes
ESM mode as a separate runtime/configuration choice. This repository uses `next/jest`, Jest
30.4.2, a CommonJS `jest.config.js`, jsdom and conventional `jest.mock`; converting the whole test
graph is not a one-package repair.

## Complete application-use census

Only two application files import the direct package:

| File                                      | Use                                               | Contract                                        |
| ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `src/app/api/bulk/import/route.ts:10,134` | `v4 as uuidv4`; one call for `bulk_operations.id` | A fresh RFC v4 identifier for the operation row |
| `src/app/api/bulk/update/route.ts:4,106`  | same                                              | same                                            |

No component, embed source, WebSocket source, script, E2E file or other application module imports
`uuid`. The apparent UUID references elsewhere are validation, fixtures, PostgreSQL types or
Node's built-in `randomUUID`.

The repository already uses `import { randomUUID } from "node:crypto"` in server code, including
`src/lib/blog/drafts.ts`. `package.json` requires Node `24.x`. Node 24's official
[`crypto.randomUUID()` documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomuuidoptions)
states that it returns a cryptographically generated RFC 4122 version 4 UUID. That is the complete
behavior these two routes use from the external package; neither passes options, a buffer or an
offset.

`@types/uuid` is also a direct development dependency, but no source imports a type from it. Once
the runtime package is removed, that declaration package has no remaining owner.

## Security and dependency boundaries

The top-level `uuid` on main is 11.1.1. That exact line contains the upstream fix for
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); the
[11.1.1 release](https://github.com/uuidjs/uuid/releases/tag/v11.1.1) is a patched release. PR #91
therefore is not needed to repair the direct production dependency.

The one open UUID Dependabot alert is a different node:
`@lhci/cli@0.15.1 -> uuid@8.3.2`, scoped as a transitive development dependency. Removing the
direct package does not change it. The Lighthouse tree and its other advisories belong to
`s109-lighthouse-advisories`; s108 must neither claim to close them nor add an override for them.

## Smallest compatible repair

Replace the two named imports/calls with `node:crypto.randomUUID`, remove `uuid` and
`@types/uuid` from the root manifest, and let npm regenerate the lockfile. Preserve every bulk
route guard, write order, response, operation-row shape and database boundary.

This is smaller and safer than the alternatives:

- **Keep UUID 11.1.1 and close PR #91.** Compatible and secure, but retains an external production
  dependency for two calls the required Node runtime supplies. It is the fallback if the owner
  rejects removal.
- **Teach Jest to transform UUID 14.** Adds a repository-wide transformer exception for one
  dependency, expands test-runtime behavior and leaves the nested UUID alert untouched.
- **Convert Jest to ESM or upgrade Jest for `require(esm)`.** A broad testing-platform migration
  affecting mocks and module conditions, far outside this repair.
- **Dynamically import UUID 14 in the handlers.** Moves the compatibility risk to request time and
  adds async module loading where a synchronous built-in already satisfies the contract.

## Test surface and traps

- The seven hosted failures are the red regression. They import both affected routes through the
  real Next/Jest transform and must all pass unchanged.
- `src/__tests__/db/content-write-privileges.test.ts` is the PostgREST proof that failed in the E2E
  job. It requires the workflow's disposable Supabase/PostgREST environment; a normal local Jest
  pass can skip its effective-role checks.
- Existing bulk tests exercise successful writes but do not consistently assert that both inserted
  operation ids are RFC v4 strings. Add a narrow assertion at the operation-row boundary; do not
  mock the built-in generator or test Node's implementation.
- PR #91's parent `c905292` is not an ancestor of current remote main. The replacement story branch
  already starts at `bc6e503`; do not repair the stale Dependabot branch in place.
- Closing PR #91 is an external coordination action and comes only after the replacement PR exists
  and the owner has validated this plan. A local green test is not authority to close it.

## Complexity and open decision

Complexity is **2**, matching a bounded non-UI maintenance story: two server imports/calls, two
manifest entries, one generated lockfile and existing regression surfaces. There is no migration,
design step, embed change, new dependency or architectural decision.

The owner must choose between the recommended native replacement and the fallback of retaining
patched UUID 11.1.1 and closing the incompatible major bump. No source or dependency change is
authorized until `docs/plans/s108-native-operation-ids.md` is explicitly validated.
