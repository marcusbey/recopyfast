# ADR 009 — Impression-history change markers join `content_history`, not `content_versions` or `staging_history`

- Status: accepted
- Date: 2026-08-16
- Scope: story (`s10-impression-history`), travels with `feature/s10-impression-history`

## Context

`s10-impression-history` AC 2 requires the impression timeline to mark "points at which that
section's content changed, sourced from existing version history." The story's own agentic
notes point at `src/app/api/edit-board/history/route.ts` and `VersionHistoryPanel.tsx` — both
real and both live. But `docs/research/s10-impression-history.md` ("The join-target trap")
checked what those actually read from, `content_versions`, against the schema and found it is
populated only by an explicit "Save Current Version" button click
(`recopyfast.src.js:5963-5982`) or by the style-apply flow `s04` is removing. **Ordinary inline
edits and publishes never write to it.**

Two other tables record content changes automatically, with no user action beyond a normal
edit:

- **`content_history`** (`supabase/migrations/20250817000000_complete_database_setup.sql:42-49`,
  trigger fixed in `20260809130000_content_history_definer_and_delete_split.sql`) — one row per
  `content_elements` row change, written by an `AFTER INSERT OR UPDATE` / `BEFORE DELETE` trigger
  keyed on `OLD.current_content IS DISTINCT FROM NEW.current_content`. Fires on **every** publish,
  because `publish_staging_content_atomic` updates `content_elements.current_content`
  (`20260803020000_restore_atomic_publish.sql:79-90`).
- **`staging_history`** (`supabase/migrations/20251230000000_staging_workflow.sql:77-93`) — one
  row per staging→publish transition specifically, written inside the same publish function's
  CTE, not by trigger.

Neither carries `site_id` or `element_id` (text) directly — both key on `content_elements.id`
(UUID) and need a join through `content_elements` to reach the identity impressions use. This
was true for all three candidates and did not decide between them.

The choice matters to the product, not just the schema: it decides whether a marketer sees a
marker for **every edit that ever went live**, or only for the rare manual snapshot.

## Decision

**Join against `content_history`.** The read API resolves `content_elements.id` for the
requested `(site_id, element_id)`, then reads `content_history` rows for that id within the
requested window, and returns their `created_at` as change markers.

`content_history` fires on every change to `content_elements.current_content` — which is the
field the public embed serves and the field impressions are measured against — including
ordinary inline edits and publishes. It requires no extra user action, so a marketer who edits a
headline and nothing else still sees a marker. It does not require the manual "Save Current
Version" step `content_versions` depends on.

## Considered options

- **`content_versions`** — rejected. Populated only by an explicit "Save Current Version" click
  or the style-apply flow `s04` deletes. Following the story's literal words ("join against
  `/api/edit-board/history`") would satisfy AC 2 in letter while leaving the timeline blank for
  the actual user flow the story exists for — editing, then wondering whether it did anything.
- **`staging_history`** — rejected, but closer. It is publish-specific and trigger-adjacent
  (written inside `publish_staging_content_atomic`'s CTE), so it would also catch every real
  publish. It was set aside in favor of `content_history` because it is scoped to the
  staging→publish workflow specifically; `content_history`'s trigger condition
  (`current_content` actually changed) is a direct, mechanism-independent statement of "this is
  what went live," and does not need to be revisited if a future write path changes
  `current_content` without going through staging.
- **Union of `content_history` and `content_versions`** — rejected as unnecessary complexity.
  Every `content_versions` row that reflects a real content change already produces (or will
  already have produced) a corresponding `content_history` row through the same publish path;
  the manual-snapshot-only rows `content_versions` adds beyond that are not "the content
  changed," they are "someone clicked a different button," which is not what AC 2 asks the
  timeline to mark.

## Consequences

**Easier.** One join, no second edit timeline recorded (the story's own instruction). The
marker set is complete for the flow the story is written for.

**Harder.** `content_history.changed_by` is `auth.users(id)`, populated via `auth.uid()` inside
a `SECURITY DEFINER` trigger. Non-account editors (staging-token sessions — the product's
primary editing path per `AGENTS.md`) are not Supabase-authenticated, so `auth.uid()` is `NULL`
for the majority of edits. This ADR's read only uses `created_at`; if a later story wants "who
changed it" on this timeline, that attribution is unreliable today and is out of scope here.

**Watch.** If `s04` or a later story changes how `current_content` updates are written (a new
write path that bypasses `publish_staging_content_atomic`), confirm the `content_history`
trigger still fires before relying on it — the guarantee this ADR leans on is the trigger
condition, not the specific function.
