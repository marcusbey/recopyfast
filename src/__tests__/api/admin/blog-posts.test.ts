/**
 * @jest-environment node
 */

/**
 * /api/admin/blog/posts — the human half of "it drafts, a human publishes"
 * (s89, ADR 057).
 *
 * Before s89 there was no way to review or publish a draft at all. These
 * routes are the whole publish path: a platform admin lists drafts (with their
 * content, to read them), publishes one — `published` plus `published_at` —
 * or takes a published post back to draft. Everyone else gets 401/403 and
 * changes nothing; a state-changing POST from another origin, or with no
 * Origin, is refused before the session is read.
 *
 * Writes go through the service role (an ADMIN_EMAILS-only owner is invisible
 * to RLS), so the user-scoped client here refuses every `blog_posts` query, as
 * production would for that owner.
 */

import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
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
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { MemoryRateLimiter, rateLimiter } from "@/lib/security/rate-limiter";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

import { GET } from "@/app/api/admin/blog/posts/route";
import { POST } from "@/app/api/admin/blog/posts/[id]/route";

const NOW = new Date("2026-10-09T15:00:00.000Z");

const DRAFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEWER_DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PUBLISHED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNKNOWN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const store = rateLimiter as MemoryRateLimiter;

let db: SchemaStrictDatabase;
const getUser = jest.fn();

function post(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Post ${id.slice(0, 4)}`,
    slug: `post-${id.slice(0, 4)}`,
    content: `# Post ${id.slice(0, 4)}\n\nBody to review.`,
    excerpt: "Body to review.",
    category: "development",
    status: "draft",
    published_at: null,
    generated_on: null,
    created_at: "2026-10-08T14:00:10Z",
    ...overrides,
  };
}

function seed() {
  db.seed("blog_posts", [
    post(DRAFT_ID, { generated_on: "2026-10-08" }),
    post(NEWER_DRAFT_ID, {
      generated_on: "2026-10-09",
      created_at: "2026-10-09T14:00:10Z",
    }),
    post(PUBLISHED_ID, {
      status: "published",
      published_at: "2026-09-01T14:00:00Z",
      created_at: "2026-09-01T14:00:00Z",
    }),
  ]);
}

function row(id: string) {
  return db.rows("blog_posts").find((candidate) => candidate.id === id);
}

function signedIn(user: User | null) {
  getUser.mockResolvedValue({ data: { user }, error: null });
}

function listRequest(query = "") {
  return new NextRequest(`${APP_ORIGIN}/api/admin/blog/posts${query}`);
}

