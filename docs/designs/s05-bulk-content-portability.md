# Design — Story s05-bulk-content-portability

## Screen(s)

One screen: a **"Content portability" card** mounted inside the existing Site Detail
view (`src/components/dashboard/SiteDetailView.tsx`), following the exact precedent
already set by `DomainVerification` and `VersionHistoryPanel` — both are cards keyed
off `site.id`, appended to the bottom of that page, not new routes. This story adds a
third card to that same list.

**Placement:** directly above `VersionHistoryPanel` (currently mounted at
`SiteDetailView.tsx:374`). The acceptance criterion "imported changes appear in
version history as normal, revertible edits" is a reassurance the user needs to trust
*before* they run an import — putting the two cards adjacent, in that order (portability
above history), lets a cautious owner scroll one card down and literally see their
history panel is right there, unaltered in shape, ready to prove the claim.

This is a card **within** an existing page, not a page of its own — so it does not
carry a `PageHeader` (that belongs to the page `SiteDetailView` already owns). The
card uses `CardHeader` + `CardTitle` + `CardDescription`, matching every other card on
this page.

**Naming:** the card is titled **"Content portability"**, not "Bulk Operations." The
existing component's name is an internal/admin word; the PRD explicitly frames this
screen as the thing that *"kills the lock-in objection in the sales call,"* so the
customer-facing label has to read like a promise ("your content, portable"), not like
a hidden admin utility. Same reasoning applies to the tab labels below.

Inside the card: three tabs — **Export**, **Import**, **History**. `Batch Update` (the
existing fourth tab in `BulkOperations.tsx`) is out of scope for this story's
acceptance criteria and is not redesigned here; it is not removed either — leave its
existing tab and implementation untouched, still reachable at the same place, unless a
future story addresses it.

## Mockup (REFERENCE only, never copied into production)

`docs/designs/s05-bulk-content-portability.html` — static, token-driven, shows:

1. **Export tab** — format choice, a plain-language "what's in the file" preview of
   the five exported fields, optional filters, and the export action.
2. **Import tab, empty/default state** — file choice, format, import options.
2. **Import tab, refused before parsing** — file too large for the stated limit.
3. **Import tab, permission refusal** — viewer without edit access on this site.
4. **Import tab, partial-success outcome report** — the heart of this design: 394
   created, 3 updated, 0 skipped, 3 failed out of 400 rows, readable at a glance.
5. **Import tab, full-success outcome report** — shown small, for contrast against #4.
6. **History tab, empty state** — using the real `EmptyState` component (today's
   `BulkOperations.tsx` hand-rolls this exact case with a raw `<div>` + `FileText`
   icon; swapping it for `EmptyState` is a direct, in-scope fix while wiring this up).

Every section in the HTML is labeled with its state name — it is a state sheet, not a
claim about final pixel layout.

## Reused components

All from `docs/design-system.md` — nothing outside it.

| Component | Where |
|---|---|
| `Card` / `CardHeader` / `CardTitle` / `CardDescription` | The portability card itself; matches `DomainVerification`/`VersionHistoryPanel` |
| `IconTile` (`tone="neutral"`, default size) | Card header icon, next to the title — neutral, not a status colour, because the card itself is not a state |
| `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` | Export / Import / History — already the pattern in `BulkOperations.tsx` |
| `Select` | Format choice (JSON / CSV) — replaces the two raw `<select>` elements currently hand-rolled in `BulkOperations.tsx` |
| `Input` / `Label` | File choice, export filters |
| `Button` (`default`, `outline`, `secondary`, `ghost`) | Export/Import primary actions, "Show all rows" disclosure, retry |
| `Alert` (`default`, `info`, `success`, `warning`, `destructive`) | Every feedback state — size-limit refusal, permission refusal, export confirmation, import outcome summary. There is no toast; all of this is inline, next to what it concerns |
| `StatusBadge` | Per-row outcome — see mapping below |
| `Metric` + `.text-metric .tabular` | The four outcome counts (created / updated / skipped / failed) above the report table |
| `IconTile` (tone variants) | Small marker in the outcome-report summary row |
| `EmptyState` | History tab, zero past operations — replaces the current hand-rolled empty block |
| `ContentValue` | Any place a stored content string is shown — the "what's in the file" preview and a failed row's offending value, so rendering is safe by construction |
| `Skeleton` | Import in progress, in the shape of the outcome table (not a bare spinner) |

**`StatusBadge` tone mapping for the four outcomes** (per the brief, this is fixed —
colour signals state, never category):

| Outcome | Tone | Badge reads |
|---|---|---|
| created | `success` | "Created" |
| updated | `info` | "Updated" |
| skipped | `neutral` | "Skipped" |
| failed | `danger` | "Failed" |

## States

Two data-bearing surfaces on this screen — Export and Import — each needs all four
standard states, plus the one this story exists to get right: **partial success**.

### Export

