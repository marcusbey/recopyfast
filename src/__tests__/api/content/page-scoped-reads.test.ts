import { NextRequest } from "next/server";

const rows = [
  ...Array.from({ length: 1002 }, (_unused, index) => ({
    id: `page-${String(index).padStart(4, "0")}`,
    site_id: "site-1",
    element_id: `page-${String(index).padStart(4, "0")}`,
    selector: "p",
    original_content: "Published",
    published_content: "Published",
    staging_content: "Draft",
    staging_updated_at: "2026-09-24T00:00:00.000Z",
    staging_updated_by: null,
    published_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: "/pricing",
    metadata: { type: "p" },
  })),
  ...Array.from({ length: 3 }, (_unused, index) => ({
    id: `shared-${index}`,
    site_id: "site-1",
    element_id: `shared-${index}`,
    selector: "nav",
    original_content: "Published",
    published_content: "Published",
    staging_content: "Draft",
    staging_updated_at: "2026-09-24T00:00:00.000Z",
    staging_updated_by: null,
    published_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: null,
    metadata: { type: "a" },
  })),
  {
    id: "other-page",
    site_id: "site-1",
    element_id: "other-page",
    selector: "p",
    original_content: "Published",
    published_content: "Published",
    staging_content: "Draft",
    staging_updated_at: "2026-09-24T00:00:00.000Z",
    staging_updated_by: null,
    published_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: "/about",
    metadata: { type: "p" },
  },
  {
    id: "literal-percent",
    site_id: "site-1",
    element_id: "literal-percent",
    selector: "p",
    original_content: "Published",
    published_content: "Published",
    staging_content: "Draft",
    staging_updated_at: "2026-09-24T00:00:00.000Z",
    staging_updated_by: null,
    published_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: "/%",
    metadata: { type: "p" },
  },
  {
    id: "encoded-space",
    site_id: "site-1",
    element_id: "encoded-space",
    selector: "p",
    original_content: "Published",
    published_content: "Published",
    staging_content: "Draft",
    staging_updated_at: "2026-09-24T00:00:00.000Z",
    staging_updated_by: null,
    published_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: "/%20",
    metadata: { type: "p" },
  },
  {
    id: "canonical-index",
    site_id: "site-1",
    element_id: "canonical-index",
    selector: "p",
    original_content: "Published",
    published_content: "Published",
    staging_content: "Draft",
    staging_updated_at: "2026-09-24T00:00:00.000Z",
    staging_updated_by: null,
    published_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: "/index.html",
    metadata: { type: "p" },
  },
];

type Row = (typeof rows)[number];

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private static readonly SERVER_MAX_ROWS = 500;
  private filtered = rows;
  private start = 0;
  // The server cap applies even if the client forgets to request a range.
  // Keeping that behavior in the double makes deleting pagination turn these
  // guards red instead of accidentally returning the whole fixture.
  private end = Query.SERVER_MAX_ROWS - 1;

  select() {
    return this;
  }

  eq(column: keyof Row, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }

  is(column: keyof Row, value: null) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }

  order(column: keyof Row) {
    this.filtered = [...this.filtered].sort((left, right) =>
      String(left[column]).localeCompare(String(right[column])),
    );
    return this;
  }

  range(start: number, end: number) {
    this.start = start;
    // Production PostgREST may cap a requested 1,000-row range below the
    // client's requested size. A mock that honours the whole requested range
    // lets pagination disappear while this suite stays green, which is exactly
    // how the first page-aware implementation escaped review.
    this.end = Math.min(end, start + Query.SERVER_MAX_ROWS - 1);
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Row[];
          error: null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.filtered.slice(this.start, this.end + 1),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => new Query()),
  })),
}));

jest.mock("@/lib/security/site-auth", () => ({
  authorizeFirstPartySiteRequest: jest.fn(async () => ({
    allowedOrigin: null,
  })),
  authorizeSiteRequest: jest.fn(),
  authorizeSiteOrigin: jest.fn(),
  parseOrigin: jest.fn(),
}));

