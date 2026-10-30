# Review — s127-embed-current-script

**Reviewer:** fresh-context `reviewer` subagent (Claude), 2026-10-29.
**Diff reviewed:** `git diff origin/main...feature/s127-embed-current-script` (`35d5a544`, `32175a06`,
`73644eca` on `5efbc0ff`).
**Authorship:** implementation by Codex; fixture fix and browser runs by Claude.

## Summary

No critical or major issue. Both loaders now read `currentScript` through the native
`Document.prototype` getter and require an `HTMLScriptElement`. Any other value makes the loader
refuse silently instead of throwing into the host page.

## Verification run by the reviewer

| What | Result |
|---|---|
| Full Jest | 8,621 passed, 2 skipped |
| `build-embed --check` on Node 24 | up to date |
| Bundle size | 45,800 / 45,801 B |
| Widget size | 33,022 / 33,044 B |
| Rebuilt artifact | byte-identical to the committed one |
| Built-embed Playwright | 13/13 |
| Lint | 0 errors |
| Type-check | passed |
| Size ceilings | unchanged |

## Neutralizations

Each was restored afterwards and the tree was confirmed clean.

| Mutation | Tests red |
|---|---|
| Raw `document.currentScript`, `instanceof` kept (Jest) | 11/26 |
| Native getter kept, `instanceof` removed (Jest) | 8/26 |
| Raw read on the rebuilt artifact (Playwright) | 4/6 |
| Baseline-equivalent artifact (Playwright) | 4/6 — canonical with 1 clobber sent 20 requests to `attacker.invalid` |

These runs confirm the browser premise in real Chromium: one named `<img>` makes
`document.currentScript` an image, and two make it a collection.

## Findings (all minor)

1. The `ReCopyFast: set data-api-url.` warning was removed to save bytes. That loses an integrator
   diagnostic. The owner authorized it and it is documented.
2. The bundle has 1 B of headroom left.
3. The legacy Playwright cases did not check the `?fixture=1` query passthrough. **Fixed in this
   PR** (see Fix run).
4. Stale "pending" lines remained in `docs/stories.md` and the research doc. **Fixed in this PR.**
5. The legacy loader has no "missing getter" test, and its `current &&` checks are dead code.
   Harmless.
6. The source comment slightly oversells what `instanceof` defends against: host JavaScript can
   redefine the getter, which is an accepted residual. A cross-realm script element fails closed;
   this path is untested.
7. Out of scope: `public/try/rcf-try.js:10` still reads raw `currentScript`. It runs only on our own
   `/try` page. Backlog it for the security-lows pass.

## Not verified

- Firefox and Safari: only Chromium ran.
- The legacy loader under a real strict-nonce CSP.
- Installs through a tag manager (GTM) and re-injection in SPAs.
- The real API, WS server and Supabase.
- Cross-realm script elements.
- Coverage and `npm run build`, beyond the implementer's reported evidence.

## Fix run (Claude, 2026-10-29)

- **Finding 3:** `current-script.spec.ts` now records requests for `/embed/recopyfast.js`. In the
  legacy cases it asserts that the canonical sibling arrives with `fixture=1`. Bite check: with the
  `$1` passthrough removed from `recopyfast-secure.js`, the 3 legacy cases fail. With it restored,
  6/6 pass.
- **Finding 4:** the stale "pending" lines in `docs/stories.md` and the research doc now record
  the 13/13 run.
- **Findings 1, 2, 5, 6 and 7:** left as documented. Finding 7 belongs to the security-lows backlog.

Max severity: minor
Ship allowed: yes
