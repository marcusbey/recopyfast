/**
 * @jest-environment node
 */

/**
 * s89 — an AI blog post is a draft until a person publishes it.
 *
 * Until s89 the daily cron inserted the model's post with `status:
 * "published"` and `published_at: now()` (src/app/api/blog/generate/route.ts:
 * 273-283 on c0c40bf). The PRD says the opposite: "it drafts, a human
 * publishes" (docs/prd.md:320-322). These tests drive the drafts module against
 * the schema-strict double, which knows `blog_posts`' real columns and answers a
 * duplicate `slug` or `generated_on` with 23505, as PostgREST does.
 *
 * Idempotency is per UTC day, because Vercel can deliver one scheduled run twice
 * (docs/research/s89-blog-drafts-only.md, fact 6) and the model call costs money
 * every time it runs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSchemaStrictDatabase,
  type SchemaStrictDatabase,
} from "@/__tests__/helpers/schema-strict-supabase";
import {
  buildDraftRow,
  createDailyDraft,
  createOnDemandDraft,
} from "@/lib/blog/drafts";
import type { PostRequest } from "@/lib/blog/generate-post";
import { CONTENT_TOPICS, keywordsForCategory } from "@/lib/blog/topics";

const TITLE = "Why Founders Should Care About Website Content Velocity";
const SLUG = "why-founders-should-care-about-website-content-velocity";
const FIRST_PARAGRAPH =
  "Founders who ship copy changes weekly learn faster than founders who wait for a developer sprint.";

/** A model answer that tries to publish itself. */
const PUBLISH_SHAPED = [
  "---",
  "status: published",
  "published_at: 2026-10-09T14:00:00Z",
  "---",
  `# ${TITLE}`,
  "",
  FIRST_PARAGRAPH,
  "",
  "## What velocity buys you",
  "",
  "More experiments per quarter.",
].join("\n");

const PLAIN = [`# ${TITLE}`, "", FIRST_PARAGRAPH, "", "## Next"].join("\n");

const DELIVERY = new Date("2026-10-09T14:00:05Z");
const SAME_DAY_RETRY = new Date("2026-10-09T23:59:59Z");
const NEXT_DAY = new Date("2026-10-10T00:00:01Z");

let db: SchemaStrictDatabase;

function client(): SupabaseClient {
  return db.client as unknown as SupabaseClient;
}

function generator(markdown = PLAIN) {
  return jest.fn(async (request: PostRequest) => {
    void request;
    return markdown;
  });
}

beforeEach(() => {
  db = createSchemaStrictDatabase({
    uniqueKeys: { blog_posts: [["slug"], ["generated_on"]] },
  });
});

describe("buildDraftRow", () => {
  it("is a draft with no publication date, whatever the model wrote", () => {
    const row = buildDraftRow(PUBLISH_SHAPED, {
      topic: "Topic",
      category: "business",
      generatedOn: "2026-10-09",
    });

    expect(row.status).toBe("draft");
    expect(row.published_at).toBeNull();
    expect(row.generated_on).toBe("2026-10-09");
    expect(row.content).toBe(PUBLISH_SHAPED);
  });

  it("takes the title from the first heading, and the slug and excerpt as before", () => {
    const row = buildDraftRow(PLAIN, {
      topic: "Topic",
      category: "business",
      generatedOn: null,
    });

    expect(row).toMatchObject({
      title: TITLE,
      slug: SLUG,
      excerpt: `${FIRST_PARAGRAPH}...`,
      category: "business",
      generated_on: null,
    });
  });

  it("falls back to the topic when the model gives no heading", () => {
    const row = buildDraftRow("Just a paragraph, no heading at all here.", {
      topic: "Pricing Website Maintenance Services",
      category: "freelancing",
      generatedOn: null,
    });

    expect(row.title).toBe("Pricing Website Maintenance Services");
    expect(row.slug).toBe("pricing-website-maintenance-services");
  });

  it("refuses an empty model answer", () => {
    expect(() =>
      buildDraftRow("   ", {
        topic: "Topic",
        category: "business",
        generatedOn: null,
      }),
    ).toThrow("no content");
  });
});

