-- s70a: delete the content rows the embed recorded from its own UI.
--
-- THE INCIDENT. The embed's discovery scans the whole document and skips only
-- the roots `shouldSkipElement` names. Until s70a three of the embed's own
-- surfaces were not among them: the Edit Board panel (the skip list named
-- `#rcf-edit-board`, an id no element has; the panel is
-- `#rcf-edit-board-panel`), the AI suggestions modal and the form-field popover
-- (no marker at all). The editor bar (`#rcf-editor-banner`) was in the same
-- state until it gained `data-rcf-ignore` on 2026-09-19. Every label on those
-- surfaces was POSTed to /api/content/<site> as the customer's authored copy and
-- upserted with `ignoreDuplicates`, so each junk row, once written, stayed. The
-- owner found "🪄" and "Failed to generate suggestions. Please try again." on
-- the Content page (production, 2026-10-08). Worse, the Edit Board's History
-- tab rendered "by <editor email>", and content rows are public:
-- GET /api/published/<site> serves them to anyone with the site id (ADR 046).
-- The embed fix is in public/embed/recopyfast.src.js (shouldSkipElement); this
-- removes what it left behind. docs/research/s70-content-changes.md, fact 1.
--
-- WHAT IS DELETED. Rows whose selector is the shape of an embed root and,
-- where the selector alone is ambiguous, whose text is the embed's own label:
--   - `#rcf-…`: the Edit Board, the editor bar, the staging bar. No customer
--     element carries an `rcf-` id; generateSelector stops at the first id;
--   - `div… > div > …` with one of the AI modal's fixed strings, its footer
--     "Close", and the popover's five labels at their exact positions. "Close",
--     "Save", "Cancel" and "Placeholder" are real copy on many sites, so they
--     are matched only with the root's selector shape, never by text alone.
--
-- WHAT IS NEVER DELETED. A row anyone touched (`untouched` below: no draft, live
-- text still the discovered text, never published, no staged attributes), even
-- when its selector is the embed's: an owner may have clicked an embed label
-- in edit mode and saved it. And the AI modal's suggestion paragraphs: their
-- text is arbitrary and their shape is common, so the read-only count lists
-- them (`ai_list_shape`) for the owner to review; they are not deleted here.
--
-- It reaches production only after the owner has run the same CTE read-only
-- (will_delete, embed_ui_but_edited_kept, review_not_deleted per domain; the
-- query is in docs/plans/s70a-embed-ui-not-content.md) and approved the delete.
--
-- WHAT IT LEAVES BEHIND: NOTHING. The BEFORE DELETE history trigger
-- (20260809130000) writes a 'delete' row to content_history, and the same
-- statement's ON DELETE CASCADE erases it: all four foreign keys into
-- content_elements (content_history, staging_history, ab_test_variants,
-- content_editing_sessions) cascade. No audit row of this cleanup survives,
-- and every history row of a deleted junk row goes with it.
--
-- WHAT BOUNDS THE PUBLIC COPY: THE CDN LIFETIME. The AFTER DELETE statement
-- trigger rotates each affected site's public_content_revision
-- (20261005000000), but nothing that serves copy reads that revision
-- (ADR 046, "s62's fate"). GET /api/published/<site> is cached at our edge
-- and served at most 60 seconds after it was read from the database
-- (ADR 046, "Freshness and retraction"), so a deleted row stops being served
-- there within 60 s of the commit; a host's own HTML caching adds to that.
--
-- One statement, no BEGIN/COMMIT: the migration runner wraps the file, and
-- src/__tests__/db/embed-ui-rows-cleanup.test.ts executes it inside a
-- transaction it rolls back. Re-running it deletes nothing new.

-- certain: deleted. guard: never a row anyone touched.
WITH c AS (
  SELECT ce.id,
    ce.staging_content IS NULL
      AND ce.published_content IS NOT DISTINCT FROM ce.original_content
      AND ce.published_at IS NULL
      AND NOT (COALESCE(ce.metadata, '{}'::jsonb) ? 'staging_attributes') AS untouched,
    (
      ce.selector LIKE '#rcf-%'                       -- Edit Board, editor bar, staging bar
      OR (ce.selector ~ '^div(:nth-child\(\d+\))? > div > '
          AND ce.original_content IN ('🪄', 'Generate Suggestions', 'AI Content Suggestions',
            'Optimization Goal', 'Failed to generate suggestions. Please try again.',
            'Error connecting to AI service. Please check your connection.',
            '⚠️ Please enter some text first.', '✓ Use This', 'Generating...', '🔄'))
      OR (ce.selector ~ '^div(:nth-child\(\d+\))? > div > div:nth-child\(5\) > button$'
          AND ce.original_content = 'Close')       -- the AI modal's footer
      OR (ce.selector ~ '^div(:nth-child\(\d+\))? > (p:nth-child\(1\)|label:nth-child\([24]\)|div:nth-child\(6\) > button:nth-child\([12]\))$'
          AND ce.original_content IN ('Edit Form Field', 'Placeholder', 'Default Value', 'Cancel', 'Save'))
    ) AS embed_ui,
    ce.selector ~ '^div(:nth-child\(\d+\))? > div > div:nth-child\(4\) > (div(:nth-child\(\d+\))? > )?(p|button)$'
      AS ai_list_shape                                 -- review tier: AI suggestions, server errors
  FROM public.content_elements ce
)
DELETE FROM public.content_elements
WHERE id IN (SELECT id FROM c WHERE embed_ui AND untouched);
