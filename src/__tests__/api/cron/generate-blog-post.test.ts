/**
 * @jest-environment node
 */

/**
 * GET /api/cron/generate-blog-post — the daily blog cron drafts; it never
 * publishes (s89).
 *
 * On c0c40bf this route fetched its own public URL twice and the second call
 * inserted the model's post as `published` (src/app/api/blog/generate/route.ts:
 * 273-283). Here the route runs against the schema-strict double standing in
 * for the service-role client (unique `slug` and `generated_on`, as the
 * migrations declare them) and a stubbed OpenAI. Any other outbound fetch
 * fails the test — the cron no longer calls itself.
 *
 * The model answers with front matter claiming `status: published`, and the
 * URL carries publish-shaped parameters: the row is a draft regardless.
 */

import { NextRequest } from "next/server";
import { type SchemaStrictDatabase } from "@/__tests__/helpers/schema-strict-supabase";
import { createBlogGenerationDatabase } from "@/__tests__/helpers/blog-generation-database";
import { onlyDateFaked } from "@/__tests__/helpers/blog-route-fixtures";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

import { GET } from "@/app/api/cron/generate-blog-post/route";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CRON_SECRET = "cron-secret-for-tests";
const DELIVERY = new Date("2026-10-09T14:00:05Z");

const PUBLISH_SHAPED = [
  "---",
  "status: published",
  "published_at: 2026-10-09T14:00:00Z",
  "---",
  "# Content Velocity For Founders",
  "",
  "Founders who ship copy changes weekly learn faster than founders who wait for a sprint.",
].join("\n");

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

let db: SchemaStrictDatabase;
let fetchMock: jest.SpyInstance;
let modelAnswer: () => Response | Promise<Response>;

function openAiAnswer(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function cronRequest(authorization?: string, query = "") {
  return new NextRequest(
    `https://www.recopyfa.st/api/cron/generate-blog-post${query}`,
    { headers: authorization ? { authorization } : {} },
  );
}

function openAiCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => String(url) === OPENAI_URL)
    .length;
}

const savedEnv = {
  CRON_SECRET: process.env.CRON_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

beforeEach(() => {
  jest.useFakeTimers(onlyDateFaked(DELIVERY));
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.OPENAI_API_KEY = "sk-test";

  db = createBlogGenerationDatabase();
  mockCreateServiceRoleClient.mockReturnValue(
    db.client as unknown as ReturnType<typeof createServiceRoleClient>,
  );

  modelAnswer = () => openAiAnswer(PUBLISH_SHAPED);
  fetchMock = jest
    .spyOn(global, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === OPENAI_URL) return modelAnswer();
      throw new Error(`unexpected outbound fetch: ${String(input)}`);
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockCreateServiceRoleClient.mockReset();
  process.env.CRON_SECRET = savedEnv.CRON_SECRET;
  process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
});

describe("GET /api/cron/generate-blog-post", () => {
  it.each([
    ["no bearer", undefined],
    ["a wrong bearer", "Bearer not-the-secret"],
    ["the secret without the scheme", CRON_SECRET],
  ])("refuses %s, calls no model and writes nothing", async (_, header) => {
    const response = await GET(cronRequest(header));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it("refuses everything when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cronRequest("Bearer undefined"));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes a draft, never a published post, and says which", async () => {
    const response = await GET(
      cronRequest(
        `Bearer ${CRON_SECRET}`,
        "?status=published&publish=true&published_at=now",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      created: true,
      draft: expect.objectContaining({
        title: "Content Velocity For Founders",
        slug: "content-velocity-for-founders",
        status: "draft",
        published_at: null,
        generated_on: "2026-10-09",
      }),
    });
    expect(db.rows("blog_posts")).toEqual([
      expect.objectContaining({
        id: body.draft.id,
        status: "draft",
        published_at: null,
        content: PUBLISH_SHAPED,
      }),
    ]);
    expect(
      db.rows("blog_posts").filter((row) => row.status === "published"),
    ).toEqual([]);
  });

  it("returns the day's draft on a second delivery without calling the model again", async () => {
    const first = await (
      await GET(cronRequest(`Bearer ${CRON_SECRET}`))
    ).json();
    const second = await GET(cronRequest(`Bearer ${CRON_SECRET}`));
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      created: false,
      draft: { id: first.draft.id, status: "draft" },
    });
    expect(openAiCalls()).toBe(1);
    expect(db.rows("blog_posts")).toHaveLength(1);
  });

  it("makes one OpenAI call for overlapping deliveries and returns the same draft", async () => {
    let announceGeneration!: () => void;
    let releaseGeneration!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      announceGeneration = resolve;
    });
    const generationMayFinish = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    modelAnswer = async () => {
      announceGeneration();
      await generationMayFinish;
      return openAiAnswer(PUBLISH_SHAPED);
    };

    const owner = GET(cronRequest(`Bearer ${CRON_SECRET}`));
    await generationStarted;
    const follower = GET(cronRequest(`Bearer ${CRON_SECRET}`));
    releaseGeneration();
    const [ownerResponse, followerResponse] = await Promise.all([
      owner,
      follower,
    ]);
    const [ownerBody, followerBody] = await Promise.all([
      ownerResponse.json(),
      followerResponse.json(),
    ]);

    expect(ownerResponse.status).toBe(200);
    expect(followerResponse.status).toBe(200);
    expect(openAiCalls()).toBe(1);
    expect([ownerBody.created, followerBody.created].sort()).toEqual([
      false,
      true,
    ]);
    expect(ownerBody.draft.id).toBe(followerBody.draft.id);
    expect(db.rows("blog_posts")).toHaveLength(1);
  });

  it("answers 500 with a generic error and writes nothing when OpenAI fails", async () => {
    modelAnswer = () => new Response("upstream down", { status: 502 });

    const response = await GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to generate blog draft",
    });
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it("writes nothing when OpenAI answers without content", async () => {
    modelAnswer = () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 });

    const response = await GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(500);
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it("fails loudly, without a model call, when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rows("blog_posts")).toEqual([]);
  });
});
