/**
 * AI blog posts are drafts. A person publishes them (s89, ADR 057).
 *
 * Until s89 the daily cron inserted the model's post with `status:
 * "published"` and `published_at: now()` — no human anywhere between OpenAI and
 * the public page — while the PRD said "it drafts, a human publishes"
 * (docs/prd.md:320-322). Every AI-written row now comes from `buildDraftRow`,
 * which builds the row field by field: `status` and `published_at` are
 * literals, and nothing from a request body or the model's output is spread
 * into it. Do not "simplify" that into `{ ...input }`: a body or a model answer
 * carrying `status: "published"` would publish itself. Only
 * POST /api/admin/blog/posts/[id] sets `published`.
 *
 * The daily run is idempotent per UTC day. Vercel can deliver one scheduled run
 * twice, and the model call is billed every time, so the day's row is looked up
 * BEFORE the model is called, and `blog_posts.generated_on` is unique
 * (20261009150000) so two deliveries racing through the ~30 s call cannot both
 * insert: the loser gets 23505 and returns the winner.
 *
 * The `db` passed in is the service-role client. The cron has no session (it
 * would run as `anon`), and an owner allow-listed by ADMIN_EMAILS is invisible
 * to RLS, so both write here only after their route's own checks (ADR 057).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generatePostMarkdown,
  type GeneratePost,
} from "@/lib/blog/generate-post";
import {
  keywordsForCategory,
  pickTopic,
  type BlogTopic,
} from "@/lib/blog/topics";

/** Columns every blog route returns for a post. Never `*`: no surprise fields. */
export const BLOG_POST_SUMMARY_COLUMNS =
  "id, title, slug, category, status, excerpt, generated_on, published_at, created_at";

export type BlogPostStatus = "draft" | "published" | "archived";

export interface BlogPostSummary {
  id: string;
  title: string;
  slug: string;
  category: string;
  status: BlogPostStatus;
  excerpt: string | null;
  generated_on: string | null;
  published_at: string | null;
  created_at: string | null;
}

export interface DraftRow {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  status: "draft";
  published_at: null;
  generated_on: string | null;
}

export interface DraftSource extends BlogTopic {
  /** The UTC day for the daily cron's row; null for any other draft. */
  generatedOn: string | null;
}

export interface DailyDraftResult {
  /** False when the day's row already existed — this run wrote nothing. */
  created: boolean;
  draft: BlogPostSummary;
}

const UNIQUE_VIOLATION = "23505";
const EXCERPT_MAX_LENGTH = 200;
const EXCERPT_MIN_PARAGRAPH_LENGTH = 50;
const FALLBACK_SLUG = "post";

/** `YYYY-MM-DD` of `now` in UTC — the cron's idempotency key. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/** The first paragraph that is prose, not a heading, cut at 200 characters. */
function excerptOf(markdown: string): string {
  for (const paragraph of markdown.split("\n\n")) {
    if (
      paragraph.trim() &&
      !paragraph.startsWith("#") &&
      paragraph.length > EXCERPT_MIN_PARAGRAPH_LENGTH
    ) {
      return paragraph.trim().substring(0, EXCERPT_MAX_LENGTH) + "...";
    }
  }
  return "";
}

/**
 * The row for an AI-written post. Always a draft with no publication date:
 * the model's markdown is the body and nothing else.
 */
export function buildDraftRow(markdown: string, source: DraftSource): DraftRow {
  if (!markdown.trim()) {
    throw new Error("The model returned no content");
  }

  const heading = markdown.match(/^#\s+(.+)/m);
  const title = heading ? heading[1].trim() : source.topic;

  return {
    title,
    slug: slugify(title) || slugify(source.topic) || FALLBACK_SLUG,
    content: markdown,
    excerpt: excerptOf(markdown),
    category: source.category,
    status: "draft",
    published_at: null,
    generated_on: source.generatedOn,
  };
}

async function findDailyDraft(
  db: SupabaseClient,
  day: string,
): Promise<BlogPostSummary | null> {
  const { data, error } = await db
    .from("blog_posts")
    .select(BLOG_POST_SUMMARY_COLUMNS)
    .eq("generated_on", day)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read the day's blog draft: ${error.message}`);
  }
  return (data as BlogPostSummary | null) ?? null;
}