| State | Treatment |
|---|---|
| Empty/default | Form at rest: format `Select`, "what's in the file" preview (always shown — it's not data-dependent), optional filters collapsed to their placeholders, `Button` enabled |
| Loading | `Button` shows its own spinner + "Exporting…" (this is a single fast request, not a data view — a full `Skeleton` would be theatre for what completes in well under a second) |
| Error | `Alert variant="destructive"` — "Export failed — [reason]. Try again." |
| Success | `Alert variant="success"` — "Export ready — `content-export-<site>-<date>.json` downloaded." Transient by nature of a browser download, but rendered inline per the no-toast rule, not as a popup |

### Import

| State | Treatment |
|---|---|
| Empty/default | File choice + format + options at rest, `Button` disabled until a file is chosen |
| Refused — size limit | Fires the instant a file is chosen, **before any parsing or upload** — `Alert variant="destructive"` under the file control: "This file is 12.4 MB. The import limit is 4 MB — split it into smaller files and try again." The file input clears itself; the `Button` never becomes enabled for this file. This is a distinct state from "failed after trying," because the story requires the refusal to happen before parsing starts. **The limit is 4 MB, not the 5 MB this design originally stated** — 5 MB sits above Vercel's 4.5 MB serverless body cap, where the rejection is the platform's, opaque and non-JSON, so the owner would have seen a JSON-parse error instead of this message (`s05` review pass 3, MAJOR 5). Never hardcode the number in copy: it derives from `MAX_IMPORT_LABEL`, which derives from `MAX_IMPORT_BYTES`. **What is measured is the request envelope, not `file.size`** — CSV quoting escapes on the wire, so the body is strictly larger than the file |
| Refused — permission | Applies to the whole Import tab, not a per-file check — the caller either can or cannot write to the site being viewed. Replace the tab's form entirely with `Alert variant="destructive"`: "You need edit access on this site to import content. Ask a site admin to grant it." No form renders underneath; there is nothing to refuse per-field once the tab itself is refused |
| Loading | `Button` spinner + "Importing…"; the outcome-report area shows `Skeleton` rows in the report's own shape (a header row + a few placeholder rows), signalling that a report — not a blank wait — is coming |
| Error (total failure) | `Alert variant="destructive"` — "Import failed — 0 of 400 rows applied." Full outcome table still renders below, since even a total failure is still row-by-row information the owner needs, not just a red banner |
| Success (all rows applied) | `Alert variant="success"` — "Import complete — 400 rows created." Outcome table optional/collapsed by default since every row is the same outcome; a "View all 400 rows" disclosure remains available |
| **Partial success** (the interesting one) | See below |

### Partial success — the heart of this design

Framed by the brief's own example: **394 created, 3 updated, 0 skipped, 3 failed, out
of 400.** The design goal is that this reads as *"basically fine, three things to look
at,"* not as an incident.

Structure, top to bottom:

1. **Summary `Alert variant="warning"`** — not `destructive`. A 3-in-400 failure rate
   is not the same signal as a total failure, and colour has to say so: "Import
   complete with 3 rows that need attention. 397 rows applied successfully (394
   created, 3 updated)."
2. **Four `Metric` tiles** in a row — Created / Updated / Skipped / Failed, each a
   `.text-metric .tabular` number with its `StatusBadge` tone as a small leading dot
   or icon tile, so the shape of the outcome is visible before reading a single row.
3. **The outcome table**, default-filtered to the rows that need a human — updated,
   skipped and failed (6 rows in this example) — with a plain `Button variant="ghost"`
   disclosure above it: **"394 created rows hidden — show all 400."** Clicking it
   reveals the full list. This is the direct answer to "make a 3-in-400 result
   readable at a glance": nobody has to scroll past 394 identical green rows to find
   the three that matter.
4. **Table columns**: `Row` (its position in the source file, `.tabular`), `Element`
   (the selector/id, `font-mono` — a machine string per the type rules), `Outcome`
   (`StatusBadge`), `Detail` (muted text — the reason for a failure, or the previous
   value for an update, rendered through `ContentValue`).
5. **Failure reasons are specific, not generic** — "Missing selector: row cannot be
   matched to an element," "Content exceeds the 10,000-character limit," "Element id
   not found and 'create missing elements' is off" — each tells the owner what to fix
   without opening a support ticket.
6. **Reassurance line**, quiet `text-sm text-muted-foreground` beneath the table, not
   another `Alert` (this is a permanent fact about the system, not feedback on this
   one action): "Every applied row is saved to version history like a normal edit —
   review or revert any of them from the History tab below."

A malformed row failing alone, without the batch aborting, is exactly what this layout
is built to make legible: the 397 good rows are never blocked by, or visually
conflated with, the 3 bad ones.

## Design system gaps

Recorded, not invented around.

1. **No file-upload/dropzone primitive.** The design keeps the native
   `<input type="file">` styled the same way `BulkOperations.tsx` already does today
   (a bordered control matching `Input`), rather than inventing a drag-and-drop
   component. If a future story wants a real dropzone, that is new design-system work,
   not something this screen should freelance.
2. **No table primitive.** The per-row outcome report is composed from a semantic
   `<table>` styled with existing tokens only (`border-border`, `bg-surface-1` row
   striping, `.tabular` for the row index, `font-mono` for element ids) — no new
   component is introduced. Flagging this because it is the second place in the
   product (after version history / operation lists) that wants tabular rows with a
   status column; if a third screen needs the same shape, promoting this to a shared
   `Table` primitive is worth considering then, not now.
3. **No disclosure/accordion primitive** was needed — "show all rows" is a plain
   `Button variant="ghost"` toggling local state, which the existing component set
   already supports. Recorded only to confirm it was checked, not skipped.

Everything else — tabs, alerts, badges, metrics, empty states, cards — is composed
directly from `docs/design-system.md` with no additions.
