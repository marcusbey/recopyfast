import { render, screen } from "@testing-library/react";
import BlogPostPage from "../page";
import { createClient } from "@/lib/supabase/server";
import { createSchemaStrictDatabase } from "@/__tests__/helpers/schema-strict-supabase";

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

// The global next/navigation mock (jest.setup.js) has no notFound. Next's own
// throws to render the 404; this one throws a marker the test can see.
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// Header reads AuthContext; the article date is what is under test here.
jest.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function servePublishedPost(publishedAt: string): void {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: "post-1",
        title: "A published post",
        slug: "a-published-post",
        content: "Body text",
        excerpt: "",
        category: "Guides",
        published_at: publishedAt,
        created_at: publishedAt,
      },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  jest.mocked(createClient).mockResolvedValue({
    from: jest.fn(() => query),
  } as unknown as SupabaseServerClient);
}

describe("blog article date", () => {
  it("prints the publication date as its UTC day, in the same format as the list", async () => {
    // 00:30 UTC is still the previous evening anywhere in the Americas.
    servePublishedPost("2024-01-15T00:30:00+00:00");

    render(
      await BlogPostPage({
        params: Promise.resolve({ slug: "a-published-post" }),
      }),
    );

    expect(screen.getByText("Jan 15, 2024")).toBeInTheDocument();
  });
});

/**
 * s89 — a draft never renders at /blog/<slug>.
 *
 * Anonymous readers are kept off drafts twice: RLS ("Published blog posts are
 * public") and the page's own `.eq("status", "published")`. A signed-in
 * `app_metadata` admin is not — the admin write policy is FOR ALL, which
 * includes SELECT — so for that session the page's filter is the only guard
 * between an unreviewed AI draft and the public URL. The double below applies
 * filters but no RLS, i.e. it sees what that admin session sees.
 */
describe("blog article status", () => {
  function serveRows() {
    const db = createSchemaStrictDatabase();
    db.seed("blog_posts", [
      {
        id: "draft-1",
        title: "An unreviewed AI draft",
        slug: "an-unreviewed-ai-draft",
        content: "Draft body",
        category: "Guides",
        status: "draft",
        published_at: null,
        generated_on: "2026-10-09",
        created_at: "2026-10-09T14:00:00+00:00",
      },
      {
        id: "post-1",
        title: "A reviewed post",
        slug: "a-reviewed-post",
        content: "Published body",
        category: "Guides",
        status: "published",
        published_at: "2026-10-09T15:00:00+00:00",
        created_at: "2026-10-09T14:00:00+00:00",
      },
    ]);
    jest
      .mocked(createClient)
      .mockResolvedValue(db.client as unknown as SupabaseServerClient);
  }

  it("answers 404 for a draft's slug", async () => {
    serveRows();

    await expect(
      BlogPostPage({
        params: Promise.resolve({ slug: "an-unreviewed-ai-draft" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a published post", async () => {
    serveRows();

    render(
      await BlogPostPage({
        params: Promise.resolve({ slug: "a-reviewed-post" }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "A reviewed post" }),
    ).toBeInTheDocument();
  });
});
