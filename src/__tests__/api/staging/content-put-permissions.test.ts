/**
 * PUT /api/staging/content/[siteId] — what a signed-in collaborator is told
 * when they may look but not edit.
 *
 * `authorizeFirstPartyEditorAccess` returns null for two different situations:
 * "no first-party access at all" and "has access, but not at the level asked
 * for". Asking it for "edit" up front therefore made a view-only collaborator
 * indistinguishable from an anonymous caller — control fell through to the
 * invite-token path and answered "Invalid editor token" to somebody who is
 * plainly signed in and never had a token.
 *
 * The route now asks at "view" and grades afterwards, the shape already used by
 * the GET handler beside it and by /api/staging/publish.
 *
 * Nothing here mocks the permission model: `normalizePermissions` does the
 * grading for real. Only the session and the `site_permissions` row are
 * supplied, which is the part a unit test cannot reach.
 */

const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: mockMaybeSingle }),
          }),
        }),
      }),
    }),
  ),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => {
    throw new Error("the service role must not be reached on a refusal");
  }),
}));

import { PUT } from "@/app/api/staging/content/[siteId]/route";
import { NextRequest } from "next/server";

const SITE_ID = "site-1";

function putContent(): Promise<Response> {
  return PUT(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${SITE_ID}`, {
      method: "PUT",
      body: JSON.stringify({ elementId: "headline", content: "New copy" }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as Promise<Response>;
}

describe("PUT /api/staging/content/[siteId] permission grading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "viewer@example.com" } },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("tells a view-only collaborator what they lack, not that their token is invalid", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { permission: "view" } });

    const response = await putContent();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("edit");
    expect(body.error).not.toContain("token");
  });

  it("still refuses an anonymous caller on the token path", async () => {
    // No session at all: the first-party path is genuinely not available, and
    // the invite-token answer is the correct one.
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await putContent();
    const body = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toMatch(/token|Authentication/i);
  });

  it("lets a collaborator who holds edit rights through the guard", async () => {
    // Reaching the service role is the proof: the permission gate passed, and
    // the mock throws there so the test stops without touching a database.
    mockMaybeSingle.mockResolvedValue({ data: { permission: "edit" } });

    const response = await putContent();

    expect(response.status).toBe(500);
  });
});
