# ADR errata

Corrections to **pointers** in accepted ADRs — line numbers, file paths, symbol names, counts.

This file exists so that a factually wrong citation can be fixed without touching an ADR body.
`AGENTS.md` makes ADRs immutable: *"a change means a new ADR superseding the old one."* That rule
protects decisions from being quietly rewritten, and it is right. But it collides with a smaller
problem: a citation is not a decision, and a superseding ADR per stale line number would be absurd
bookkeeping that buries the real supersessions ([024](./024-bulk-import-snapshot-change-type.md),
[026](./026-one-machine-no-adapter-supersedes-023.md)) in noise.

So corrections are recorded **here, outside the ADR files**. No ADR body is ever mutated, and the
immutability rule is kept whole rather than carved out.

## What may and may not be recorded here

**May** — a pointer that no longer resolves, or resolves to the wrong thing:
file path, line number, symbol name, a count, a command's flags.

**May not** — anything that changes what was decided: the decision itself, its rationale, the
options considered, why they were rejected, or its consequences. **Those still require a
superseding ADR**, and this file is not a shortcut around that. If correcting a "pointer" would
change what a reader concludes, it is not a pointer — write the ADR.

## How to write an entry

**Anchor on symbols, not line numbers.** Every entry below exists because a line number moved.
Give the file plus a name a reader can search for (`min_machines_running`, `verifySiteToken`), and
the correction survives the next refactor. A bare `:97` does not.

A line number that moved is only worth an entry when it now lands on **unrelated code that looks
plausible** — that is worse than an out-of-range number, which fails loudly. A cite that merely
drifted a few lines within the same block is not worth recording.

---

## ADR 023 — `:25` cites a file that no longer exists

**Says:** *"**The dashboard** (`src/lib/collaboration/realtime.ts:93`) sets…"* — cited for the
dashboard's `transports` option.

**Correction.** `src/lib/collaboration/realtime.ts` was **deleted on 2026-08-17** (commit
`3dbbc57`). It was dead: the only `socket.io-client` import in `src/`, and nothing imported it.
Its production path also carried `process.env.NEXT_PUBLIC_WS_URL || "wss://your-production-ws-server.com"`,
a placeholder that is not the empty-string "off" value — re-introducing the bug
`getPublicWebSocketUrl` in `src/lib/sites/embed-script.ts` records as fixed.

**The dashboard never opened a socket to this service.** There are **two** live transport pins,
not three:

| Pin | Where |
|---|---|
| Server | `server/index.js` — the `transports` key in the `new Server(...)` options |
| Embed widget | `public/embed/recopyfast.src.js` — the `transports` key in the `io(RECOPYFAST_WS, {…})` options |

**ADR 023's decision is unaffected.** WebSocket-only is pinned, sticky routing is still rejected.
Only the count of places and one file path were wrong. (ADR 023 is separately superseded by
[026](./026-one-machine-no-adapter-supersedes-023.md) on the deployment shape — that is a decision
change, correctly handled by an ADR rather than by this file.)

## ADR 026 — `:25` cites `server/fly.toml:97`

**Says:** *"`server/fly.toml:97` pins `min_machines_running = 1` with `auto_stop_machines = false`."*

**Correction.** The claim is true; the line number is not. Anchor on the **`min_machines_running`
key in the `[http_service]` block** of `server/fly.toml`.

Worth recording precisely because of how it failed: the key was at `:107` when ADR 026 was written,
and the commit that fixed *other* stale cites in the same file (`3dbbc57`) moved it to `:110`. The
number was wrong twice within one day, and the second time it went stale **inside the commit whose
purpose was fixing stale cites**. Nothing about the pin changed.

`auto_stop_machines = false` and the one-machine decision are both unchanged and still correct.


## ADR 014 — checkout reservation symbol superseded

**Says:** trial conversion uses `claimSubscriptionReservation` / `withUserLock` in the subscription checkout branch.

**Correction.** s28 replaces the removed `claimSubscriptionReservation` with `claimSubscriptionCheckoutIntent` in `src/lib/billing/checkout-reservation.ts`. `withUserLock` remains around the subscription branch. [ADR 028](./028-durable-subscription-checkout-intents.md) records the structural protocol change; the trial-grant decision and conversion-inside-the-lock constraint remain unchanged.

## ADRs 028/029/019 — s34 supersession pointer

[ADR 031](./031-checkout-hold-expiry-and-recoverable-subscriptions.md) records the decision
changes for bounded unresolved founding holds, paid late completion, duplicate-account refunds
and invoice/portal recovery that blocks replacement subscriptions without cancelling them. It
also explicitly records the s33 fail-closed `getUserSubscription` behavior omitted from ADR
029's supersession scope. This entry is only a pointer; the changed policy and rationale live in
ADR 031.

## Founding bind wrapper — historical deployment citation

The comment above the three-argument `bind_founding_agency_checkout` wrapper in applied
`20260924065000_agency_plan_and_founding_capacity.sql` incorrectly says previously deployed code
called it. The earlier `040000` version was an unpublished draft. The wrapper preserves that
function identity, but its presence is not evidence of a prior deployment. Applied migration
history remains unchanged; the four-argument form carries the provider expiry.

## s34 checkout claim overload — inaccurate rolling-deploy justification

The comment above the two-argument `claim_subscription_checkout_intent(UUID, TIMESTAMPTZ)`
overload in the unpublished `20260925100000_checkout_hardening.sql` draft said it had to remain
safe because an older deployed application could call it during a rolling deploy. Deployed
`main` already called only the five-argument catalogue-choice overload through
`claimSubscriptionCheckoutIntent` in `src/lib/billing/checkout-reservation.ts`. Hardening the
two-argument function was harmless, but it was not a deployed call-site compatibility measure.
The final s34 migration removes the unused replacement rather than preserving a false historical
claim. Applied migrations remain unchanged.


## s38 branch ADR numbering after PR #32 integration (2026-09-25)

PR #32 reached main with billing ADR 031 while s38 was being verified. Before merging s38,
its branch-only column-privilege ADR moved from 031 to 033, and its follow-up portability/
least-privilege ADR moved from 033 to 034. Only numbers and references changed; decisions
are preserved. The immutable uncommitted s38 review refers to its historical 031 filename.