function insertDraft(db: SupabaseClient, row: DraftRow) {
  return db
    .from("blog_posts")
    .insert(row)
    .select(BLOG_POST_SUMMARY_COLUMNS)
    .single();
}

/**
 * Inserts the draft. A unique violation is either the day's key (another run
 * won: return its row) or the slug (an earlier post has this title: append the
 * day and try once more).
 */
async function writeDraft(
  db: SupabaseClient,
  row: DraftRow,
  day: string,
): Promise<DailyDraftResult> {
  const first = await insertDraft(db, row);
  if (!first.error) {
    return { created: true, draft: first.data as BlogPostSummary };
  }
  if (first.error.code !== UNIQUE_VIOLATION) {
    throw new Error(`Failed to save the blog draft: ${first.error.message}`);
  }

  if (row.generated_on) {
    const winner = await findDailyDraft(db, row.generated_on);
    if (winner) return { created: false, draft: winner };
  }

  const retry = await insertDraft(db, { ...row, slug: `${row.slug}-${day}` });
  if (!retry.error) {
    return { created: true, draft: retry.data as BlogPostSummary };
  }

  // A daily delivery can lose twice for two different keys: first to an old
  // post holding the plain slug, then to another delivery that inserts today's
  // row after the re-read above but before this dated-slug retry. The second
  // 23505 is therefore another legitimate day-key race, not a terminal write
  // failure. Re-read once more and return the winner (s89 plan, task 2).
  if (row.generated_on && retry.error.code === UNIQUE_VIOLATION) {
    const winner = await findDailyDraft(db, row.generated_on);
    if (winner) return { created: false, draft: winner };
  }

  throw new Error(`Failed to save the blog draft: ${retry.error.message}`);
}

export interface DailyDraftOptions {
  db: SupabaseClient;
  now: Date;
  generate?: GeneratePost;
  random?: () => number;
}

/** The daily cron's draft: one per UTC day, the model called at most once. */
export async function createDailyDraft({
  db,
  now,
  generate = generatePostMarkdown,
  random = Math.random,
}: DailyDraftOptions): Promise<DailyDraftResult> {
  const day = utcDay(now);

  // Before the model call, not after: a duplicate delivery must not pay
  // OpenAI for a post it would then throw away.
  const existing = await findDailyDraft(db, day);
  if (existing) return { created: false, draft: existing };

  const subject = pickTopic(random);
  const markdown = await generate({
    ...subject,
    keywords: keywordsForCategory(subject.category),
  });

  return writeDraft(
    db,
    buildDraftRow(markdown, { ...subject, generatedOn: day }),
    day,
  );
}

export interface OnDemandDraftOptions {
  db: SupabaseClient;
  now: Date;
  /** A topic and its category; a random listed topic when absent. */
  subject?: BlogTopic;
  keywords?: string;
  generate?: GeneratePost;
  random?: () => number;
}

/** An admin's on-demand draft: not keyed by day, still never published. */
export async function createOnDemandDraft({
  db,
  now,
  subject,
  keywords,
  generate = generatePostMarkdown,
  random = Math.random,
}: OnDemandDraftOptions): Promise<BlogPostSummary> {
  const chosen = subject ?? pickTopic(random);
  const markdown = await generate({
    topic: chosen.topic,
    category: chosen.category,
    keywords: keywords ?? keywordsForCategory(chosen.category),
  });

  const { draft } = await writeDraft(
    db,
    buildDraftRow(markdown, { ...chosen, generatedOn: null }),
    utcDay(now),
  );
  return draft;
}
