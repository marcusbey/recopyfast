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
 * twice, and the model call is billed every time. ADR 057 originally relied on
 * a pre-read plus `blog_posts.generated_on`; the independent review proved both
 * overlapping calls still reached OpenAI before one lost the insert. ADR 060
 * moves ownership before the provider call: `blog_generation_claims` has one
 * durable owner token per day, and only that owner generates. Followers wait a
 * bounded interval for the atomic draft/claim completion and never generate.
 *
 * The `db` passed in is the service-role client. The cron has no session (it
 * would run as `anon`), and an owner allow-listed by ADMIN_EMAILS is invisible
 * to RLS, so both write here only after their route's own checks (ADR 057).
 */

import { randomUUID } from "node:crypto";
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
const DAILY_CLAIM_COLUMNS = "status, post_id";
const DAILY_CLAIM_RPC = "claim_daily_blog_generation";
const DAILY_COMPLETE_RPC = "complete_daily_blog_generation";
const DAILY_FAIL_RPC = "fail_daily_blog_generation";

/** OpenAI is bounded at 30 s; give its winning request a small commit margin. */
export const DAILY_DRAFT_FOLLOWER_WAIT_MS = 35_000;
export const DAILY_DRAFT_FOLLOWER_POLL_MS = 250;

type DailyClaimStatus = "pending" | "succeeded" | "failed";

interface DailyClaimRow {
  status: DailyClaimStatus;
  post_id: string | null;
}

interface DailyClaimRpcRow extends DailyClaimRow {
  outcome: "acquired" | "existing";
  claim_status: DailyClaimStatus;
}

interface CompletedDraftRpcRow extends BlogPostSummary {
  created: boolean;
}

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
  /** Deterministic seams for concurrency/timeout tests; production omits them. */
  ownerToken?: string;
  wait?: (milliseconds: number) => Promise<void>;
  followerWaitMs?: number;
  followerPollMs?: number;
}

function oneRpcRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length === 1 ? (data[0] as T) : null;
}

function isClaimStatus(value: unknown): value is DailyClaimStatus {
  return value === "pending" || value === "succeeded" || value === "failed";
}

async function acquireDailyClaim(
  db: SupabaseClient,
  day: string,
  ownerToken: string,
): Promise<DailyClaimRpcRow> {
  const { data, error } = await db.rpc(DAILY_CLAIM_RPC, {
    p_generated_on: day,
    p_owner_token: ownerToken,
  });
  if (error) {
    throw new Error(`Failed to claim daily blog generation: ${error.message}`);
  }

  const row = oneRpcRow<DailyClaimRpcRow>(data);
  if (
    !row ||
    (row.outcome !== "acquired" && row.outcome !== "existing") ||
    !isClaimStatus(row.claim_status) ||
    (row.post_id !== null && typeof row.post_id !== "string")
  ) {
    throw new Error("Daily blog claim returned an invalid result");
  }
  return { ...row, status: row.claim_status };
}

async function readClaim(
  db: SupabaseClient,
  day: string,
): Promise<DailyClaimRow> {
  const { data, error } = await db
    .from("blog_generation_claims")
    .select(DAILY_CLAIM_COLUMNS)
    .eq("generated_on", day)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to read daily blog claim: ${error.message}`);

  const row = data as Partial<DailyClaimRow> | null;
  if (
    !row ||
    !isClaimStatus(row.status) ||
    (row.post_id !== null &&
      row.post_id !== undefined &&
      typeof row.post_id !== "string")
  ) {
    throw new Error(
      "Daily blog claim is unavailable; operator recovery is required",
    );
  }
  return { status: row.status, post_id: row.post_id ?? null };
}

async function findDraftById(
  db: SupabaseClient,
  postId: string,
): Promise<BlogPostSummary> {
  const { data, error } = await db
    .from("blog_posts")
    .select(BLOG_POST_SUMMARY_COLUMNS)
    .eq("id", postId)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to read the daily blog draft: ${error.message}`);
  if (!data) {
    throw new Error(
      "Daily blog claim has no draft; operator recovery is required",
    );
  }
  return data as BlogPostSummary;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForClaimedDraft(
  db: SupabaseClient,
  day: string,
  initial: DailyClaimRow,
  wait: (milliseconds: number) => Promise<void>,
  waitMs: number,
  pollMs: number,
): Promise<BlogPostSummary> {
  let remaining = Math.max(0, waitMs);
  const interval = Math.max(1, pollMs);
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const failure = () =>
    new Error(
      "Daily blog generation did not complete; operator recovery is required",
    );

  // Counting only poll sleeps left a follower hung forever inside a stalled
  // database read. The wall-clock deadline covers reads as well as sleeps.
  // A late read is harmless, but must not restart polling after we answered.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(failure());
    }, remaining);
  });
  const poll = async (): Promise<BlogPostSummary> => {
    let claim = initial;
    while (true) {
      if (expired) throw failure();
      if (claim.status === "succeeded" && claim.post_id) {
        return findDraftById(db, claim.post_id);
      }
      if (claim.status === "failed" || remaining === 0) throw failure();
      const delay = Math.min(interval, remaining);
      await wait(delay);
      remaining -= delay;
      if (expired) throw failure();
      claim = await readClaim(db, day);
    }
  };
  try {
    return await Promise.race([poll(), deadline]);
  } finally {
    expired = true;
    clearTimeout(timer!);
  }
}

