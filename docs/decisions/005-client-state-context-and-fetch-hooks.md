# ADR 005 — Client state is React Context plus custom fetch hooks

- Status: accepted
- Date: 2026-08-16
- Scope: framing

## Context

Three state and editor libraries are declared in `package.json` and imported by **zero** files
in `src/`, `server/` or `scripts/`:

| Package | Declared | Imported by |
|---|---|---|
| `zustand` `^5.0.7` | yes | 0 files |
| `@tanstack/react-query` `^5.85.0` | yes | 0 files |
| `@tiptap/react` + `starter-kit` + `extension-placeholder` `^3.1.0` | yes | 0 files |

Both the superseded architecture plan and the root `CLAUDE.md` name them as the stack. The plan
went further and recorded a "Decision: Hybrid Approach — Zustand for client state, React Query
for server state". `CLAUDE.md` documents a `src/store/` directory for Zustand. That directory
does not exist.

What the code actually does, consistently, across 121 client components:

- **Server state**: a custom hook per resource — `useState` + `useEffect` + `fetch`, returning
  `{ data, loading, error, refetch }`. Seven of them in `src/hooks/`. `useSites.ts` is the
  reference shape.
- **Cross-cutting state**: React Context. There is exactly one, `AuthContext`.
- **Local state**: `useState` in the component.
- **Rich text**: none. Editing is contentEditable in the widget and plain inputs in the
  dashboard.

This is drift with teeth. An agent reading `CLAUDE.md` writes a Zustand store, and now the
claim is half-true, which is worse than either state — the next agent finds one store and
reasonably assumes it is the convention.

## Decision

**The convention is React Context plus custom fetch hooks. That is now written down, and the
three unused packages are removed from `package.json`.**

- New server-state reads follow the `useSites.ts` shape. Colocate the hook in `src/hooks/` when
  more than one page needs it; keep it beside the component when one does.
- The error case is part of the shape, not an afterthought: a non-ok response must produce an
  error state, never an empty list. `useSites.ts` carries the comment explaining why — falling
  through rendered "No sites found" on every outage, which reads to a customer as *your account
  is empty* rather than *we failed*.
- Cross-cutting state gets a Context only when several unrelated subtrees read it. Auth is the
  bar; nothing currently clears it besides auth.
- Rich text: if a story ever needs it, that is a new ADR with a real requirement behind it, not
  a dependency already sitting in the lockfile.

## Considered options

- **Adopt React Query, since it is already declared** — rejected. "It is in package.json" is not
  a requirement; it has been declared and unused through the entire build. Adopting it means a
  provider at the root, a second server-state idiom alongside seven existing hooks, and a
  migration nobody asked for. The dashboard fetches a handful of resources per page and has no
  cache-invalidation problem that the current shape fails to solve.
- **Adopt Zustand for dashboard state** — rejected. There is no state today that outlives a
  route or crosses unrelated subtrees, which is the condition that justifies an external store.
  Adding one now is speculative generality.
- **Leave the packages declared but unused** — rejected. This is what produced the drift. Every
  unused dependency is a lie in the manifest, a supply-chain surface (`npm run audit:prod` is a
  blocking CI gate), and an invitation for the next agent to "use what's already there".
- **Remove them and say nothing** — rejected. The claim is repeated in `CLAUDE.md` and in the
  archived plan; deleting the packages without correcting the documents leaves the misleading
  half intact.

## Consequences

**Easier.** One idiom for server state, verifiable by reading one file. The dependency manifest
matches reality, so `audit:prod` reports on code we actually ship.

**Harder.** No request deduplication, no background refetch, no cache across components — two
components mounting the same hook both fetch. That is the current behaviour and it is
acceptable at this scale; it is not free forever.

**Watch.** The trigger for revisiting is concrete, not aesthetic: if two components on one page
fetch the same endpoint, or a story needs optimistic updates with rollback across components,
React Query earns its place and this ADR should be superseded. Until then, adding it is churn.

**Also.** `three` / `@react-three/fiber` / `drei` (4 files) and `framer-motion` (18 files) *are*
used, but only in the landing and marketing surface. They stay, and they stay there — neither
may reach the dashboard, and neither may reach the widget, which is byte-budgeted.
