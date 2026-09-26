import { render, screen } from "@testing-library/react";
import BlogPostPage from "../page";
import { createClient } from "@/lib/supabase/server";

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
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
