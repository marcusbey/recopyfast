const mockGetUser = jest.fn();
const mockPermissionLookup = jest.fn();
const mockSiteLookup = jest.fn();
const mockEditorLookup = jest.fn();

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

const mockService = {
  from: jest.fn((table: string) => {
    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      is: jest.fn(() => chain),
      maybeSingle: table === "sites" ? mockSiteLookup : mockEditorLookup,
    };
    return chain;
  }),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockService),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("@/lib/feature-gating/permissions", () => ({
  canShareSite: jest.fn(() => Promise.resolve({ allowed: true })),
}));

jest.mock("@/lib/auth/editor-directory", () => ({
  ...jest.requireActual("@/lib/auth/editor-directory"),
  activateSiteEditor: jest.fn(),
  findActiveSiteEditor: jest.fn(),
  listSiteEditors: jest.fn(),
  revokeSiteEditor: jest.fn(),
}));

jest.mock("@/lib/email/resend", () => ({
  sendEditorInvitationEmail: jest.fn(),
}));

import { NextRequest, NextResponse } from "next/server";
import { PATCH, POST } from "@/app/api/editor/editors/route";
import {
  activateSiteEditor,
  findActiveSiteEditor,
} from "@/lib/auth/editor-directory";
import { sendEditorInvitationEmail } from "@/lib/email/resend";
import { enforceRateLimit } from "@/lib/api/rate-limit";

const mockFindActiveSiteEditor = findActiveSiteEditor as jest.MockedFunction<
  typeof findActiveSiteEditor
>;
const mockActivateSiteEditor = activateSiteEditor as jest.MockedFunction<
  typeof activateSiteEditor
>;
const mockSendInvitation = sendEditorInvitationEmail as jest.MockedFunction<
  typeof sendEditorInvitationEmail
>;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const SITE_ID = "site-1";
const EDITOR_ID = "editor-1";
const OWNER_ID = "owner-1";
const OWNER_EMAIL = "owner@example.com";
const EDITOR_EMAIL = "editor@example.com";

const editor = {
  id: EDITOR_ID,
  siteId: SITE_ID,
  email: EDITOR_EMAIL,
  permissions: ["view", "edit"] as Array<"view" | "edit">,
  createdAt: new Date("2026-09-24T00:00:00.000Z"),
};

function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
  return new NextRequest("https://recopyfa.st/api/editor/editors", {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

describe("editor invitation delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEXT_PUBLIC_APP_URL = "https://app.recopyfa.st";

    mockGetUser.mockResolvedValue({
      data: { user: { id: OWNER_ID, email: OWNER_EMAIL } },
      error: null,
    });
    mockPermissionLookup.mockResolvedValue({
      data: { permission: "admin" },
      error: null,
    });
    mockSiteLookup.mockResolvedValue({
      data: { name: "Client & Co", domain: "client.example" },
      error: null,
    });
    mockEditorLookup.mockResolvedValue({
      data: {
        id: EDITOR_ID,
        site_id: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["view", "edit"],
        revoked_at: null,
      },
      error: null,
    });
    mockActivateSiteEditor.mockResolvedValue({ editor, didActivate: true });
    mockSendInvitation.mockResolvedValue({ sent: true });
    mockEnforceRateLimit.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it("sends exactly one invitation after a new enrolment", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["view", "edit"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSendInvitation).toHaveBeenCalledTimes(1);
    expect(mockSendInvitation).toHaveBeenCalledWith({
      to: EDITOR_EMAIL,
      inviterEmail: OWNER_EMAIL,
      siteName: "Client & Co",
      siteDomain: "client.example",
      permissions: ["view", "edit"],
      hubUrl: "https://app.recopyfa.st/edit",
    });
    expect((await response.json()).invitationEmailSent).toBe(true);
  });

  it("sends when a revoked editor is restored", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSendInvitation).toHaveBeenCalledTimes(1);
    expect((await response.json()).invitationEmailSent).toBe(true);
  });

  it("does not email an already-active editor when permissions change", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(editor);
    mockActivateSiteEditor.mockResolvedValue({ editor, didActivate: false });

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["view", "edit", "publish"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSendInvitation).not.toHaveBeenCalled();
    expect(mockSiteLookup).not.toHaveBeenCalled();
    expect((await response.json()).invitationEmailSent).toBe(false);
  });

  it("keeps enrolment successful and reports false when Resend fails", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockSendInvitation.mockResolvedValue({ sent: false, error: "unavailable" });

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockActivateSiteEditor).toHaveBeenCalledTimes(1);
    expect((await response.json()).invitationEmailSent).toBe(false);
  });

  it("keeps enrolment successful when invitation metadata cannot be loaded", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockSiteLookup.mockResolvedValue({
      data: null,
      error: { message: "down" },
    });

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSendInvitation).not.toHaveBeenCalled();
    expect((await response.json()).invitationEmailSent).toBe(false);
  });

  it("keeps enrolment successful when the authenticated user has no email metadata", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({
      data: { user: { id: OWNER_ID, email: null } },
      error: null,
    });

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockActivateSiteEditor).toHaveBeenCalledTimes(1);
    expect(mockSendInvitation).not.toHaveBeenCalled();
    expect((await response.json()).invitationEmailSent).toBe(false);
  });

  it("resends to an active editor after all fail-closed limits and admin auth", async () => {
    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(3);
    expect(
      mockEnforceRateLimit.mock.calls.map(([, options]) => options),
    ).toEqual([
      expect.objectContaining({
        endpoint: "editor/editors:resend:ip",
        identifierType: "ip",
        onStoreFailure: "deny",
      }),
      expect.objectContaining({
        endpoint: "editor/editors:resend:owner",
        identifier: OWNER_ID,
        onStoreFailure: "deny",
      }),
      expect.objectContaining({
        endpoint: "editor/editors:resend:editor",
        identifier: `${SITE_ID}|${EDITOR_ID}`,
        limit: "EDITOR_INVITE_RECIPIENT",
        onStoreFailure: "deny",
      }),
    ]);
    expect(mockSendInvitation).toHaveBeenCalledTimes(1);
    expect((await response.json()).invitationEmailSent).toBe(true);
  });

  it("applies the fail-closed IP limit before authentication", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
    );

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(429);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockEditorLookup).not.toHaveBeenCalled();
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("requires site-admin permission before owner or editor resend limits", async () => {
    mockPermissionLookup.mockResolvedValue({
      data: { permission: "edit" },
      error: null,
    });

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(403);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
    expect(mockEditorLookup).not.toHaveBeenCalled();
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("stops before editor lookup when the per-owner resend limit refuses", async () => {
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(429);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(2);
    expect(mockEditorLookup).not.toHaveBeenCalled();
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("does not look up or email the editor when the recipient limit refuses", async () => {
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(429);
    expect(mockEditorLookup).not.toHaveBeenCalled();
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("rejects revoked or missing rows scoped to the authorised site", async () => {
    mockEditorLookup.mockResolvedValue({ data: null, error: null });

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(404);
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });
});
