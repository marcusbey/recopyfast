import { NextRequest } from "next/server";

const mockCreateServiceRoleClient = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => mockCreateServiceRoleClient(),
}));

jest.mock("@/lib/auth/editor-access", () => ({
  authorizeFirstPartyEditorAccess: jest.fn(async () => ({
    kind: "first-party",
    permissions: ["view", "edit", "publish"],
    email: "owner@example.com",
    userId: "user-1",
    stagingAccessId: null,
  })),
  requireEditorPermission: jest.fn(() => true),
  validateEditorTokenFromRequest: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

import { GET as getStagingContent } from "@/app/api/staging/content/[siteId]/route";
import { GET as getPublishPreview } from "@/app/api/staging/publish/route";

function queryResult(result: unknown) {
  const builder: Record<string, unknown> = {};
  let rangeStart = 0;
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.is = jest.fn(() => builder);
  builder.not = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.range = jest.fn((start: number) => {
    rangeStart = start;
    return builder;
  });
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(rangeStart === 0 ? result : { data: [], error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

const attributeOnlyRow = {
  id: "row-1",
  site_id: "site-1",
  element_id: "rcf-link",
  selector: "a",
  staging_content: "Documentation",
  published_content: "Documentation",
  original_content: "Documentation",
  language: "en",
  variant: "default",
  staging_updated_at: "2026-09-24T00:00:00.000Z",
  staging_updated_by: null,
  published_at: "2026-09-23T00:00:00.000Z",
  metadata: {
    type: "a",
    href: "/published",
    analytics_key: "keep-me",
    staging_attributes: { href: "/draft", alt: "Draft alt" },
  },
};

const cleanRow = {
  ...attributeOnlyRow,
  id: "row-2",
  element_id: "rcf-clean",
  staging_content: null,
  metadata: { type: "p" },
};

const equalValueRow = {
  ...attributeOnlyRow,
  id: "row-equal",
  element_id: "rcf-equal",
  page_path: "/pricing",
  metadata: {
    type: "a",
    href: "/published",
    staging_attributes: { href: "/published" },
  },
};

describe("staged href/alt projections", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockCreateServiceRoleClient.mockReturnValue({
      from: jest.fn(() =>
        queryResult({ data: [attributeOnlyRow, cleanRow], error: null }),
      ),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("overlays draft attributes for an editor and marks an attribute-only change", async () => {
    const response = await getStagingContent(
      new NextRequest("https://www.recopyfa.st/api/staging/content/site-1"),
      { params: Promise.resolve({ siteId: "site-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.content[0].metadata).toEqual({
      type: "a",
      href: "/draft",
      alt: "Draft alt",
      analytics_key: "keep-me",
    });
    expect(body.content[0].has_staging_changes).toBe(true);
  });

  it("includes attribute-only edits in the publish preview", async () => {
    const response = await getPublishPreview(
      new NextRequest(
        "https://www.recopyfa.st/api/staging/publish?siteId=site-1",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pendingChanges).toBe(1);
    expect(body.elements).toHaveLength(1);
    expect(body.elements[0]).toMatchObject({
      elementId: "rcf-link",
      metadata: {
        type: "a",
        href: "/draft",
        alt: "Draft alt",
        analytics_key: "keep-me",
      },
    });
  });

  it("does not report an equal-value attribute draft in staging GET or publish preview", async () => {
    mockCreateServiceRoleClient.mockReturnValue({
      from: jest.fn(() => queryResult({ data: [equalValueRow], error: null })),
    });

    const stagingResponse = await getStagingContent(
      new NextRequest(
        "https://www.recopyfa.st/api/staging/content/site-1?page_path=%2Fpricing",
      ),
      { params: Promise.resolve({ siteId: "site-1" }) },
    );
    const previewResponse = await getPublishPreview(
      new NextRequest(
        "https://www.recopyfa.st/api/staging/publish?siteId=site-1&page_path=%2Fpricing",
      ),
    );
    const stagingBody = await stagingResponse.json();
    const previewBody = await previewResponse.json();

    expect(stagingBody.content[0].has_staging_changes).toBe(false);
    expect(previewBody).toMatchObject({
      pendingChanges: 0,
      currentPageChanges: 0,
      otherPageChanges: 0,
      elements: [],
    });
  });

  it("previews every site draft and separates current/shared from other pages", async () => {
    const current = {
      ...attributeOnlyRow,
      id: "row-current",
      element_id: "rcf-current",
      page_path: "/pricing",
    };
    const shared = {
      ...attributeOnlyRow,
      id: "row-shared",
      element_id: "rcf-shared",
      page_path: null,
    };
    const other = {
      ...attributeOnlyRow,
      id: "row-other",
      element_id: "rcf-other",
      page_path: "/about",
    };
    mockCreateServiceRoleClient.mockReturnValue({
      from: jest.fn(() =>
        queryResult({ data: [current, shared, other], error: null }),
      ),
    });

    const response = await getPublishPreview(
      new NextRequest(
        "https://www.recopyfa.st/api/staging/publish?siteId=site-1&page_path=%2Fpricing",
      ),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      pendingChanges: 3,
      currentPageChanges: 2,
      otherPageChanges: 1,
    });
    expect(
      body.elements.map((row: { elementId: string }) => row.elementId),
    ).toEqual(["rcf-current", "rcf-shared", "rcf-other"]);
  });
});
