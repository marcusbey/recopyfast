import { render, screen } from "@testing-library/react";
import Footer from "@/components/layout/Footer";
import sitemap from "@/app/sitemap";
import { createAnonClient } from "@/lib/supabase/anon";
import { comparisonList } from "@/lib/compare/comparisons";

// s88: the sitemap reads published posts as `anon` (cookie-less), not through
// the cookie client this suite used to mock.
jest.mock("@/lib/supabase/anon", () => ({
  createAnonClient: jest.fn(),
}));

const mockedCreateClient = jest.mocked(createAnonClient);

describe("comparison page discovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("links the comparison hub from the shared landing footer", () => {
    render(<Footer />);

    expect(
      screen.getByRole("link", { name: /compare tools/i }),
    ).toHaveAttribute("href", "/compare");
  });

  it("keeps every comparison URL in the sitemap when blog lookup fails", async () => {
    mockedCreateClient.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const entries = await sitemap();
    const urls = entries.map((entry) => new URL(entry.url).pathname);
    const comparisonUrls = urls.filter((url) => url.startsWith("/compare/"));

    expect(comparisonUrls).toEqual(
      comparisonList.map((comparison) => `/compare/${comparison.slug}`),
    );

    expect(urls).toEqual(
      expect.arrayContaining([
        "/",
        "/demo",
        "/try",
        "/blog",
        "/privacy",
        "/terms",
        "/compare",
        "/compare/webflow-editor",
        "/compare/duda",
        "/compare/tinacms",
        "/compare/cloudcannon",
      ]),
    );
  });

  it("preserves published blog URLs beside the static comparison entries", async () => {
    const order = jest.fn().mockResolvedValue({
      data: [
        {
          slug: "client-editing-guide",
          published_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-20T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    mockedCreateClient.mockReturnValue({ from } as never);

    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);

    expect(paths).toEqual(
      expect.arrayContaining([
        "/compare",
        "/compare/webflow-editor",
        "/blog/client-editing-guide",
      ]),
    );
    expect(from).toHaveBeenCalledWith("blog_posts");
  });
});
