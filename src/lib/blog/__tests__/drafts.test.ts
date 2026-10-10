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
import { type SchemaStrictDatabase } from "@/__tests__/helpers/schema-strict-supabase";
import { createBlogGenerationDatabase } from "@/__tests__/helpers/blog-generation-database";
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
  db = createBlogGenerationDatabase();
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

  it("lets one overlapping delivery call the model and returns its draft to the follower", async () => {
    let releaseGeneration!: () => void;
    let announceGeneration!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      announceGeneration = resolve;
    });
    const generationMayFinish = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generate = jest.fn(async () => {
      announceGeneration();
      await generationMayFinish;
      return PLAIN;
    });

    const owner = createDailyDraft({ db: client(), now: DELIVERY, generate });
    await generationStarted;
    const follower = createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
      followerWaitMs: 1,
      followerPollMs: 1,
      wait: async () => {
        releaseGeneration();
        await owner;
      },
    });
    const results = await Promise.all([owner, follower]);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.created).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0].draft.id).toBe(results[1].draft.id);
    expect(db.rows("blog_posts")).toHaveLength(1);
  });

  it("bounds a pending follower and never steals the claim or calls the model", async () => {
    db.seed("blog_generation_claims", [
      {
        generated_on: "2026-10-09",
        status: "pending",
        owner_token: "a017ff51-15da-4f43-91ff-0d51a9830739",
        post_id: null,
        created_at: "2026-10-09T14:00:00Z",
        updated_at: "2026-10-09T14:00:00Z",
        completed_at: null,
      },
    ]);
    const generate = generator();
    const wait = jest.fn(async () => undefined);

    await expect(
      createDailyDraft({
        db: client(),
        now: DELIVERY,
        generate,
        wait,
        followerWaitMs: 2,
        followerPollMs: 1,
      }),
    ).rejects.toThrow("operator recovery");

    expect(wait).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
    expect(db.rows("blog_generation_claims")).toEqual([
      expect.objectContaining({
        status: "pending",
        owner_token: "a017ff51-15da-4f43-91ff-0d51a9830739",
      }),
    ]);
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it("bounds a follower even when its database read never settles", async () => {
    jest.useFakeTimers();
    try {
      const generate = generator();
      const hanging = {
        rpc: jest.fn().mockResolvedValue({
          data: [
            { outcome: "existing", claim_status: "pending", post_id: null },
          ],
          error: null,
        }),
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: () => new Promise(() => {}) }),
          }),
        }),
      } as unknown as SupabaseClient;
      let outcome = "pending";
      void createDailyDraft({
        db: hanging,
        now: DELIVERY,
        generate,
        followerWaitMs: 10,
        followerPollMs: 1,
      }).then(
        () => {
          outcome = "resolved";
        },
        () => {
          outcome = "rejected";
        },
      );
      await jest.advanceTimersByTimeAsync(11);
      expect(outcome).toBe("rejected");
      expect(generate).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("reuses a daily row created before the claim ledger existed", async () => {
    db.seed("blog_posts", [
      {
        id: "legacy-daily-draft",
        title: "Legacy daily draft",
        slug: "legacy-daily-draft",
        content: "Body",
        category: "business",
        status: "draft",
        generated_on: "2026-10-09",
      },
    ]);
    const generate = generator();

    const result = await createDailyDraft({
      db: client(),
      now: DELIVERY,
      generate,
    });

    expect(result.created).toBe(false);
    expect(result.draft.id).toBe("legacy-daily-draft");
    expect(generate).not.toHaveBeenCalled();
    expect(db.rows("blog_posts")).toHaveLength(1);
    expect(db.rows("blog_generation_claims")).toEqual([
      expect.objectContaining({
        generated_on: "2026-10-09",
        status: "succeeded",
        post_id: "legacy-daily-draft",
      }),
    ]);
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

  it("reuses a committed draft after the completion response is lost", async () => {
    const healthy = client();
    const rpc = healthy.rpc.bind(healthy);
    const lossy = {
      from: healthy.from.bind(healthy),
      rpc: async (name: string, args: Record<string, unknown>) => {
        const result = await rpc(name, args);
        return name === "complete_daily_blog_generation"
          ? {
              data: null,
              error: { message: "synthetic lost completion response" },
            }
          : result;
      },
    } as unknown as SupabaseClient;
    const generate = generator();
    await expect(
      createDailyDraft({ db: lossy, now: DELIVERY, generate }),
    ).rejects.toThrow("lost completion response");
    expect(db.rows("blog_posts")).toHaveLength(1);
    expect(db.rows("blog_generation_claims")[0]).toMatchObject({
      status: "succeeded",
      post_id: db.rows("blog_posts")[0].id,
    });
    const retry = await createDailyDraft({
      db: healthy,
      now: SAME_DAY_RETRY,
      generate,
    });
    expect(retry.created).toBe(false);
    expect(retry.draft.id).toBe(db.rows("blog_posts")[0].id);
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
    expect(db.rows("blog_generation_claims")).toEqual([
      expect.objectContaining({
        generated_on: "2026-10-09",
        status: "failed",
        post_id: null,
      }),
    ]);

    const retryGenerate = generator();
    await expect(
      createDailyDraft({
        db: client(),
        now: SAME_DAY_RETRY,
        generate: retryGenerate,
        followerWaitMs: 0,
      }),
    ).rejects.toThrow("operator recovery");
    expect(retryGenerate).not.toHaveBeenCalled();
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

  it("keeps paid output after the plain, dated, and one UUID slug all collide", async () => {
    const firstSuffix = "11111111-1111-4111-8111-111111111111";
    const secondSuffix = "22222222-2222-4222-8222-222222222222";
    db.seed("blog_posts", [
      {
        ...buildDraftRow(PLAIN, {
          topic: "Existing plain",
          category: "development",
          generatedOn: null,
        }),
      },
      {
        ...buildDraftRow(PLAIN, {
          topic: "Existing dated",
          category: "development",
          generatedOn: null,
        }),
        slug: `${SLUG}-2026-10-09`,
      },
      {
        ...buildDraftRow(PLAIN, {
          topic: "Existing UUID",
          category: "development",
          generatedOn: null,
        }),
        slug: `${SLUG}-${firstSuffix}`,
      },
    ]);
    const suffixes = [firstSuffix, secondSuffix][Symbol.iterator]();
    const generate = generator();

    const result = await createOnDemandDraft({
      db: client(),
      now: DELIVERY,
      subject: { topic: "Paid topic", category: "development" },
      generate,
      slugSuffix: () => suffixes.next().value!,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.slug).toBe(`${SLUG}-${secondSuffix}`);
    expect(db.rows("blog_posts")).toHaveLength(4);
    expect(db.rows("blog_posts").at(-1)).toMatchObject({
      id: result.id,
      slug: result.slug,
      content: PLAIN,
    });
  });

  it("bounds UUID retries without regenerating or returning an existing draft", async () => {
    const occupiedSuffix = "11111111-1111-4111-8111-111111111111";
    const existing = [
      {
        ...buildDraftRow(PLAIN, {
          topic: "Existing plain",
          category: "development",
          generatedOn: null,
        }),
      },
      {
        ...buildDraftRow(PLAIN, {
          topic: "Existing dated",
          category: "development",
          generatedOn: null,
        }),
        slug: `${SLUG}-2026-10-09`,
      },
      {
        ...buildDraftRow(PLAIN, {
          topic: "Existing UUID",
          category: "development",
          generatedOn: null,
        }),
        slug: `${SLUG}-${occupiedSuffix}`,
      },
    ];
    db.seed("blog_posts", existing);
    const generate = generator();

    await expect(
      createOnDemandDraft({
        db: client(),
        now: DELIVERY,
        subject: { topic: "Paid topic", category: "development" },
        generate,
        slugSuffix: () => occupiedSuffix,
      }),
    ).rejects.toThrow("duplicate key value");

    expect(generate).toHaveBeenCalledTimes(1);
    expect(db.rows("blog_posts")).toHaveLength(existing.length);
    expect(
      db
        .queriesOn("blog_posts")
        .filter((query) => query.operation === "insert"),
    ).toHaveLength(6);
  });

  it("gives concurrent same-title drafts distinct slugs without regenerating", async () => {
    const generate = generator();
    const suffixes = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];

    const drafts = await Promise.all(
      suffixes.map((suffix) =>
        createOnDemandDraft({
          db: client(),
          now: DELIVERY,
          subject: { topic: "Concurrent topic", category: "development" },
          generate,
          slugSuffix: () => suffix,
        }),
      ),
    );

    expect(generate).toHaveBeenCalledTimes(3);
    expect(new Set(drafts.map((draft) => draft.id))).toHaveProperty("size", 3);
    expect(new Set(drafts.map((draft) => draft.slug))).toHaveProperty(
      "size",
      3,
    );
    expect(drafts.map((draft) => draft.slug)).toEqual([
      SLUG,
      `${SLUG}-2026-10-09`,
      `${SLUG}-${suffixes[2]}`,
    ]);
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