function actionRequest(
  body: unknown,
  headers: Record<string, string> = { origin: APP_ORIGIN },
) {
  return new NextRequest(`${APP_ORIGIN}/api/admin/blog/posts/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function act(
  id: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return POST(actionRequest(body, headers), {
    params: Promise.resolve({ id }),
  });
}

const savedAdminEmails = process.env.ADMIN_EMAILS;

beforeEach(async () => {
  jest.useFakeTimers(onlyDateFaked(NOW));
  await store.clearAll();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;

  db = createSchemaStrictDatabase({
    uniqueKeys: { blog_posts: [["slug"], ["generated_on"]] },
  });
  seed();
  getUser.mockReset();
  signedIn(blogUser({ email: ADMIN_EMAIL }));
  mockCreateClient.mockResolvedValue(
    rlsRefusingClient(getUser) as unknown as Awaited<
      ReturnType<typeof createClient>
    >,
  );
  mockCreateServiceRoleClient.mockReturnValue(
    db.client as unknown as ReturnType<typeof createServiceRoleClient>,
  );
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockCreateServiceRoleClient.mockReset();
  process.env.ADMIN_EMAILS = savedAdminEmails;
});

const NOT_ADMINS: Array<[string, User | null, number]> = [
  ["nobody signed in", null, 401],
  ["a user who is not an admin", blogUser(), 403],
  [
    "a user who wrote admin into user_metadata",
    blogUser({ user_metadata: { role: "admin" } }),
    403,
  ],
];

describe("GET /api/admin/blog/posts", () => {
  it("lists drafts, newest first, with the content to review", async () => {
    const response = await GET(listRequest());
    const { posts } = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(posts.map((entry: { id: string }) => entry.id)).toEqual([
      NEWER_DRAFT_ID,
      DRAFT_ID,
    ]);
    expect(posts[0]).toMatchObject({
      status: "draft",
      generated_on: "2026-10-09",
      content: expect.stringContaining("Body to review."),
    });
  });

  it("lists published posts when asked", async () => {
    const response = await GET(listRequest("?status=published"));
    const { posts } = await response.json();

    expect(posts.map((entry: { id: string }) => entry.id)).toEqual([
      PUBLISHED_ID,
    ]);
  });

  it("works for an app_metadata admin too", async () => {
    signedIn(blogUser({ app_metadata: { role: "admin" } }));

    const response = await GET(listRequest());

    expect(response.status).toBe(200);
  });

  it.each(["?status=archived", "?status=all", "?status="])(
    "answers 400 to %s",
    async (query) => {
      const response = await GET(listRequest(query));

      expect(response.status).toBe(400);
    },
  );

  it.each(NOT_ADMINS)("refuses %s", async (_, user, status) => {
    signedIn(user);

    const response = await GET(listRequest());

    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty("posts");
  });
});

describe("POST /api/admin/blog/posts/[id]", () => {
  it("publishes a draft and stamps its publication time", async () => {
    const response = await act(DRAFT_ID, { action: "publish" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.post).toMatchObject({
      id: DRAFT_ID,
      status: "published",
      published_at: NOW.toISOString(),
    });
    expect(row(DRAFT_ID)).toMatchObject({
      status: "published",
      published_at: NOW.toISOString(),
    });
    expect(row(NEWER_DRAFT_ID)?.status).toBe("draft");
  });

  it("takes a published post back to draft and clears its date", async () => {
    const response = await act(PUBLISHED_ID, { action: "unpublish" });

    expect(response.status).toBe(200);
    expect(row(PUBLISHED_ID)).toMatchObject({
      status: "draft",
      published_at: null,
    });
  });

  it("accepts the id in upper case", async () => {
    const response = await act(DRAFT_ID.toUpperCase(), { action: "publish" });

    expect(response.status).toBe(200);
    expect(row(DRAFT_ID)?.status).toBe("published");
  });

  it.each([
    ["publishing a published post", PUBLISHED_ID, "publish"],
    ["unpublishing a draft", DRAFT_ID, "unpublish"],
  ])("answers 409 to %s and changes nothing", async (_, id, action) => {
    const before = row(id);

    const response = await act(id, { action });

    expect(response.status).toBe(409);
    expect(row(id)).toEqual(before);
  });

  it("answers 404 to an id no post has", async () => {
    const response = await act(UNKNOWN_ID, { action: "publish" });

    expect(response.status).toBe(404);
  });

  it.each([
    ["a malformed id", "not-a-uuid", { action: "publish" }],
    ["an unknown action", DRAFT_ID, { action: "delete" }],
    ["a missing action", DRAFT_ID, {}],
    ["a body that is not JSON", DRAFT_ID, "action=publish"],
  ])("answers 400 to %s and changes nothing", async (_, id, body) => {
    const response = await act(id, body);

    expect(response.status).toBe(400);
    expect(row(DRAFT_ID)?.status).toBe("draft");
  });

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["a branded subdomain", { origin: "https://acme.recopyfa.st" }],
    ["no Origin header", {} as Record<string, string>],
  ])(
    "refuses a POST from %s before reading the session",
    async (_, headers) => {
      const response = await act(DRAFT_ID, { action: "publish" }, headers);

      expect(response.status).toBe(403);
      expect(getUser).not.toHaveBeenCalled();
      expect(row(DRAFT_ID)?.status).toBe("draft");
    },
  );

  it.each(NOT_ADMINS)(
    "refuses %s and changes nothing",
    async (_, user, status) => {
      signedIn(user);

      const response = await act(DRAFT_ID, { action: "publish" });

      expect(response.status).toBe(status);
      expect(row(DRAFT_ID)).toMatchObject({
        status: "draft",
        published_at: null,
      });
    },
  );
});
