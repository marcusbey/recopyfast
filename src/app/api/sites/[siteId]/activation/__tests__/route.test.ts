import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "203.0.113.20"),
}));

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SITE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function request(
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
) {
  return new NextRequest(`http://localhost/api/sites/${SITE_ID}/activation`, {
    method,
    headers: { "x-forwarded-for": "203.0.113.20" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context(siteId = SITE_ID) {
  return { params: Promise.resolve({ siteId }) };
}

function authClient(options?: {
  user?: { id: string; user_metadata?: Record<string, unknown> } | null;
  permission?: string | null;
  permissionError?: unknown;
  updateError?: unknown;
}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options?.permission ? { permission: options.permission } : null,
    error: options?.permissionError ?? null,
  });
  const eqUser = jest.fn(() => ({ maybeSingle }));
  const eqSite = jest.fn(() => ({ eq: eqUser }));
  const select = jest.fn(() => ({ eq: eqSite }));
  const updateUser = jest.fn().mockResolvedValue({
    data: { user: options?.user ?? null },
    error: options?.updateError ?? null,
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user:
            options?.user === undefined
              ? { id: USER_ID, user_metadata: { theme: "dark" } }
              : options.user,
        },
        error: null,
      }),
      updateUser,
    },
    from: jest.fn(() => ({ select })),
    permissionQuery: { eqSite, eqUser },
    updateUser,
  };
}

function existenceResult(data: unknown, error: unknown = null) {
  const limit = jest.fn().mockResolvedValue({ data, error });
  const is = jest.fn(() => ({ limit }));
  const secondEq = jest.fn(() => ({ limit, is }));
  const firstEq = jest.fn(() => ({ eq: secondEq, is, limit }));
  const select = jest.fn(() => ({ eq: firstEq, limit }));
  return { select, firstEq, secondEq, is, limit };
}

function serviceClient(options?: {
  site?: { status: string; last_reported_at: string | null } | null;
  siteError?: unknown;
  editors?: unknown[] | null;
  editorError?: unknown;
  publishes?: unknown[] | null;
  publishError?: unknown;
}) {
  const siteSingle = jest.fn().mockResolvedValue({
    data:
      options?.site === undefined
        ? { status: "live", last_reported_at: new Date().toISOString() }
        : options.site,
    error: options?.siteError ?? null,
  });
  const siteEq = jest.fn(() => ({ single: siteSingle }));
  const siteSelect = jest.fn(() => ({ eq: siteEq }));
  const editor = existenceResult(
    options && "editors" in options ? options.editors : [{ id: "editor-1" }],
    options?.editorError,
  );
  const publish = existenceResult(
    options && "publishes" in options
      ? options.publishes
      : [{ content_element_id: "element-1" }],
    options?.publishError,
  );

  return {
    from: jest.fn((table: string) => {
      if (table === "sites") return { select: siteSelect };
      if (table === "site_editors") return { select: editor.select };
      if (table === "staging_history") return { select: publish.select };
      throw new Error(`Unexpected table ${table}`);
    }),
    site: { siteSelect, siteEq, siteSingle },
    editor,
    publish,
  };
}

