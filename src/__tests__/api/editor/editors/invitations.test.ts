const mockGetUser = jest.fn();
const mockPermissionLookup = jest.fn();
const mockSiteLookup = jest.fn();
const mockEditorLookup = jest.fn();
const mockEditorEq = jest.fn();
const mockEditorIs = jest.fn();

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
      eq:
        table === "site_editors"
          ? mockEditorEq.mockImplementation(() => chain)
          : jest.fn(() => chain),
      is:
        table === "site_editors"
          ? mockEditorIs.mockImplementation(() => chain)
          : jest.fn(() => chain),
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
  EditorActivationUnavailableError,
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

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EDITOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_EMAIL = "owner@example.com";
const EDITOR_EMAIL = "editor@example.com";
const RECIPIENT_ENDPOINT = "editor/editors:invitation:recipient";

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
    mockEnforceRateLimit.mockReset().mockResolvedValue(null);
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
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        endpoint: RECIPIENT_ENDPOINT,
        identifier: `${SITE_ID}|${EDITOR_EMAIL}`,
        limit: "EDITOR_INVITE_RECIPIENT",
      }),
    );
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

  it("checks the recipient limit even when a concurrent revocation makes activation send mail", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(editor);
    mockActivateSiteEditor.mockResolvedValue({ editor, didActivate: true });
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(429);
    expect(mockActivateSiteEditor).not.toHaveBeenCalled();
    expect(mockSendInvitation).not.toHaveBeenCalled();
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
        endpoint: RECIPIENT_ENDPOINT,
        identifier: `${SITE_ID}|${EDITOR_EMAIL}`,
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

  it("resolves the editor before applying the shared recipient limit", async () => {
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
    expect(mockEditorLookup).toHaveBeenCalledTimes(1);
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("scopes resend lookup to the authorised site and active rows", async () => {
    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(200);
    expect(mockEditorEq).toHaveBeenCalledWith("id", EDITOR_ID);
    expect(mockEditorEq).toHaveBeenCalledWith("site_id", SITE_ID);
    expect(mockEditorIs).toHaveBeenCalledWith("revoked_at", null);
  });

  it("rejects revoked or missing rows before applying the recipient limit", async () => {
    mockEditorLookup.mockResolvedValue({ data: null, error: null });

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(404);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(2);
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("normalizes UUID spelling before lookup and rate-limit keys", async () => {
    const response = await PATCH(
      request("PATCH", {
        siteId: SITE_ID.toUpperCase(),
        siteEditorId: EDITOR_ID.toUpperCase(),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockEditorEq).toHaveBeenCalledWith("id", EDITOR_ID);
    expect(mockEditorEq).toHaveBeenCalledWith("site_id", SITE_ID);
    expect(mockEnforceRateLimit).toHaveBeenLastCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ identifier: `${SITE_ID}|${EDITOR_EMAIL}` }),
    );
  });

  it("shares one recipient bucket across restore and resend paths", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);

    expect(
      (
        await POST(
          request("POST", {
            siteId: SITE_ID,
            email: EDITOR_EMAIL.toUpperCase(),
            permissions: ["edit"],
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
        )
      ).status,
    ).toBe(200);

    const recipientCalls = mockEnforceRateLimit.mock.calls
      .map(([, options]) => options)
      .filter((options) => options.limit === "EDITOR_INVITE_RECIPIENT");
    expect(recipientCalls).toHaveLength(2);
    expect(recipientCalls).toEqual([
      expect.objectContaining({
        endpoint: RECIPIENT_ENDPOINT,
        identifier: `${SITE_ID}|${EDITOR_EMAIL}`,
      }),
      expect.objectContaining({
        endpoint: RECIPIENT_ENDPOINT,
        identifier: `${SITE_ID}|${EDITOR_EMAIL}`,
      }),
    ]);
  });

  it("normalizes the authenticated owner UUID before owner rate-limit keys", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: OWNER_ID.toUpperCase(), email: OWNER_EMAIL } },
      error: null,
    });

    const response = await PATCH(
      request("PATCH", { siteId: SITE_ID, siteEditorId: EDITOR_ID }),
    );

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(NextRequest),
      expect.objectContaining({ identifier: OWNER_ID }),
    );
  });

  it.each([`{${SITE_ID}}`, SITE_ID.replaceAll("-", ""), "not-a-uuid"])(
    "rejects non-canonical UUID input %s before authentication",
    async (siteId) => {
      const response = await PATCH(
        request("PATCH", { siteId, siteEditorId: EDITOR_ID }),
      );

      expect(response.status).toBe(400);
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    },
  );

  it("fails closed with 503 when the activation RPC is unavailable", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);
    mockActivateSiteEditor.mockRejectedValue(
      new EditorActivationUnavailableError(),
    );

    const response = await POST(
      request("POST", {
        siteId: SITE_ID,
        email: EDITOR_EMAIL,
        permissions: ["edit"],
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "service_unavailable",
      message: "Editor invitations are temporarily unavailable.",
    });
    expect(mockSendInvitation).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[editor-auth] activation RPC unavailable; migration must be applied before app deployment",
    );
  });
});
