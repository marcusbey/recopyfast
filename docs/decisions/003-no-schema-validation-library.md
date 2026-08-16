# ADR 003 — Boundary validation stays hand-rolled; no schema library

- Status: accepted
- Date: 2026-08-16
- Scope: framing

## Context

Every API route validates untrusted input at its boundary. The usual answer in this stack is
zod, and the project's general coding rules name it by default.

zod is **not installed**. It is absent from `package.json` and from `node_modules`, and
imported by zero files. What exists instead is `src/lib/api/validation.ts`, whose header
records the decision that produced it: the validators were written during a security fix, and
adding a dependency from inside a security fix was judged the wrong move. Its result type is
deliberately shaped like zod's:

```ts
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
```

Alongside it sit two domain-specific validation modules that a general schema library would not
replace: `src/lib/security/discovered-text.ts` (text scraped off a customer's DOM — validated
against control characters, size and shape, and explicitly *not* sanitized as markup) and
`src/lib/security/content-sanitizer.ts`.

The question has to be settled now because the backlog adds new routes — impression ingest
(`s09`), A/B configuration (`s11`), agency plan (`s13`), webhook config (`s16`) — and each one
will otherwise re-decide it.

## Decision

**Keep the hand-rolled validators. Do not add zod.** New routes validate with
`src/lib/api/validation.ts`, extending it when a needed validator is missing.

Boundary rules, unchanged from what the code already does:

- Parse bodies with `readJsonObject`. Reject `null`, arrays and primitives by name — an array
  passes `typeof === "object"` and would index its members as if they were fields.
- Reject `__proto__`, `constructor` and `prototype` keys before any spread.
- Cap free-form objects on both serialized size and nesting depth.
- Redact control characters *before* echoing a rejected value into a response or a log line.
  A value rejected for containing CR/LF must not forge a log line on its way to being rejected.
- Cap how many rejections a response enumerates. A refusal that lists every bad row turns a
  400 into an amplifier.

## Considered options

- **Add zod and use it for new routes only** — rejected. Two validation idioms across 77 routes
  is worse than one imperfect idiom. The next agent then has to guess which applies where, and
  the security-relevant modules stay outside both.
- **Add zod and migrate all 77 routes** — rejected as disproportionate. It is a large, entirely
  mechanical, entirely untested-by-the-user change to the one layer where a subtle regression is
  a security incident, undertaken to fix no reported defect. The 0-user window is for cutting
  scope, not for churning working code.
- **Valibot / ArkType** (smaller, same shape) — rejected for the same reason as zod, with less
  ecosystem support and no offsetting benefit. Bundle size is not the constraint here anyway:
  this code runs server-side. The widget, which *is* byte-constrained, shares none of it.
- **No validation module; validate inline per route** — rejected outright. That is what the
  codebase had before, and the prototype-pollution and log-forging cases above are the specific
  bugs that ended it.

## Consequences

**Easier.** One idiom. Security-relevant validation lives in two named modules a reviewer can
read end to end, rather than being distributed across schema declarations.

**Harder.** No type inference from a schema — request types are written by hand and can drift
from the validator. Mitigate by returning the narrowed type from the validator, as
`readJsonObject` does, rather than casting at the call site. There is also no free error
formatting, hence the explicit rules about what a refusal may echo.

**Watch.** The `ValidationResult` shape mirrors `safeParse` on purpose, so if a future story
genuinely needs schema composition, migration is mechanical and this ADR can be superseded
rather than worked around.