describe("site activation route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
  });

  it("rate limits before authentication and fails closed", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), {
        status: 429,
      }) as never,
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ onStoreFailure: "deny" }),
    );
  });

  it.each([
    ["invalid site id", null, "not-a-uuid", 400],
    ["missing auth", null, SITE_ID, 401],
    ["non-admin", "view", SITE_ID, 403],
    ["foreign site", null, OTHER_SITE_ID, 403],
  ])("rejects %s", async (_label, permission, siteId, status) => {
    mockCreateClient.mockResolvedValue(
      authClient({
        user: _label === "missing auth" ? null : { id: USER_ID },
        permission,
      }) as never,
    );

    const response = await GET(request(), context(siteId));

    expect(response.status).toBe(status);
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([
    ["awaiting-install", null, false],
    ["live", new Date().toISOString(), true],
    ["live", "2020-01-01T00:00:00.000Z", false],
  ])(
    "derives install state from %s status and last report",
    async (status, lastReportedAt, installed) => {
      mockCreateClient.mockResolvedValue(
        authClient({ permission: "admin" }) as never,
      );
      mockCreateServiceRoleClient.mockReturnValue(
        serviceClient({
          site: { status, last_reported_at: lastReportedAt },
        }) as never,
      );

      const response = await GET(request(), context());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.installed).toBe(installed);
    },
  );

  it("counts only active editors and site-scoped publish records", async () => {
    const auth = authClient({
      permission: "admin",
      user: {
        id: USER_ID,
        user_metadata: { [`activation_dismissed_${SITE_ID}`]: true },
      },
    });
    const service = serviceClient({ editors: [], publishes: [] });
    mockCreateClient.mockResolvedValue(auth as never);
    mockCreateServiceRoleClient.mockReturnValue(service as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      installed: true,
      invited: false,
      published: false,
      dismissed: true,
    });
    expect(service.editor.is).toHaveBeenCalledWith("revoked_at", null);
    expect(service.editor.firstEq).toHaveBeenCalledWith("site_id", SITE_ID);
    expect(service.publish.select).toHaveBeenCalledWith(
      "content_element_id, content_elements!inner(site_id)",
    );
    expect(service.publish.firstEq).toHaveBeenCalledWith("action", "publish");
    expect(service.publish.secondEq).toHaveBeenCalledWith(
      "content_elements.site_id",
      SITE_ID,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns true only when active editor and publish evidence exist", async () => {
    mockCreateClient.mockResolvedValue(
      authClient({ permission: "admin" }) as never,
    );
    mockCreateServiceRoleClient.mockReturnValue(serviceClient() as never);

    const response = await GET(request(), context());

    expect(await response.json()).toEqual({
      installed: true,
      invited: true,
      published: true,
      dismissed: false,
    });
  });

  it("treats a missing site row as an error", async () => {
    mockCreateClient.mockResolvedValue(
      authClient({ permission: "admin" }) as never,
    );
    mockCreateServiceRoleClient.mockReturnValue(
      serviceClient({ site: null }) as never,
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
  });

  it.each(["editor", "publish"])(
    "treats a null %s result as unknown rather than incomplete",
    async (read) => {
      mockCreateClient.mockResolvedValue(
        authClient({ permission: "admin" }) as never,
      );
      mockCreateServiceRoleClient.mockReturnValue(
        serviceClient({
          ...(read === "editor" ? { editors: null as never } : {}),
          ...(read === "publish" ? { publishes: null as never } : {}),
        }) as never,
      );

      const response = await GET(request(), context());

      expect(response.status).toBe(500);
    },
  );

  it.each(["site", "editor", "publish"])(
    "returns an error rather than fabricated progress when the %s read fails",
    async (read) => {
      mockCreateClient.mockResolvedValue(
        authClient({ permission: "admin" }) as never,
      );
      mockCreateServiceRoleClient.mockReturnValue(
        serviceClient({
          ...(read === "site" ? { siteError: { message: "boom" } } : {}),
          ...(read === "editor" ? { editorError: { message: "boom" } } : {}),
          ...(read === "publish" ? { publishError: { message: "boom" } } : {}),
        }) as never,
      );

      const response = await GET(request(), context());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to load activation progress",
      });
    },
  );

  it("dismisses only this site for the signed-in user and preserves other metadata", async () => {
    const client = authClient({
      permission: "admin",
      user: {
        id: USER_ID,
        user_metadata: { theme: "dark", activation_dismissed_other: true },
      },
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST(
      request("POST", {
        userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        installed: true,
        invited: true,
        published: true,
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(client.updateUser).toHaveBeenCalledWith({
      data: { [`activation_dismissed_${SITE_ID}`]: true },
    });
    expect(await response.json()).toEqual({ dismissed: true });
  });

  it("does not save dismissal for a non-admin or another site", async () => {
    const client = authClient({ permission: null });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST(request("POST"), context(OTHER_SITE_ID));

    expect(response.status).toBe(403);
    expect(client.updateUser).not.toHaveBeenCalled();
  });

  it("returns non-success when dismissal persistence fails", async () => {
    const client = authClient({
      permission: "admin",
      updateError: { message: "write failed" },
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST(request("POST"), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to dismiss activation checklist",
    });
  });
});
