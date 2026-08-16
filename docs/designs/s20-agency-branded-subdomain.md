# Design — Story s20-agency-branded-subdomain

## Screen(s)

One page, reached from Agency-plan account settings: **Branded subdomain**
(`/dashboard/settings/branding`, agency-plan gated — mirrors how other plan-gated
panels already sit under Settings). The page carries one `PageHeader` ("Branded
subdomain") and one `Card` that is the single source of claim status, following the
same fixed-anatomy-per-state pattern `s02-install-verified` established for
"Installation": one shape, state-specific body, so the transition between states
(claim → verifying → active) is legible as *the same thing changing*, not a
different screen appearing.

The design problem this screen exists to solve is not "let an agency pick a
hostname" — that part is a text field and an availability check. It is that
**claiming is close to permanent and the UI has one chance to make that
unmistakable before the click that commits it.** Per `docs/research/s13-agency-plan.md`
§ M4 and AGENTS.md non-negotiable 2, the branded origin gets baked into every
snippet issued after the claim, those snippets get pasted onto client sites this
product does not control, and the commitment **outlives the agency's own
subscription** — cancelling Agency does not un-claim the subdomain, because the
snippet is still live on someone else's page. A wrong claim is not a settings
change to revert; it is a promise made on infrastructure the agency doesn't own.
Two mechanisms in this design exist only because of that fact and would not exist
for an ordinary settings field: the irreversibility `Alert` inside the confirmation
`Dialog`, and a type-to-confirm gate on the `Dialog`'s primary action (detail below).

**Infrastructure note, not a design decision — recorded here because it changes
what "pending" means on screen:** wildcard host routing and a wildcard TLS
certificate for `*.recopyfa.st` are an **operator/Vercel decision, not code**, and
research flags them as unsettled. This design assumes they exist and shows the
resulting propagation delay as a first-class state (below). If the operator
decision lands as per-subdomain (non-wildcard) certificate issuance instead, the
pending-propagation state's copy ("usually 5–30 minutes") and its two-step
checklist (DNS, then certificate) still hold — only the actual provisioning
mechanism behind it changes. **This must be settled before `/ks-plan`,** as the
team-lead brief already states; the screen does not depend on which way it's
settled, but the plan does.

Screens covered here, all one page:

1. The claim form — subdomain entry, live availability check, the reserved/taken
   states, and the irreversibility warning gating the primary action.
2. The claim confirmation `Dialog` — the irreversibility warning at full weight,
   type-to-confirm, this is the actual commit point.
3. The pending/verifying state — DNS + certificate provisioning, explicitly not
   instant, explicitly not something to retry.
4. The claimed/active state — the hostname, the before/after snippet comparison,
   and the explicit reassurance that every snippet already issued keeps working
   unchanged.

Out of scope: DNS/TLS operator setup itself (infra, not UI); a "change subdomain"
action (there isn't one — the permanent-URL rule means there is nothing to design
here beyond "contact support," which is copy, not a screen); retroactively
rewriting snippets already issued (the AC is explicit that the default origin
"keeps working for every snippet already issued" — nothing in this screen should
imply migration).

## Mockup   (REFERENCE only)
`docs/designs/s20-agency-branded-subdomain.html` — static reference, all states
and the dialog laid out together. Not production code; Execute builds this with
the real `src/components/ui/*` components (`Card`, `StatusBadge`, `IconTile`,
`Alert`, `Dialog`, `Input`, `Label`, `Button`, `PageHeader`).

## Reused components (from the design system)
- `PageHeader` — page title "Branded subdomain" + eyebrow "Agency plan".
- `Card` (`default` variant) — the single panel, all states.
- `IconTile` — state glyph in the card header. `neutral` (unclaimed, globe icon),
  `info` (verifying, clock icon), `success` (claimed, check icon) — same tone
  vocabulary `s02` already uses for its adjacent install states.
- `StatusBadge` — the state pill: `neutral` "Not claimed", `info` "Verifying",
  `success` "Active". Inline within the form, also `success` "Available" and
  `danger` "Unavailable" for the live availability check (taken and reserved are
  the same blocked state with different copy — colour signals state, not category,
  per the design system rule, so both render `tone-danger`).
- `Alert` — three distinct uses, each load-bearing:
  - `variant="warning"` — the irreversibility warning, both inline under the form
    once a subdomain looks available, and at full weight inside the confirmation
    `Dialog`. This is the component the whole screen is designed around.
  - `variant="info"` — the pending-propagation explanation ("this is normal,
    don't retry"), same role `s02` gives its "Checking automatically" note.
  - `variant="success"` (claimed state) — the explicit "existing snippets keep
    working" reassurance. Per the brief, this is not a footnote; it gets the same
    visual weight as the warning that preceded it, because it is the payoff of
    having taken the warning seriously.
  - `variant="destructive"` — claim submission failure (network/server error),
    per the system's standard error-state pattern.
- `Dialog` — the claim confirmation. Title, the irreversibility `Alert`, a
  type-to-confirm `Input`, `Button` (`variant="outline"`) to cancel and
  `Button` (`variant="default"`) to confirm, disabled until the typed value
  matches. Not `variant="destructive"` on the confirm button — claiming isn't a
  deletion, and colouring it as one would misstate what's happening; the
  seriousness is carried by the `Alert` and the type-to-confirm gate, not by red.
- `Input` + `Label` — the subdomain field (with a `.recopyfa.st` suffix, composed
  the same way the design system's documented icon-in-input pattern is: absolute
  positioned, `text-muted-foreground`, inside the input's padding) and the
  type-to-confirm field inside the `Dialog`.
- `Button` — `outline size="sm"` for "Copy" on both snippets in the claimed state
  (identical control to `s02`'s snippet copy button); `default` for "Claim
  subdomain" / the dialog's confirm action; `ghost` for the dialog's cancel.
- `Skeleton` — page-level loading, in the shape of the `Card` header + two body
  lines, while the account's current claim status is fetched. Same usage `s02`
  specifies and does not render bespoke.
- Type: `.text-title` (card title), `.text-eyebrow` (page header eyebrow,
  section labels like "Default origin" / "Branded origin"), `text-sm
  text-muted-foreground` (body copy), **`--font-mono`** for the subdomain itself
  wherever it appears as a value (card title once claimed, both snippet blocks,
  the type-to-confirm field) — a hostname is a machine string under the design
  system's explicit rule, not prose.

## States   (empty / loading / error / success — plus taken, pending-propagation, and claimed)

| State | What it shows |
|---|---|
| **Loading** | Page-level `Skeleton` (card header bar + two body lines) while the account's current claim status loads. Not a spinner. |
| **Empty** | The claim form: `Label` + `Input` (with `.recopyfa.st` suffix) + `Button` "Claim subdomain" (disabled — nothing typed yet). No availability feedback shown until input exists. |
| **Success** (of the availability check, not the whole flow) | Typed value passes validation and the check returns free: `StatusBadge tone-success` "Available" inline under the input, the irreversibility `Alert` (`variant="warning"`) appears beneath it, "Claim subdomain" enables. This is the gate that opens the `Dialog`. |
| **Taken / reserved** | Typed value is already claimed by another agency, or is a reserved system word (`www`, `api`, `app`, `admin`, `dashboard`, `mail`…) — both render `StatusBadge tone-danger` "Unavailable" with copy naming which reason applies. "Claim subdomain" stays disabled. |
| **Error** | Claim submission itself fails after confirmation (network/server error, not an availability conflict — that's the "taken" state above) — `Alert variant="destructive"` above the form: what failed, and that nothing was claimed. |
| **Pending-propagation** | After the `Dialog` is confirmed: `IconTile`/`StatusBadge tone-info` "Verifying". Two-step checklist (DNS record, TLS certificate), each with its own small status pill so the agency can see *which* half is still working rather than one undifferentiated spinner. `Alert variant="info"`: expected window ("usually 5–30 minutes"), explicit "you don't need to do anything, refreshing won't speed it up" — this line exists specifically to prevent the retry/panic behaviour the brief calls out. |
| **Claimed** | `StatusBadge tone-success` "Active". Hostname in `--font-mono` as the card title. Two snippet blocks side by side, not tabbed — the point is to *see the diff*, not switch between two things: **"Default origin (already installed)"** showing the existing `www.recopyfa.st` snippet with copy noting it is unaffected, and **"Branded origin (new installs)"** showing the `acme.recopyfa.st` snippet that new sites will now receive. Below both, `Alert variant="success"`: existing snippets keep serving from the default origin untouched; only snippets generated from this point on use the branded host. |

The `Dialog` (claim confirmation) is a state of its own, layered over "Success":
title naming the exact subdomain, `Alert variant="warning"` ("This can't be
undone") spelling out that the commitment outlives the subscription and lives on
pages this product doesn't control, a type-to-confirm `Input` ("Type
`acme.recopyfa.st` to confirm"), and a confirm `Button` that stays disabled until
the typed value matches exactly. Cancelling returns to "Success" with nothing
claimed.

## Design system gaps
1. **No inline progress/spinner primitive.** `Skeleton` covers content
   placeholders; it has no answer for an in-flight *action* — "checking
   availability" while typing, or the two in-progress checklist rows in
   pending-propagation. The mockup uses a CSS pulse (existing `--dur`/`--ease-out`
   motion tokens, no new component) on the `IconTile`/`StatusBadge` dot rather
   than invent one. Confirm at `/ks-plan` whether that composition is acceptable
   long-term or whether a spinner primitive should be added — this is the second
   story in a row (`s02` had the same question for its "checking automatically"
   note) to want one.
2. **No documented "type-to-confirm" pattern for irreversible actions.** This
   design introduces one for the claim `Dialog`, composed entirely from existing
   `Input`/`Label`/`Button` — no new component — but there is no precedent in the
   design system to point at. Worth checking at `/ks-plan` whether an existing
   irreversible action elsewhere in the product (e.g. site deletion, hardened in
   `728b646`) already uses a comparable gate, so this doesn't become the first of
   two inconsistent patterns for "are you sure, really."
3. **Copy-confirmation feedback** on the two "Copy" buttons in the claimed state
   inherits the same open gap `s02` already recorded: no toast/transient feedback
   primitive exists (`design-system.md` gap #1). Same pragmatic fallback applies
   (button label swaps briefly) — not re-litigated here, just inherited.
