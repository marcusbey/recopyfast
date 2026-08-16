# Story designs

One design per story that has a user-facing surface: `<id>.md` (structure, reused components,
states, gaps) plus `<id>.html` (a static mockup).

**The `.html` is a REFERENCE, not code.** `/ks-execute` builds the screen from the real
components in `src/components/ui/`. A mockup is never pasted into production — it communicates
layout and states, and it does not replace the component system.

Visual source of truth: [`../design-system.md`](../design-system.md). Nothing here may invent a
component, token, colour or spacing outside it. A need the system does not cover is recorded
under "Design system gaps" in the story's `.md` — recorded, never filled freestyle.

## Stories with no design, and why

`AGENTS.md`: *"Design only when the story has UI."* These eight have no user-facing surface, so
they are skipped deliberately. Recorded here so a missing file reads as a decision rather than
an omission.

| Story | Why no design |
|---|---|
| `s06a-embed-byte-gate` | A build-script size gate and two committed constants. The only output is a failing build. |
| `s06b-embed-fixture-harness` | A test fixture page on a non-RecopyFast origin. It is an instrument, not a product surface — its "design" is whatever exercises editing, publishing, staging, history, languages and image replacement. |
| `s06c-embed-shrink` | Byte reduction. Success is defined as the UI being **unchanged** — any visible difference is a regression. |
| `s07a-realtime-service-hardening` | Server-side auth, origin pinning, rate limiting and an integration harness in `server/`. No screen. |
| `s07b-realtime-deploy` | Deployment plus a health-check entry. The one visible artefact — realtime showing in `GET /api/health` — is an API field, and it must degrade the app's status rather than fail it. |
| `s08-embed-transport` | A wire protocol swap: native `WebSocket` for the embed, per [ADR 004](../decisions/004-embed-transport-split.md). Correct behaviour is invisible; the only user-facing artefact is one explicit console warning when a host page's `connect-src` blocks the socket. |
| `s11a-ab-data-plane` | Explicitly "no UI" in its split proposal — migration, deterministic bucketing, and a suite proving the split is honest. |
| `s11c-ab-variant-delivery` | Widget runtime. Its whole goal is that a visitor sees nothing: the variant swap window shrinks and a no-test site issues zero extra requests. |

Three of these — `s06c`, `s08`, `s11c` — are worth stating plainly: **their success criterion is
that nothing looks different.** A design doc would invite change where change is the defect.

## Surfaces that are not app screens

Two designs here cover surfaces the app's CSS tokens cannot reach. Both use **literal values
derived from the tokens**, never `var()`:

- **`s15-agency-digest`** — email. No custom properties, no webfonts, no dark mode; table
  layout, inline styles. It also introduces the shared email shell the design system records as
  missing.
- **`s04-retire-graveyard-surfaces`** and **`s14a-grant-authorized-editing`** — the embed widget,
  injected into customer pages. No shadow DOM, six unlinked `<style>` blocks, zero CSS custom
  properties (see the design system's "Embed widget" section).