describe("createDailyDraft", () => {
  it("writes one draft for the UTC day and says it created it", async () => {
    const generate = generator(PUBLISH_SHAPED);

    const result = await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
      random: () => 0,
    });

    expect(result.created).toBe(true);
    expect(result.draft).toMatchObject({
      title: TITLE,
      slug: SLUG,
      status: "draft",
      published_at: null,
      generated_on: "2026-10-09",
    });
    expect(db.rows("blog_posts")).toEqual([
      expect.objectContaining({
        id: result.draft.id,
        status: "draft",
        published_at: null,
        generated_on: "2026-10-09",
      }),
    ]);
  });

  it("prompts with a listed topic and its category's keywords", async () => {
    const generate = generator();

    await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
      random: () => 0,
    });

    const [first] = CONTENT_TOPICS;
    expect(generate).toHaveBeenCalledWith({
      topic: first.topics[0],
      category: first.category,
      keywords: keywordsForCategory(first.category),
    });
  });

  it("returns the same draft on a second run that day, without calling the model", async () => {
    const generate = generator();

    const first = await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
    });
    const retry = await createDailyDraft({
      db: client(),
      now: SAME_DAY_RETRY,
      generate,
    });

    expect(retry.created).toBe(false);
    expect(retry.draft.id).toBe(first.draft.id);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(db.rows("blog_posts")).toHaveLength(1);
  });

  it("returns the winner when another delivery inserts first", async () => {
    // The other delivery passed the same pre-check and finished its model call
    // first: by the time this run inserts, the day's row exists.
    const generate = jest.fn(async () => {
      db.seed("blog_posts", [
        {
          id: "winner",
          title: "Winner",
          slug: "winner",
          content: "Body",
          category: "business",
          status: "draft",
          generated_on: "2026-10-09",
        },
      ]);
      return PLAIN;
    });

    const result = await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
    });

    expect(result.created).toBe(false);
    expect(result.draft.id).toBe("winner");
    expect(db.rows("blog_posts")).toHaveLength(1);
  });

  it("returns the winner when it loses the day key on the slug retry", async () => {
    // This delivery first loses on an older row's slug. No daily winner is
    // visible on the first re-read, but another delivery inserts today's row
    // before this one retries with the dated slug. The retry's 23505 is the
    // daily key, so this run must re-read and return that winner too.
    const winner = {
      id: "winner",
      title: "Winner",
      slug: "winner",
      category: "business",
      status: "draft" as const,
      excerpt: "Winner excerpt",
      generated_on: "2026-10-09",
      published_at: null,
      created_at: "2026-10-09T14:00:10Z",
    };
    let reads = 0;
    const maybeSingle = jest.fn(async () => {
      reads += 1;
      return reads < 3
        ? { data: null, error: null }
        : { data: winner, error: null };
    });
    const single = jest.fn(async () => ({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    }));
    const racingClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle })),
        })),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({ single })),
        })),
      })),
    } as unknown as SupabaseClient;

    const result = await createDailyDraft({
      db: racingClient,
      now: DELIVERY,
      generate: generator(),
    });

    expect(result).toEqual({ created: false, draft: winner });
    expect(single).toHaveBeenCalledTimes(2);
    expect(maybeSingle).toHaveBeenCalledTimes(3);
  });

  it("drafts again on the next UTC day", async () => {
    const generate = generator();

    await createDailyDraft({ db: client(), now: DELIVERY, generate });
    const tomorrow = await createDailyDraft({
      db: client(),
      now: NEXT_DAY,
      generate,
    });

    expect(tomorrow.created).toBe(true);
    expect(tomorrow.draft.generated_on).toBe("2026-10-10");
    expect(db.rows("blog_posts")).toHaveLength(2);
  });

  it("appends the day to a slug an earlier post already holds", async () => {
    db.seed("blog_posts", [
      {
        id: "earlier",
        title: TITLE,
        slug: SLUG,
        content: "Earlier body",
        category: "business",
        status: "published",
        published_at: "2026-09-01T14:00:00Z",
      },
    ]);

    const result = await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate: generator(),
    });

    expect(result.created).toBe(true);
    expect(result.draft.slug).toBe(`${SLUG}-2026-10-09`);
    expect(db.rows("blog_posts")).toContainEqual(
      expect.objectContaining({
        id: "earlier",
        slug: SLUG,
        status: "published",
      }),
    );
  });

  it("leaves a draft a person already published as it is", async () => {
    const generate = generator();
    const first = await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
    });
    await db.client
      .from("blog_posts")
      .update({ status: "published", published_at: "2026-10-09T15:00:00Z" })
      .eq("id", first.draft.id);

    const retry = await createDailyDraft({
      db: client(),
      now: SAME_DAY_RETRY,
      generate,
    });

    expect(retry).toMatchObject({
      created: false,
      draft: { id: first.draft.id, status: "published" },
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the model call fails", async () => {
    const generate = jest.fn(async () => {
      throw new Error("OpenAI API call failed");
    });

    await expect(
      createDailyDraft({ db: client(), now: DELIVERY, generate }),
    ).rejects.toThrow("OpenAI API call failed");
    expect(db.rows("blog_posts")).toEqual([]);
  });
});

describe("createOnDemandDraft", () => {
  it("writes an undated draft, and a second one the same day too", async () => {
    const generate = generator();

    const first = await createOnDemandDraft({
      db: client(),
      now: DELIVERY,
      subject: {
        topic: "Pricing Website Maintenance Services",
        category: "freelancing",
      },
      generate,
    });
    const second = await createOnDemandDraft({
      db: client(),
      now: DELIVERY,
      subject: { topic: "Another topic", category: "freelancing" },
      generate,
    });

    expect(first).toMatchObject({
      status: "draft",
      published_at: null,
      generated_on: null,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.slug).toBe(`${SLUG}-2026-10-09`);
    expect(generate).toHaveBeenCalledWith({
      topic: "Pricing Website Maintenance Services",
      category: "freelancing",
      keywords: keywordsForCategory("freelancing"),
    });
  });

  it("picks a listed topic when none is given", async () => {
    const generate = generator();

    await createOnDemandDraft({
      db: client(),
      now: DELIVERY,
      generate,
      random: () => 0,
    });

    const [first] = CONTENT_TOPICS;
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: first.topics[0],
        category: first.category,
      }),
    );
  });

  it("uses the caller's keywords when given", async () => {
    const generate = generator();

    await createOnDemandDraft({
      db: client(),
      now: DELIVERY,
      subject: { topic: "Topic", category: "design" },
      keywords: "typography, grids",
      generate,
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "typography, grids" }),
    );
  });
});
