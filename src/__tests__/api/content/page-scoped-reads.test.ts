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
];

type Row = (typeof rows)[number];

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private filtered = rows;
  private start = 0;
  private end = Number.MAX_SAFE_INTEGER;

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
    this.end = end;
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
    expect(content).toHaveLength(1006);
    expect(content.map((row: Row) => row.element_id)).toContain("other-page");
  });

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

  it("paginates the publish preview for the requested page", async () => {
    const response = await getPublishPreview(
      new NextRequest(
        "https://www.recopyfa.st/api/staging/publish?siteId=site-1&page_path=%2Fpricing",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pendingChanges).toBe(1005);
    expect(
      body.elements.map((row: { elementId: string }) => row.elementId),
    ).not.toContain("other-page");
    expect(
      body.elements.map((row: { elementId: string }) => row.elementId),
    ).toEqual(
      [
        ...body.elements.map((row: { elementId: string }) => row.elementId),
      ].sort(),
    );
  });
});
