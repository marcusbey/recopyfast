/**
 * s88 review (minor 2) — /blog lists what is really published.
 *
 * Until this fix the index was a hard-coded array of three posts dated
 * January 2024, each linking to a slug no row in `blog_posts` was known to
 * have: every "Read more" was a likely 404, and a post an admin published never
 * appeared. The index now reads the table the way the sitemap does — as `anon`
 * (ADR 058), published rows only — and has three distinct states: the list, an
 * empty state when nothing is published, and an error when the read fails.
 *
 * The double is `blog_posts` as the migrations build it, with no RLS: it
 * applies the page's own filters and nothing else, so "a draft is never listed"
 * is pinned to the page's filter, not to a policy the test cannot see. It
 * answers a column no migration creates with an error, as PostgREST would.
 */

import { render, screen } from "@testing-library/react";
import {
  createSchemaStrictDatabase,
  type Row,
} from "@/__tests__/helpers/schema-strict-supabase";

jest.mock("@/lib/supabase/anon", () => ({ createAnonClient: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error("/blog must not read through the cookie client");
  }),
}));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => {
    throw new Error("/blog must not read through the service role");
  }),
}));

// Header reads AuthContext; the post list is what is under test here.
jest.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

import BlogIndex, { revalidate } from "@/app/blog/page";
import { revalidate as sitemapRevalidate } from "@/app/sitemap";
import { createAnonClient } from "@/lib/supabase/anon";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

const mockedAnon = jest.mocked(createAnonClient);
type AnonClient = ReturnType<typeof createAnonClient>;

/** The three posts the old hard-coded index advertised. */
const FAKE_2024_TITLES = [
  "5 Ways AI Website Builders Are Revolutionizing Web Development",
  "Why Every Marketer Needs Dynamic Content Management",
  "The Freelancer's Guide to Client Website Management",
];

function post(overrides: Row): Row {
  return {
    content: "Body text",
    excerpt: "What this post is about.",
    category: "Guides",
    created_at: "2026-09-01T09:00:00+00:00",
    updated_at: "2026-09-01T09:00:00+00:00",
    ...overrides,
  };
}

const OLDER = post({
  id: "post-older",
  title: "An older post",
  slug: "an-older-post",
  status: "published",
  published_at: "2026-09-02T10:00:00+00:00",
});
const NEWER = post({
  id: "post-newer",
  title: "A newer post",
  slug: "a-newer-post",
  category: "Product",
  status: "published",
  published_at: "2026-10-08T10:00:00+00:00",
});
const DRAFT = post({
  id: "post-draft",
  title: "An unreviewed draft",
  slug: "an-unreviewed-draft",
  status: "draft",
  published_at: null,
});
const ARCHIVED = post({
  id: "post-archived",
  title: "A retired post",
  slug: "a-retired-post",
  status: "archived",
  published_at: "2026-08-01T10:00:00+00:00",
});

function serve(rows: Row[]) {
  const db = createSchemaStrictDatabase();
  db.seed("blog_posts", rows);
  mockedAnon.mockReturnValue(db.client as unknown as AnonClient);
  return db;
}

/** A client whose every read answers `{ error }`, as supabase-js does. */
function serveFailingRead(message: string) {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve(resolve({ data: null, error: { message } })),
  };
  mockedAnon.mockReturnValue({ from: () => query } as unknown as AnonClient);
}

async function renderIndex() {
  render(await BlogIndex());
}

function postLinks(): (string | null)[] {
  return screen
    .queryAllByRole("link", { name: /read more/i })
    .map((link) => link.getAttribute("href"));
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  mockedAnon.mockReset();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("/blog with published posts", () => {
  it("lists the published posts, newest first", async () => {
    serve([OLDER, DRAFT, NEWER, ARCHIVED]);

    await renderIndex();

    expect(postLinks()).toEqual(["/blog/a-newer-post", "/blog/an-older-post"]);
    expect(screen.getByText("A newer post")).toBeInTheDocument();
    expect(screen.getByText("Oct 8, 2026")).toBeInTheDocument();
  });

  it("never lists a draft or an archived post", async () => {
    serve([OLDER, DRAFT, NEWER, ARCHIVED]);

    await renderIndex();

    expect(screen.queryByText("An unreviewed draft")).not.toBeInTheDocument();
    expect(screen.queryByText("A retired post")).not.toBeInTheDocument();
  });

  it("no longer advertises the hard-coded 2024 posts", async () => {
    serve([NEWER]);

    await renderIndex();

    for (const title of FAKE_2024_TITLES) {
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
  });

  it("reads as anon, never through the cookie client or the service role", async () => {
    const db = serve([NEWER]);

    await renderIndex();

    expect(db.queriesOn("blog_posts")).toEqual([
      expect.objectContaining({ operation: "select", error: null }),
    ]);
    expect(createCookieClient).not.toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("/blog with nothing published", () => {
  it("says so, and shows no list", async () => {
    serve([DRAFT, ARCHIVED]);

    await renderIndex();

    expect(
      screen.getByRole("heading", { name: "No posts yet" }),
    ).toBeInTheDocument();
    expect(postLinks()).toEqual([]);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("/blog when the posts cannot be read", () => {
  it("shows an error, not an empty blog, and logs the failed query", async () => {
    serveFailingRead("permission denied for table blog_posts");

    await renderIndex();

    expect(screen.getByRole("alert")).toHaveTextContent(
      /blog could not be loaded/i,
    );
    expect(
      screen.queryByRole("heading", { name: "No posts yet" }),
    ).not.toBeInTheDocument();
    expect(postLinks()).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });

  it("shows the same error, logged, when the client is unconfigured", async () => {
    mockedAnon.mockImplementation(() => {
      throw new Error("Supabase anon client is unconfigured");
    });

    await renderIndex();

    expect(screen.getByRole("alert")).toHaveTextContent(
      /blog could not be loaded/i,
    );
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("/blog freshness", () => {
  it("regenerates on the sitemap's schedule", () => {
    expect(revalidate).toBe(sitemapRevalidate);
  });
});
