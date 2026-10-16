import { render, screen } from "@testing-library/react";
import BlogPostPage, { generateMetadata } from "../page";
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
  // The footer reads the pathname (s107: "Cookie settings" only where GA can
  // run); as in the global mock, no route.
  usePathname: () => "",
}));

// Header reads AuthContext; the article date is what is under test here.
jest.mock("@/components/layout/Header", () => ({
  Header: ({ variant }: { variant?: string }) => (
    <header data-testid="header" data-variant={variant} />
  ),
}));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: ({ variant }: { variant?: string }) => (
    <footer data-testid="footer" data-variant={variant} />
  ),
}));

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function servePublishedPost(
  publishedAt: string,
  content = "Body text",
  title = "A published post",
): void {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: "post-1",
        title,
        slug: "a-published-post",
        content,
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

  it("uses the editorial frame, readable article hierarchy and existing destinations", async () => {
    servePublishedPost(
      "2024-01-15T00:30:00+00:00",
      "<h2>Useful heading</h2><p>Useful body</p>",
      "A deliberately long article title that must wrap inside the editorial masthead",
    );

    render(
      await BlogPostPage({
        params: Promise.resolve({ slug: "a-published-post" }),
      }),
    );

    expect(screen.getByTestId("header")).toHaveAttribute(
      "data-variant",
      "editorial",
    );
    expect(screen.getByTestId("footer")).toHaveAttribute(
      "data-variant",
      "editorial",
    );
    expect(
      screen.getByRole("heading", { name: "Useful heading" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try the demo" })).toHaveAttribute(
      "href",
      "/demo",
    );
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "/#features",
    );
  });

  it("keeps script and event attributes inert after the article restyle", async () => {
    servePublishedPost(
      "2024-01-15T00:30:00+00:00",
      '<p onclick="window.__unsafe=1">Safe paragraph</p><script>window.__unsafe=2</script><a href="javascript:alert(1)">Unsafe link</a>',
    );

    const { container } = render(
      await BlogPostPage({
        params: Promise.resolve({ slug: "a-published-post" }),
      }),
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(screen.getByText("Safe paragraph")).toBeInTheDocument();
  });

  it("keeps the article canonical on its slug", async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "a-published-post" }),
      }),
    ).resolves.toEqual({ alternates: { canonical: "/blog/a-published-post" } });
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
