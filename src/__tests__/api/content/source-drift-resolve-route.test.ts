/**
 * @jest-environment node
 *
 * s119 (ADR 075) — POST /api/content/source-drift, where a site admin decides
 * what happens to an override whose source the developer has since changed.
 *
 * The scenario: the page said "5 to 10", the client published "5 to 11", the
 * developer deployed "5 to 9". "Keep override" keeps "5 to 11" and measures
 * future deploys against "5 to 9"; "Use new source" puts "5 to 9" live.
 *
 * Pinned: the ADR 037/042 chain in order (IP limiter before getUser, a
 * fail-closed per-user limiter, the admin row through the RLS client, the owner
 * plan gate, and only then the service role), every refusal writing nothing,
 * strict body validation (the observed text is matched verbatim, never
 * trimmed), and the RPC status mapping: resolved 200, conflict/pending 409,
 * missing 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { checkOwnerCanEdit } from "@/lib/billing/owner-can-edit";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/billing/owner-can-edit", () => {
  const actual = jest.requireActual("@/lib/billing/owner-can-edit");
  return { ...actual, checkOwnerCanEdit: jest.fn() };
});

const mockGetUser = jest.fn();
const mockPermission = jest.fn();
const mockPermissionFilters: Array<[string, unknown]> = [];

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table !== "site_permissions") {
        throw new Error(`unexpected RLS read of ${table}`);
      }
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          mockPermissionFilters.push([column, value]);
          return builder;
        },
        maybeSingle: () => mockPermission(),
      };
      return builder;
    },
  })),
}));

import { POST } from "@/app/api/content/source-drift/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockRpc = jest.fn();
const mockedRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;
const mockedOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;
const mockedServiceClient = createServiceRoleClient as jest.MockedFunction<
  typeof createServiceRoleClient
>;

function body(overrides: Record<string, unknown> = {}) {
  return {
    siteId: SITE_ID,
    contentElementId: ROW_ID,
    resolution: "keep",
    expectedObserved: "5 to 9",
    ...overrides,
  };
}

function post(payload: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/content/source-drift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  ) as Promise<Response>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissionFilters.length = 0;
  mockedRateLimit.mockResolvedValue(null);
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: "dev@example.com" } },
  });
  mockPermission.mockResolvedValue({
    data: { permission: "admin" },
    error: null,
  });
  mockedOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: USER_ID });
  mockRpc.mockResolvedValue({ data: "resolved", error: null });
  mockedServiceClient.mockReturnValue({
    rpc: mockRpc,
  } as unknown as ReturnType<typeof createServiceRoleClient>);
});

describe("POST /api/content/source-drift — the chain", () => {
  it("meters per IP, failing closed, before asking who the caller is", async () => {
    await post(body());

    expect(mockedRateLimit.mock.calls[0][1]).toMatchObject({
      limit: "IP_GENERAL",
      identifierType: "ip",
      onStoreFailure: "deny",
    });
    expect(mockedRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetUser.mock.invocationCallOrder[0],
    );
  });

  it("meters per user, failing closed, once the user is known and before the permission read", async () => {
    await post(body());

    expect(mockedRateLimit.mock.calls[1][1]).toMatchObject({
      identifier: USER_ID,
      identifierType: "user",
      onStoreFailure: "deny",
    });
    expect(mockGetUser.mock.invocationCallOrder[0]).toBeLessThan(
      mockedRateLimit.mock.invocationCallOrder[1],
    );
    expect(mockedRateLimit.mock.invocationCallOrder[1]).toBeLessThan(
      mockPermission.mock.invocationCallOrder[0],
    );
  });

  it("answers the IP limiter's refusal without reading anything", async () => {
    mockedRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: "Too many" }, { status: 429 }),
    );

    const response = await post(body());

    expect(response.status).toBe(429);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("answers the per-user limiter's refusal without a permission read", async () => {
    mockedRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        NextResponse.json({ error: "Too many" }, { status: 429 }),
      );

    const response = await post(body());

    expect(response.status).toBe(429);
    expect(mockPermission).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller with 401", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await post(body());

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(["edit", "view"])(
    "refuses a %s member with 403: only a site admin resolves",
    async (permission) => {
      mockPermission.mockResolvedValueOnce({
        data: { permission },
        error: null,
      });

      const response = await post(body());

      expect(response.status).toBe(403);
      expect(mockedOwnerCanEdit).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    },
  );

  it("refuses a caller with no row on the site with 403", async () => {
    mockPermission.mockResolvedValueOnce({ data: null, error: null });

    const response = await post(body());

    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reads the permission for this user on this site through the RLS client", async () => {
    await post(body());

    expect(mockPermissionFilters).toEqual(
      expect.arrayContaining([
        ["site_id", SITE_ID],
        ["user_id", USER_ID],
      ]),
    );
  });

  it("fails closed with 500 when the permission read errors", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockPermission.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });

    const response = await post(body());

    expect(response.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refuses with the owner gate's 402 when the owner's plan ended", async () => {
    mockedOwnerCanEdit.mockResolvedValueOnce({
      ok: false,
      reason: "plan_ended",
    });

    const response = await post(body());

    expect(response.status).toBe(402);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("creates the service client only after every check passed", async () => {
    await post(body());

    expect(mockedOwnerCanEdit.mock.invocationCallOrder[0]).toBeLessThan(
      mockedServiceClient.mock.invocationCallOrder[0],
    );
  });
});

describe("POST /api/content/source-drift — validation", () => {
  it.each([
    ["malformed JSON", "{not json"],
    ["an array body", [body()]],
    ["a non-uuid site", body({ siteId: "site-1" })],
    ["a non-uuid row", body({ contentElementId: "row-1" })],
    ["an unknown resolution", body({ resolution: "delete" })],
    ["a missing observation", body({ expectedObserved: undefined })],
    ["a non-string observation", body({ expectedObserved: 59 })],
    [
      "an oversized observation",
      body({ expectedObserved: "x".repeat(20_001) }),
    ],
    ["control characters", body({ expectedObserved: "5 to 9\u0000" })],
  ])("refuses %s with 400 and writes nothing", async (_label, payload) => {
    const response = await post(payload);

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses an oversized body before parsing it", async () => {
    const response = await post(
      body({ expectedObserved: "x".repeat(200_000) }),
    );

    expect(response.status).toBe(400);
    expect(mockGetUser).toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("matches the observed text verbatim: surrounding whitespace is kept", async () => {
    await post(body({ expectedObserved: "  5 to 9\n" }));

    expect(mockRpc).toHaveBeenCalledWith(
      "resolve_content_source_drift",
      expect.objectContaining({ p_expected_observed: "  5 to 9\n" }),
    );
  });
});

describe("POST /api/content/source-drift — resolutions", () => {
  it("keep: resolves through the RPC scoped by the checked site and answers 200", async () => {
    const response = await post(body({ resolution: "keep" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "resolved",
      resolution: "keep",
    });
    expect(mockRpc).toHaveBeenCalledWith("resolve_content_source_drift", {
      p_site_id: SITE_ID,
      p_content_element_id: ROW_ID,
      p_resolution: "keep",
      p_expected_observed: "5 to 9",
      p_user_email: "dev@example.com",
      p_user_id: USER_ID,
    });
  });

  it("drop: the three-value scenario puts the deployed text live", async () => {
    const response = await post(
      body({ resolution: "drop", expectedObserved: "5 to 9" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "resolved",
      resolution: "drop",
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "resolve_content_source_drift",
      expect.objectContaining({
        p_resolution: "drop",
        p_expected_observed: "5 to 9",
      }),
    );
  });

  it("canonicalises upper-case ids before they reach the RPC", async () => {
    await post(
      body({
        siteId: SITE_ID.toUpperCase(),
        contentElementId: ROW_ID.toUpperCase(),
      }),
    );

    expect(mockPermissionFilters).toContainEqual(["site_id", SITE_ID]);
    expect(mockRpc).toHaveBeenCalledWith(
      "resolve_content_source_drift",
      expect.objectContaining({
        p_site_id: SITE_ID,
        p_content_element_id: ROW_ID,
      }),
    );
  });

  it("falls back to the user id for history when the user has no email", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: USER_ID } } });

    await post(body());

    expect(mockRpc).toHaveBeenCalledWith(
      "resolve_content_source_drift",
      expect.objectContaining({ p_user_email: USER_ID }),
    );
  });

  it.each([
    ["conflict", 409],
    ["pending", 409],
    ["missing", 404],
  ])("maps %s to %i with a message", async (status, code) => {
    mockRpc.mockResolvedValueOnce({ data: status, error: null });

    const response = await post(body({ resolution: "drop" }));
    const json = await response.json();

    expect(response.status).toBe(code);
    expect(json.status).toBe(status);
    expect(typeof json.error).toBe("string");
  });

  it("answers 500 without the database's words when the RPC fails", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "relation secret_internal does not exist" },
    });

    const response = await post(body());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("secret_internal");
    consoleError.mockRestore();
  });

  it("answers 500 for a status the route does not know", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: "surprise", error: null });

    const response = await post(body());

    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
