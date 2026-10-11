-- ========================================
-- s89-blog-drafts-only — one cron blog draft per UTC day
-- ========================================
-- The daily Vercel cron (`vercel.json`, `/api/cron/generate-blog-post`) asks
-- OpenAI for a post and stores it as a DRAFT for a human to publish (ADR 057).
-- Vercel delivers a cron at least once and occasionally twice for the same
-- scheduled run ("Cron job delivery and idempotency" in Vercel's docs). The job
-- checks for today's draft before calling the model, but that check alone is
-- racy: two deliveries spend ~30 s in the model call, both having seen "no
-- draft yet", and both insert. So the database holds the key.
--
-- `generated_on` is the UTC day a cron run drafted the row for. It is NULL for
-- everything else — on-demand drafts from POST /api/blog/generate and every row
-- written before this migration. A unique index treats NULLs as distinct
-- (PostgreSQL's default, and the only mode in PG 14), so it constrains cron
-- rows to one per day and leaves the rest alone. The losing insert gets 23505,
-- and src/lib/blog/drafts.ts answers with the row that won.
--
-- No new table, so no new RLS: blog_posts already has RLS on, anon/authenticated
-- read only published rows (20260818000000, "Published blog posts are public"),
-- and the cron and the platform admin write through the service role after the
-- route's own checks (ADR 057).
--
-- Additive only: the code deployed before this file neither reads nor writes
-- the column, so apply this first, then deploy (docs/operations/blog.md).
-- IF NOT EXISTS on both statements so a retry after an uncertain connection
-- result converges.

ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS generated_on DATE;

COMMENT ON COLUMN public.blog_posts.generated_on IS
  'UTC day the daily blog cron drafted this row for; NULL for any other row. Unique: one cron draft per day (s89, ADR 057).';

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_generated_on_key
  ON public.blog_posts (generated_on);
