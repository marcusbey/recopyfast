# Review — s72-edit-board-history-xss

Reviewer: fresh-context `reviewer` subagent (security), 2026-10-09. Diff: `git diff origin/main...feature/s72-edit-board-history-xss`
(59d0596 → 715496f; 4f0cc03 story/research/plan, e179ba1 validated).

## Verdict summary

Every plan task done; nothing beyond it; s72b not implemented (no `supabase/`, `server/`, grants or
dependencies). The embed hands the HTML parser literals only: 29 sinks, 28 pure literals plus
`svg.innerHTML = ICONS[name]` (a const map of literals, literal callers). No `outerHTML`, `insertAdjacentHTML`,
`document.write`, `createContextualFragment`, `DOMParser`, `srcdoc`, `eval`, `new Function`, `setHTML*` or
`setAttribute('on…')`. History: author via `textContent` in a span, date as a text node; restore refusal via
`textContent`, success the literal "Version restored". Editor bar, staging banner, verification modal, AI
suggestions, Elements and Languages tabs all text; the one data-built `cssText` uses numbers; stored hrefs pass
the scheme allowlist. Old stored values render inert (payload fed straight into the GET response).

Writers of author fields: every value comes from Supabase Auth, an admin-chosen address, a user id or a
literal — no non-admin path; the route rule is defense in depth until s72b. `isPlausibleEmail` (WHATWG +
dotted domain, ≤254, length first, no ReDoS) refuses payload-shaped, quoted, whitespace, dotless, hyphen-edged,
IP-literal, underscore, non-ASCII and 255-char inputs; accepts uppercase, `+tag`, `o'brien`, punycode, 254 chars.
The staging route checks type, trims, validates before any database read or write, returns a fixed message and
echoes nothing. Production read-only count (orchestrator, 2026-10-09): 0 stored payloads, 0 live addresses
refused.

Bytes: main 45840 / 33073 → **45828 / 33062**; `MAX_*` and `SEEDED_MAX_*` equal the measurement; the artifact
rebuilds byte-identical; ledger re-measured by subset rebuilds (G −6 / −4, + R1 + R2 −6 / −5, comment 0 / −2).

Gates: jest 381 suites / 4,938 passed; `type-check`, `type-check:build` 0; lint 0 errors; `format:check`
clean; build exit 0; `build:embed -- --check` 45828 / 33062; Playwright `--list` 80. 11 mutations red (history
line, span, R1, R2, email rule, length cap, route validation, `typeof`, trim, untrimmed store) — one green:
validation moved after the `sites` read (minor 2). 23 guard probes: 11 forms caught, 12 missed (minor 1).

## Findings

**minor 1 — the sink guard misses some forms** (`html-sinks-are-literal.test.ts`): `Object.assign(el,
{innerHTML})`, `||=` / `??=` / `&&=`, computed keys, `Reflect.set`, `setHTML*`, `srcdoc`, `document['write']`;
its header overclaimed "the regression test for the class". None exist in the source.

**minor 2 — "refused before the site is read" is unpinned** (`route.ts:110-129`, `access.test.ts:433-449`):
moving the validation after the `sites` read stays green.

## Fix pass `824479f` — minors 1 and 2

Minor 1: the guard reads `||=`, `??=`, `&&=`; bans `srcdoc` and `setHTML`; counts every mention of `innerHTML`
in code (object-literal key, destructuring, `Reflect.set` literal) and requires it to equal the sinks it judges.
Mutations: `Object.assign(document.body, { innerHTML: window.name })` → red; `f.srcdoc = window.name` → red.
Header now names what still slips (a run-time-built key, `document['write']`). Minor 2: a table-read tracker
pins the refusal to read no table; moving the address check after the `sites` read → red. Test-only; no source
or byte change. Full jest 4,942 passed. Reviewed by the orchestrator (author of this pass: orchestrator; the
change is tests only and each new assertion was shown red under mutation).

## Not verified

Real browser (jsdom fires no `onerror`): on a preview stack, seed `created_by = <img src=x onerror=alert(1)>`,
open History as a staging-invite editor — nothing runs, spacing unchanged. The real `restore_content_version`
RPC ("Version restored"). The served artifact after deploy (`span><span>by ` count 0). GoTrue's live email rule
and OAuth providers. Direct PostgREST writes to `staging_access.email` (by design until s72b).

Max severity: minor
Ship allowed: yes
