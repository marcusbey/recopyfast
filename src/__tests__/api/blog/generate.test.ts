/**
 * @jest-environment node
 */

/**
 * POST /api/blog/generate — on-demand AI drafts, platform admins only (s89).
 *
 * On c0c40bf this route accepted the cron bearer or an admin session, and
 * inserted whatever the model wrote as `published`
 * (src/app/api/blog/generate/route.ts:273-283), through the cookie-bound client
 * that refuses an ADMIN_EMAILS-only owner. Now: same-origin POST, the shared
 * platform-admin guard (ADR 057), a validated body, and a draft written through
 * the service role. The cron drafts in-process, so its bearer opens nothing
 * here any more.
 *
 * The body below asks for `status: "published"` with a date and a day key —
 * the row is a draft with neither.
 */

import { NextRequest } from "next/server";
import {
  createSchemaStrictDatabase,
  type SchemaStrictDatabase,
} from "@/__tests__/helpers/schema-strict-supabase";
import {
  ADMIN_EMAIL,
  APP_ORIGIN,
  blogUser,
  onlyDateFaked,
  rlsRefusingClient,
} from "@/__tests__/helpers/blog-route-fixtures";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { MemoryRateLimiter, rateLimiter } from "@/lib/security/rate-limiter";
import { CONTENT_TOPICS } from "@/lib/blog/topics";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

import { GET, POST } from "@/app/api/blog/generate/route";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CRON_SECRET = "cron-secret-for-tests";
const MODEL_POST = [
  "# On-Demand Draft Title",
  "",
  "A first paragraph that is long enough to become the excerpt of the draft.",
].join("\n");

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const store = rateLimiter as MemoryRateLimiter;

let db: SchemaStrictDatabase;
let fetchMock: jest.SpyInstance;
let modelAnswer: () => Response;
const getUser = jest.fn();

function signedIn(user: User | null) {
  getUser.mockResolvedValue({ data: { user }, error: null });
}

function generateRequest(
  body: unknown,
  headers: Record<string, string> = { origin: APP_ORIGIN },
) {
  return new NextRequest(`${APP_ORIGIN}/api/blog/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function openAiCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => String(url) === OPENAI_URL)
    .length;
}

const savedEnv = {
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  CRON_SECRET: process.env.CRON_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

beforeEach(async () => {
  jest.useFakeTimers(onlyDateFaked(new Date("2026-10-09T09:00:00Z")));
  await store.clearAll();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.OPENAI_API_KEY = "sk-test";

  db = createSchemaStrictDatabase({
    uniqueKeys: { blog_posts: [["slug"], ["generated_on"]] },
  });
  getUser.mockReset();
  signedIn(null);
  mockCreateClient.mockResolvedValue(
    rlsRefusingClient(getUser) as unknown as Awaited<
      ReturnType<typeof createClient>
    >,
  );
  mockCreateServiceRoleClient.mockReturnValue(
    db.client as unknown as ReturnType<typeof createServiceRoleClient>,
  );

  modelAnswer = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: MODEL_POST } }] }),
      { status: 200 },
    );
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
  process.env.ADMIN_EMAILS = savedEnv.ADMIN_EMAILS;
  process.env.CRON_SECRET = savedEnv.CRON_SECRET;
  process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
});

describe("POST /api/blog/generate", () => {
  it("no longer opens to the cron bearer", async () => {
    const response = await POST(
      generateRequest(
        {},
        { origin: APP_ORIGIN, authorization: `Bearer ${CRON_SECRET}` },
      ),
    );

    expect(response.status).toBe(401);
    expect(openAiCalls()).toBe(0);
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it.each([
    ["a user who is not an admin", blogUser()],
    [
      "a user who wrote admin into user_metadata",
      blogUser({ user_metadata: { role: "admin" } }),
    ],
  ])("refuses %s with 403", async (_, user) => {
    signedIn(user);

    const response = await POST(generateRequest({}));

    expect(response.status).toBe(403);
    expect(openAiCalls()).toBe(0);
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["no Origin header", {} as Record<string, string>],
  ])(
    "refuses a POST from %s before reading the session",
    async (_, headers) => {
      signedIn(blogUser({ email: ADMIN_EMAIL }));

      const response = await POST(generateRequest({}, headers));

      expect(response.status).toBe(403);
      expect(getUser).not.toHaveBeenCalled();
      expect(openAiCalls()).toBe(0);
    },
  );

  it("writes a draft for an allow-listed owner, whatever the body asks for", async () => {
    signedIn(blogUser({ email: ADMIN_EMAIL }));

    const response = await POST(
      generateRequest({
        topic: "Pricing Website Maintenance Services",
        category: "freelancing",
        status: "published",
        published_at: "2026-10-09T09:00:00Z",
        generated_on: "2026-10-09",
        id: "chosen-by-caller",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      draft: expect.objectContaining({
        title: "On-Demand Draft Title",
        category: "freelancing",
        status: "draft",
        published_at: null,
        generated_on: null,
      }),
    });
    expect(db.rows("blog_posts")).toEqual([
      expect.objectContaining({
        status: "draft",
        published_at: null,
        generated_on: null,
      }),
    ]);
    expect(db.rows("blog_posts")[0].id).not.toBe("chosen-by-caller");
  });

  it("writes a draft for an app_metadata admin, on a random listed topic", async () => {
    signedIn(blogUser({ app_metadata: { role: "admin" } }));

    const response = await POST(generateRequest({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.draft.status).toBe("draft");
    expect(CONTENT_TOPICS.map((group) => group.category)).toContain(
      body.draft.category,
    );
  });

  it.each([
    ["a topic without a category", { topic: "Only a topic" }],
    ["a category without a topic", { category: "design" }],
    ["an oversized topic", { topic: "x".repeat(201), category: "design" }],
    ["a non-string category", { topic: "Topic", category: 7 }],
    ["an array body", []],
    ["a body that is not JSON", "status=published"],
  ])("answers 400 to %s without calling the model", async (_, body) => {
    signedIn(blogUser({ email: ADMIN_EMAIL }));

    const response = await POST(generateRequest(body));

    expect(response.status).toBe(400);
    expect(openAiCalls()).toBe(0);
    expect(db.rows("blog_posts")).toEqual([]);
  });

  it("answers 500 with a generic error and writes nothing when the model fails", async () => {
    signedIn(blogUser({ email: ADMIN_EMAIL }));
    modelAnswer = () => new Response("upstream down", { status: 502 });

    const response = await POST(generateRequest({}));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to generate blog draft",
    });
    expect(db.rows("blog_posts")).toEqual([]);
  });
});

describe("GET /api/blog/generate", () => {
  it("still suggests a listed topic", async () => {
    const response = await GET();
    const { suggestion } = await response.json();

    const group = CONTENT_TOPICS.find(
      (candidate) => candidate.category === suggestion.category,
    );
    expect(group?.topics).toContain(suggestion.topic);
  });
});
