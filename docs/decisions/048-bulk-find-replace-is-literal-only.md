# ADR 048 — Bulk find/replace is literal only; the regex mode is removed

- Status: accepted
- Date: 2026-10-08
- Scope: story s68b-api-abuse-bounds
- Numbering: see ADR 047 — renumber at merge if s66/s67 claim 047/048 first.

## Context

`POST /api/bulk/update` accepts `operations[].useRegex: true` and then runs
`new RegExp(find, "g")` over the element's current copy (`src/app/api/bulk/update/route.ts:276-300`).
The only guard is `isDangerousRegex` (`:191-205`), two regexes that look for a quantified group
whose body contains a quantifier. They cannot see nesting: `((a+))+$` and `((a|aa))+$` both pass.
Measured on 2026-10-08 (Node 24, this repo's checker copied verbatim): `((a+))+$` against 25 `a`s
and a `!` takes 490 ms, doubling per character — 30 characters is ~16 s of a serverless function,
per operation, with no cap on how many operations one request carries. The copy it runs against is
the caller's own (any `edit`/`admin` member can `set` it first).

Nothing uses the mode. No component sends `useRegex` (`src/components/dashboard/BulkOperations.tsx`
builds `find`/`replace` only), no test exercises it, no integrator document names it; it exists in
the request type (`src/types/index.ts:657`) and in the route.

## Decision

**Find/replace is a literal replace-all (`replaceLiteral`, `route.ts:213-221`). An operation that
asks for `useRegex: true` is refused per operation with a fixed message, and no `RegExp` is ever
built from request input in this route.** `isDangerousRegex` and `MAX_REGEX_LENGTH` are deleted with
a tombstone comment, so nobody restores the mode "because the guard is already there".

## Considered options

- **RE2 via the `re2` npm package** (linear-time engine) — rejected. A native addon: it needs a
  prebuilt binary matching Vercel's runtime or a compile at install, adds a dependency to the
  production audit gate (s63/s64), and changes regex semantics (no backreferences, no lookaround)
  for a feature with no users.
- **`re2-wasm`** — rejected for the same semantic change and an added WASM payload to a route
  bundle, again for zero callers.
- **A better heuristic** (detect nesting, star height) — rejected. Exponential backtracking is not
  the only failure: polynomial patterns such as `\s*\s*\s*…$` stay slow on long copy and no shape
  check sees them. Heuristics are how this finding exists.
- **V8's non-backtracking engine** (`--enable-experimental-regexp-engine`, the `l` flag) — rejected:
  a process-wide experimental flag we do not control on Vercel.
- **A timeout around `replace`** — rejected: JavaScript cannot interrupt a synchronous regex; it
  would need a worker per operation.

## Consequences

- An API caller sending `useRegex: true` now gets that operation reported as failed with
  "Regex find/replace is not supported; use literal find/replace." instead of a regex replace. No
  known caller does.
- If regex replace is ever wanted, it comes back as a story with a linear-time engine and a test
  that fails on `((a+))+$`, not by re-adding `new RegExp(find)`.
