import { NextRequest } from "next/server";
import { POST } from "../route";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  buildSiteToken,
  verifySiteTokenSignature,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "203.0.113.10"),
}));

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_SITE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OLD_KEY = "old-site-key";

function request() {
  return new NextRequest(
    `http://localhost/api/sites/${SITE_ID}/regenerate-snippet`,
    { method: "POST", headers: { "x-forwarded-for": "203.0.113.10" } },
  );
}

function context(siteId = SITE_ID) {
  return { params: Promise.resolve({ siteId }) };
}

function permissionClient(options?: {
  user?: { id: string } | null;
  permission?: string | null;
  permissionError?: unknown;
}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options?.permission ? { permission: options.permission } : null,
    error: options?.permissionError ?? null,
  });
  const eqUser = jest.fn(() => ({ maybeSingle }));
  const eqSite = jest.fn(() => ({ eq: eqUser }));
  const select = jest.fn(() => ({ eq: eqSite }));

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: options?.user === undefined ? { id: USER_ID } : options.user,
        },
        error: null,
      }),
    },
    from: jest.fn(() => ({ select })),
    permissionQuery: { select, eqSite, eqUser },
  };
}

function serviceClient(options?: { updateError?: unknown; siteId?: string }) {
  const single = jest.fn().mockResolvedValue({
    data: options?.updateError
      ? null
      : {
          id: options?.siteId ?? SITE_ID,
          domain: "example.com",
          name: "Example site",
          api_key: "new-site-key-from-write",
        },
    error: options?.updateError ?? null,
  });
  const select = jest.fn(() => ({ single }));
  const eq = jest.fn(() => ({ select }));
  const update = jest.fn(() => ({ eq }));

  return { from: jest.fn(() => ({ update })), update, eq };
}

describe("POST /api/sites/[siteId]/regenerate-snippet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
  });

  it("rate limits before authentication", async () => {
    const limited = new Response(JSON.stringify({ error: "limited" }), {
      status: 429,
    });
    mockEnforceRateLimit.mockResolvedValueOnce(limited as never);

    const response = await POST(request(), context());

    expect(response.status).toBe(429);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        limit: "IP_GENERAL",
        endpoint: "sites/regenerate-snippet:ip",
        onStoreFailure: "deny",
      }),
    );
  });

  it("rejects a malformed site id before authentication", async () => {
    const response = await POST(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("normalizes uppercase UUIDs before permission and update queries", async () => {
    const client = permissionClient({ permission: "admin" });
    mockCreateClient.mockResolvedValue(client as never);
    const service = serviceClient();
    mockCreateServiceRoleClient.mockReturnValue(service as never);

    const response = await POST(request(), context(SITE_ID.toUpperCase()));

    expect(response.status).toBe(200);
    expect(client.permissionQuery.eqSite).toHaveBeenCalledWith(
      "site_id",
      SITE_ID,
    );
    expect(service.eq).toHaveBeenCalledWith("id", SITE_ID);
  });

  it("normalizes the authenticated user UUID before the owner rate-limit key", async () => {
    const client = permissionClient({
      permission: "admin",
      user: { id: USER_ID.toUpperCase() },
    });
    mockCreateClient.mockResolvedValue(client as never);
    mockCreateServiceRoleClient.mockReturnValue(serviceClient() as never);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(client.permissionQuery.eqUser).toHaveBeenCalledWith(
      "user_id",
      USER_ID,
    );
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(NextRequest),
      expect.objectContaining({ identifier: USER_ID }),
    );
  });

  it("rejects an unauthenticated caller without writing", async () => {
    mockCreateClient.mockResolvedValue(
      permissionClient({ user: null }) as never,
    );
    const service = serviceClient();
    mockCreateServiceRoleClient.mockReturnValue(service as never);

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    expect(service.update).not.toHaveBeenCalled();
  });

  it.each(["view", "edit"])(
    "rejects a %s permission without writing",
    async (permission) => {
      mockCreateClient.mockResolvedValue(
        permissionClient({ permission }) as never,
      );
      const service = serviceClient();
      mockCreateServiceRoleClient.mockReturnValue(service as never);

      const response = await POST(request(), context());

      expect(response.status).toBe(403);
      expect(service.update).not.toHaveBeenCalled();
    },
  );

  it("cannot use an admin grant from another site", async () => {
    // The caller may be an admin somewhere else, but there is deliberately no
    // permission row for the site named by this route.
    const client = permissionClient({ permission: null });
    mockCreateClient.mockResolvedValue(client as never);
    const service = serviceClient();
    mockCreateServiceRoleClient.mockReturnValue(service as never);

    const response = await POST(request(), context(OTHER_SITE_ID));

    expect(response.status).toBe(403);
    expect(client.permissionQuery.eqSite).toHaveBeenCalledWith(
      "site_id",
      OTHER_SITE_ID,
    );
    expect(client.permissionQuery.eqUser).toHaveBeenCalledWith(
      "user_id",
      USER_ID,
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it("applies a fail-closed per-owner limit before rotating", async () => {
    mockCreateClient.mockResolvedValue(
      permissionClient({ permission: "admin" }) as never,
    );
    const limited = new Response(JSON.stringify({ error: "limited" }), {
      status: 429,
    });
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(limited as never);
    const service = serviceClient();
    mockCreateServiceRoleClient.mockReturnValue(service as never);

    const response = await POST(request(), context());

    expect(response.status).toBe(429);
    expect(service.update).not.toHaveBeenCalled();
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(NextRequest),
      expect.objectContaining({
        limit: "USER_DOMAIN_VERIFY",
        endpoint: "sites/regenerate-snippet:owner",
        identifier: USER_ID,
        identifierType: "user",
        onStoreFailure: "deny",
      }),
    );
  });

  it("preserves the current credential when the single update fails", async () => {
    mockCreateClient.mockResolvedValue(
      permissionClient({ permission: "admin" }) as never,
    );
    const service = serviceClient({ updateError: { message: "write failed" } });
    mockCreateServiceRoleClient.mockReturnValue(service as never);

    const response = await POST(request(), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to regenerate snippet",
    });
    expect(service.update).toHaveBeenCalledTimes(1);
  });

  it("rotates once and returns only the newly signed token and snippet", async () => {
    mockCreateClient.mockResolvedValue(
      permissionClient({ permission: "admin" }) as never,
    );
    const service = serviceClient();
    mockCreateServiceRoleClient.mockReturnValue(service as never);
    const oldToken = buildSiteToken(SITE_ID, OLD_KEY);

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledWith({
      api_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(body).toEqual({
      ok: true,
      siteToken: expect.any(String),
      embedScript: expect.stringContaining(
        `data-site-token="${body.siteToken}"`,
      ),
    });
    expect(body).not.toHaveProperty("apiKey");
    expect(JSON.stringify(body)).not.toContain("new-site-key-from-write");
    expect(verifySiteTokenSignature(SITE_ID, OLD_KEY, body.siteToken)).toBe(
      false,
    );
    expect(
      verifySiteTokenSignature(
        SITE_ID,
        "new-site-key-from-write",
        body.siteToken,
      ),
    ).toBe(true);
    expect(
      verifySiteTokenSignature(SITE_ID, "new-site-key-from-write", oldToken),
    ).toBe(false);
  });
});