jest.mock("@/lib/auth/editor-access", () => ({
  authorizeFirstPartyEditorAccess: jest.fn(async () => ({
    kind: "user",
    userId: "user-1",
    email: "owner@example.com",
    permissions: ["view", "edit", "publish", "admin"],
    stagingAccessId: null,
  })),
  requireEditorPermission: jest.fn(() => true),
  validateEditorTokenFromRequest: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

jest.mock("@/lib/sites/site-status", () => ({
  markSiteLive: jest.fn(),
  recordSiteReport: jest.fn(),
}));

import { GET as getPublicContent } from "@/app/api/content/[siteId]/route";
import { GET as getStagingContent } from "@/app/api/staging/content/[siteId]/route";
import { GET as getPublishPreview } from "@/app/api/staging/publish/route";

describe("page-scoped content reads", () => {
  it("paginates a legacy public read when page_path is omitted", async () => {
    const response = await getPublicContent(
      new NextRequest("https://www.recopyfa.st/api/content/site-1"),
      { params: Promise.resolve({ siteId: "site-1" }) },
    );
    const content = await response.json();

    expect(response.status).toBe(200);
    expect(content).toHaveLength(1009);
    expect(content.map((row: Row) => row.element_id)).toContain("other-page");
  });

  // These are the exact outputs of the widget's single decodeURI pass for
  // browser pathnames `/%25` and `/%2520`, respectively.
  it.each([
    ["public", getPublicContent],
    ["staging", getStagingContent],
  ])(
    "paginates the %s read and includes shared rows",
    async (_name, handler) => {
      const response = await handler(
        new NextRequest(
          "https://www.recopyfa.st/api/content/site-1?page_path=%2Fpricing",
        ),
        { params: Promise.resolve({ siteId: "site-1" }) },
      );
      const body = await response.json();
      const content = Array.isArray(body) ? body : body.content;

      expect(response.status).toBe(200);
      expect(content).toHaveLength(1005);
      expect(content.map((row: Row) => row.element_id)).not.toContain(
        "other-page",
      );
      expect(content.map((row: Row) => row.element_id)).toEqual(
        [...content.map((row: Row) => row.element_id)].sort(),
      );
    },
  );

  it.each([
    ["/%", "literal-percent"],
    ["/%20", "encoded-space"],
    ["/index.html", "canonical-index"],
  ])(
    "keeps the widget-normalized %s scope identical across public and staging reads",
    async (pagePath, expectedElementId) => {
      for (const handler of [getPublicContent, getStagingContent]) {
        const response = await handler(
          new NextRequest(
            `https://www.recopyfa.st/api/content/site-1?page_path=${encodeURIComponent(pagePath)}`,
          ),
          { params: Promise.resolve({ siteId: "site-1" }) },
        );
        const body = await response.json();
        const content = Array.isArray(body) ? body : body.content;
        const ids = content.map((row: Row) => row.element_id);

        expect(response.status).toBe(200);
        expect(ids).toContain(expectedElementId);
        expect(ids).not.toContain(
          expectedElementId === "literal-percent"
            ? "encoded-space"
            : expectedElementId === "encoded-space"
              ? "literal-percent"
              : "encoded-space",
        );
      }
    },
  );

  it.each([
    ["/%", "literal-percent"],
    ["/%20", "encoded-space"],
    ["/index.html", "canonical-index"],
  ])(
    "uses the unchanged widget-normalized %s scope for preview counts",
    async (pagePath, expectedElementId) => {
      const response = await getPublishPreview(
        new NextRequest(
          `https://www.recopyfa.st/api/staging/publish?siteId=site-1&page_path=${encodeURIComponent(pagePath)}`,
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pendingChanges).toBe(1009);
      expect(body.currentPageChanges).toBe(4);
      expect(body.otherPageChanges).toBe(1005);
      expect(
        body.elements.map((row: { elementId: string }) => row.elementId),
      ).toContain(expectedElementId);
    },
  );

  it("paginates the site-wide publish preview and reports the page breakdown", async () => {
    const response = await getPublishPreview(
      new NextRequest(
        "https://www.recopyfa.st/api/staging/publish?siteId=site-1&page_path=%2Fpricing",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pendingChanges).toBe(1009);
    expect(body.currentPageChanges).toBe(1005);
    expect(body.otherPageChanges).toBe(4);
    expect(
      body.elements.map((row: { elementId: string }) => row.elementId),
    ).toContain("other-page");
    expect(
      body.elements.map((row: { elementId: string }) => row.elementId),
    ).toEqual(
      [
        ...body.elements.map((row: { elementId: string }) => row.elementId),
      ].sort(),
    );
  });
});
