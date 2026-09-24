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
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.not = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.range = jest.fn(() => builder);
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
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
});