async function completeDailyClaim(
  db: SupabaseClient,
  day: string,
  ownerToken: string,
  row: DraftRow,
): Promise<DailyDraftResult> {
  const { data, error } = await db.rpc(DAILY_COMPLETE_RPC, {
    p_generated_on: day,
    p_owner_token: ownerToken,
    p_title: row.title,
    p_slug: row.slug,
    p_content: row.content,
    p_excerpt: row.excerpt,
    p_category: row.category,
  });
  if (error) {
    throw new Error(
      `Failed to finalize daily blog generation: ${error.message}`,
    );
  }

  const completed = oneRpcRow<CompletedDraftRpcRow>(data);
  if (
    !completed ||
    typeof completed.created !== "boolean" ||
    typeof completed.id !== "string" ||
    completed.generated_on !== day ||
    completed.status !== "draft"
  ) {
    throw new Error("Daily blog completion returned an invalid result");
  }
  const { created, ...draft } = completed;
  return { created, draft };
}

async function failDailyClaim(
  db: SupabaseClient,
  day: string,
  ownerToken: string,
): Promise<void> {
  const { data, error } = await db.rpc(DAILY_FAIL_RPC, {
    p_generated_on: day,
    p_owner_token: ownerToken,
  });
  if (error) {
    throw new Error(
      `Failed to mark daily blog generation failed: ${error.message}`,
    );
  }
  // False is valid after an ambiguous completion response: the atomic function
  // may already have committed `succeeded`, which must never be changed to failed.
  if (data !== true && data !== false) {
    throw new Error("Daily blog failure RPC returned an invalid result");
  }
}

/** The daily cron's draft: one per UTC day, the model called at most once. */
export async function createDailyDraft({
  db,
  now,
  generate = generatePostMarkdown,
  random = Math.random,
  ownerToken = randomUUID(),
  wait = defaultWait,
  followerWaitMs = DAILY_DRAFT_FOLLOWER_WAIT_MS,
  followerPollMs = DAILY_DRAFT_FOLLOWER_POLL_MS,
}: DailyDraftOptions): Promise<DailyDraftResult> {
  const day = utcDay(now);
  const claim = await acquireDailyClaim(db, day, ownerToken);

  if (claim.outcome !== "acquired") {
    const draft = await waitForClaimedDraft(
      db,
      day,
      claim,
      wait,
      followerWaitMs,
      followerPollMs,
    );
    return { created: false, draft };
  }

  try {
    const subject = pickTopic(random);
    const markdown = await generate({
      ...subject,
      keywords: keywordsForCategory(subject.category),
    });

    return await completeDailyClaim(
      db,
      day,
      ownerToken,
      buildDraftRow(markdown, { ...subject, generatedOn: day }),
    );
  } catch (error) {
    try {
      await failDailyClaim(db, day, ownerToken);
    } catch (claimError) {
      // A request crash between provider failure and this write leaves pending
      // deliberately. Never steal it automatically: the provider may still have
      // charged. The runbook is the only recovery path (ADR 060).
      console.error("Failed to close daily blog generation claim:", claimError);
    }
    throw error;
  }
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
