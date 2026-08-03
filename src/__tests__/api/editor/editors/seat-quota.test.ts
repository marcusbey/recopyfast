/**
 * Seat enforcement on `POST /api/editor/editors`.
 *
 * The seat count spanning both tables is proved in
 * `src/__tests__/lib/feature-gating/seat-quota.test.ts`. What is proved here is
 * that this route actually consumes it — which is the failure this whole lane
 * keeps circling. `canAddCollaborator` was correct and callerless for months;
 * a quota nothing invokes is decoration, and so is one invoked after the write.
 *
 * The other half is the false denial. Enrolment and permission changes share
 * one endpoint, so charging every POST would block an owner at their limit from
 * editing an existing editor's permissions — a write that consumes no seat.
 */

const mockGetUser = jest.fn();
const mockPermissionLookup = jest.fn();

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: jest.fn(() => {
    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      maybeSingle: mockPermissionLookup,
    };
    return chain;
  }),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ from: jest.fn() })),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("@/lib/feature-gating/permissions", () => ({
  canShareSite: jest.fn(),
}));

// `isPlausibleEmail` stays real — it is the route's input validation, and
// stubbing it would let a malformed address through the test unnoticed.
jest.mock("@/lib/auth/editor-directory", () => ({
  ...jest.requireActual("@/lib/auth/editor-directory"),
  findActiveSiteEditor: jest.fn(),
  upsertSiteEditor: jest.fn(),
  listSiteEditors: jest.fn(),
  revokeSiteEditor: jest.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/editor/editors/route";
import { canShareSite } from "@/lib/feature-gating/permissions";
import {
  findActiveSiteEditor,
  upsertSiteEditor,
} from "@/lib/auth/editor-directory";

const mockCanShareSite = canShareSite as jest.MockedFunction<
  typeof canShareSite
>;
const mockFindActiveSiteEditor = findActiveSiteEditor as jest.MockedFunction<
  typeof findActiveSiteEditor
>;
const mockUpsertSiteEditor = upsertSiteEditor as jest.MockedFunction<
  typeof upsertSiteEditor
>;

const SITE_ID = "site-1";
const OWNER_ID = "owner-1";

function postRequest(body: Record<string, unknown>) {
  return new NextRequest("https://recopyfast.com/api/editor/editors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const enrolledEditor = {
  id: "editor-1",
  siteId: SITE_ID,
  email: "ada@clientcompany.com",
  permissions: ["view", "edit"] as const,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

describe("POST /api/editor/editors — seat quota", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    mockGetUser.mockResolvedValue({
      data: { user: { id: OWNER_ID } },
      error: null,
    });
    mockPermissionLookup.mockResolvedValue({
      data: { permission: "admin" },
      error: null,
    });
    mockUpsertSiteEditor.mockResolvedValue(
      enrolledEditor as unknown as Awaited<ReturnType<typeof upsertSiteEditor>>,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("enrols a new editor when the plan has a seat free", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockCanShareSite.mockResolvedValue({ allowed: true });

    const response = await POST(
      postRequest({
        siteId: SITE_ID,
        email: "ada@clientcompany.com",
        permissions: ["view", "edit"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCanShareSite).toHaveBeenCalledWith(SITE_ID, OWNER_ID);
    expect(mockUpsertSiteEditor).toHaveBeenCalled();
  });

  it("refuses the enrolment before writing anything when seats are gone", async () => {
    // Deny *before* the write. A quota checked afterwards has already sold the
    // seat it was meant to withhold.
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockCanShareSite.mockResolvedValue({
      allowed: false,
      reason:
        "You've used all 5 seats on your Pro plan for this site. Editors and collaborators share the same allowance — remove one, or upgrade for more.",
      upgradeRequired: true,
      currentLimit: 5,
      maxLimit: 5,
    });

    const response = await POST(
      postRequest({
        siteId: SITE_ID,
        email: "grace@clientcompany.com",
        permissions: ["view", "edit"],
      }),
    );

    expect(response.status).toBe(403);
    expect(mockUpsertSiteEditor).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.error).toBe("seat_limit");
    expect(body.message).toContain("5 seats");
    expect(body.upgradeRequired).toBe(true);
    expect(body.maxLimit).toBe(5);
  });

  it("charges the seat to the site, letting canShareSite resolve who pays", async () => {
    // The route must not resolve the payer itself. Passing the acting admin to
    // canShareSite is what lets it bill the owner instead.
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockCanShareSite.mockResolvedValue({ allowed: true });

    await POST(
      postRequest({
        siteId: SITE_ID,
        email: "ada@clientcompany.com",
        permissions: ["edit"],
      }),
    );

    expect(mockCanShareSite).toHaveBeenCalledWith(SITE_ID, OWNER_ID);
  });

  it("does not charge a seat to change an existing editor's permissions", async () => {
    // They already hold their seat. Charging again would lock an owner at their
    // limit out of editing anyone they had already invited.
    mockFindActiveSiteEditor.mockResolvedValue(
      enrolledEditor as unknown as Awaited<
        ReturnType<typeof findActiveSiteEditor>
      >,
    );

    const response = await POST(
      postRequest({
        siteId: SITE_ID,
        email: "ada@clientcompany.com",
        permissions: ["view", "edit", "publish"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCanShareSite).not.toHaveBeenCalled();
    expect(mockUpsertSiteEditor).toHaveBeenCalled();
  });

  it("re-checks the quota when restoring a revoked editor", async () => {
    // findActiveSiteEditor returns null for revoked addresses as well as
    // unknown ones, so a restore takes the charged path. It has to: the seat
    // they gave up may have been taken by someone else since.
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockCanShareSite.mockResolvedValue({
      allowed: false,
      reason: "You've used all 5 seats on your Pro plan for this site.",
      upgradeRequired: true,
    });

    const response = await POST(
      postRequest({
        siteId: SITE_ID,
        email: "ada@clientcompany.com",
        permissions: ["view", "edit"],
      }),
    );

    expect(response.status).toBe(403);
    expect(mockCanShareSite).toHaveBeenCalled();
    expect(mockUpsertSiteEditor).not.toHaveBeenCalled();
  });

  it("checks admin rights before spending a quota lookup", async () => {
    // A non-admin must be refused on authorisation, not on billing — and must
    // not be told anything about the owner's plan.
    mockPermissionLookup.mockResolvedValue({
      data: { permission: "edit" },
      error: null,
    });

    const response = await POST(
      postRequest({
        siteId: SITE_ID,
        email: "ada@clientcompany.com",
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("forbidden");
    expect(mockCanShareSite).not.toHaveBeenCalled();
    expect(mockUpsertSiteEditor).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before reaching the quota at all", async () => {
    const response = await POST(
      postRequest({
        siteId: SITE_ID,
        email: "not-an-email",
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(400);
    expect(mockCanShareSite).not.toHaveBeenCalled();
    expect(mockUpsertSiteEditor).not.toHaveBeenCalled();
  });
});
