/**
 * s40 — who may spend AI through `POST /api/ai/suggest`, asserted THROUGH the
 * route with the real editor-access code.
 *
 * Written the way `src/__tests__/api/staging/content-device-grant.test.ts` is
 * written, for the same reason: mocking the thing under protection is how a
 * fail-open ships green. So `validateEditorTokenFromRequest` is real, the grant
 * is a real signed token pinned to a real origin hash, `resolveSiteOwnerId` is
 * real, and the only things stubbed are the Supabase client underneath, the
 * model, the limiter and the spend itself (so a test can see WHO it charges).
 *
 * Before s40 the route authenticated with the dashboard cookie. Its only live
 * caller is the widget on a customer's origin, which has no cookie, so every
 * suggestion 401'd for everyone. The fix must not swing the other way: the
 * public site token alone — printed in every page's source — must never spend
 * a credit.
 */

// Must precede the imports: editor-crypto memoises the signing key on first use.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  resetSigningKeyCache,
} from "@/lib/auth/editor-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error("the AI route must not open a cookie client");
  }),
}));

jest.mock("@/lib/supabase/service");

jest.mock("@/lib/ai/openai-service", () => ({
  aiService: { generateContentSuggestion: jest.fn() },
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

// Only the spend is replaced, so the test can see who it charges and with which
// client. `resolveSiteOwnerId` — the decision of WHO pays — stays real.
jest.mock("@/lib/feature-gating/permissions", () => ({
  ...jest.requireActual("@/lib/feature-gating/permissions"),
  consumeFeatureUsage: jest.fn(),
}));

import { OPTIONS, POST } from "@/app/api/ai/suggest/route";
import { aiService } from "@/lib/ai/openai-service";
import { consumeFeatureUsage } from "@/lib/feature-gating/permissions";

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const mockConsumeFeatureUsage = consumeFeatureUsage as jest.Mock;
const mockGenerate = aiService.generateContentSuggestion as jest.Mock;

const SITE_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const OTHER_SITE_ID = "0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d";
const OWNER_ID = "owner-user-1";
const COLLABORATOR_ID = "collaborator-user-2";
const EDITOR_ID = "site-editor-1";
const GRANT_ROW_ID = "grant-row-1";
const EDIT_SESSION_TOKEN = "edit-session-token-abc";
const SITE_TOKEN = "public-site-token-printed-in-page-source";
const MINTING_ORIGIN = "https://helloworld.example";
const ATTACKER_ORIGIN = "https://evil.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";
const EDITOR_EMAIL = "bob@corp.example";

interface Op {
  table: string;
  kind: "select" | "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

/**
 * Records every PostgREST operation, so a refusal can be asserted on what was
 * NOT read or written rather than only on the status code.
 */
function makeClient(handle: (op: Op) => { data: unknown; error: unknown }) {
  const ops: Op[] = [];

  function from(table: string) {
    const op: Op = { table, kind: "select", filters: [] };

    const resolve = () => {
      ops.push(op);
      return Promise.resolve(handle(op));
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (payload: Record<string, unknown>) => {
        op.kind = "update";
        op.payload = payload;
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        op.kind = "insert";
        op.payload = payload;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return builder;
      },
      gte: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return builder;
      },
      limit: () => builder,
      single: resolve,
      maybeSingle: resolve,
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        resolve().then(onOk, onErr),
    };

    return builder;
  }

  return {
    client: { from } as unknown as ReturnType<typeof createServiceRoleClient>,
    ops,
  };
}

function makeGrant(overrides: Record<string, unknown> = {}) {
  return encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
    g: GRANT_ROW_ID,
    s: SITE_ID,
    o: hashOrigin(MINTING_ORIGIN),
    x: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    n: "nonce",
    ...overrides,
  });
}

function grantRow(grant: string, permissions: string[] = ["edit"]) {
  return {
    id: GRANT_ROW_ID,
    site_editor_id: EDITOR_ID,
    grant_hash: hashOpaqueSecret(grant),
    user_agent_hash: hashUserAgent(USER_AGENT),
    origin_hash: hashOrigin(MINTING_ORIGIN),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    revoked_reason: null,
    site_editors: {
      id: EDITOR_ID,
      site_id: SITE_ID,
      email: EDITOR_EMAIL,
      permissions,
      revoked_at: null,
    },
  };
}

/**
 * Answers every read the route and the editor-access code make: the device
 * grant, the edit session, the staging token (never valid here — the site
 * token is not one) and the owner lookup.
 */
function siteHandler(options: {
  grantRow?: unknown;
  editSession?: unknown;
  ownerId?: string | null;
}) {
  return (op: Op) => {
    if (op.table === "editor_device_grants") {
      return op.kind === "select"
        ? { data: options.grantRow ?? null, error: null }
        : { data: null, error: null };
    }
    if (op.table === "edit_sessions") {
      return op.kind === "select" && options.editSession
        ? { data: options.editSession, error: null }
        : op.kind === "select"
          ? { data: null, error: { code: "PGRST116", message: "no rows" } }
          : { data: null, error: null };
    }
    if (op.table === "staging_access") {
      return { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    if (op.table === "site_permissions") {
      return {
        data: options.ownerId ? { user_id: options.ownerId } : null,
        error: null,
      };
    }
    return { data: null, error: null };
  };
}

function suggest(options: {
  headers?: Record<string, string>;
  origin?: string | null;
  body?: Record<string, unknown>;
}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    ...options.headers,
  };
  if (options.origin !== null) {
    headers["Origin"] = options.origin ?? MINTING_ORIGIN;
  }

  return POST(
    new NextRequest("https://www.recopyfa.st/api/ai/suggest", {
      method: "POST",
      headers,
      body: JSON.stringify({
        siteId: SITE_ID,
        text: "Hello world",
        context: "website content",
        goal: "improve",
        tone: "professional",
        ...options.body,
      }),
    }),
  ) as unknown as Promise<Response>;
}

function tablesRead(ops: Op[]) {
  return ops.map((op) => op.table);
}

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

describe("POST /api/ai/suggest — editor credentials, owner pays", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    process.env.OPENAI_API_KEY = "sk-test-configured";
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockConsumeFeatureUsage.mockResolvedValue({ success: true });
    mockGenerate.mockResolvedValue({
      success: true,
      data: ["Hello, world"],
      tokensUsed: 12,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_OPENAI_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
    }
  });

  it("refuses the public site token alone, before any owner lookup or spend", async () => {
    // THE test. `extractEditorToken` reads a lone `Authorization: Bearer` as a
    // STAGING token, so the site token has to fail the staging validator — and
    // fail before anything is read about the owner or charged to them. A site
    // token is in the page source of every customer page; if it authorised AI,
    // anyone could drain an owner's credits with curl.
    const { client, ops } = makeClient(siteHandler({ ownerId: OWNER_ID }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await suggest({
      headers: { Authorization: `Bearer ${SITE_TOKEN}` },
    });

    expect(response.status).toBe(401);
    expect(tablesRead(ops)).not.toContain("site_permissions");
    expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("serves a device grant with edit rights and charges the site owner through the service client", async () => {
    const grant = makeGrant();
    const { client } = makeClient(
      siteHandler({ grantRow: grantRow(grant), ownerId: OWNER_ID }),
    );
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await suggest({
      headers: { "X-RCF-Editor-Grant": grant },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.suggestions).toEqual(["Hello, world"]);
    expect(mockConsumeFeatureUsage).toHaveBeenCalledTimes(1);
    const [payer, feature, , spendClient] =
      mockConsumeFeatureUsage.mock.calls[0];
    // The `admin` row's user, not the editor — a grant holder has no account.
    expect(payer).toBe(OWNER_ID);
    expect(feature).toBe("ai_suggestion");
    expect(spendClient).toBe(client);
  });

  it("refuses the same grant replayed from another origin, and spends nothing", async () => {
    const grant = makeGrant();
    const { client, ops } = makeClient(
      siteHandler({ grantRow: grantRow(grant), ownerId: OWNER_ID }),
    );
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await suggest({
      headers: { "X-RCF-Editor-Grant": grant },
      origin: ATTACKER_ORIGIN,
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("origin_mismatch");
    expect(tablesRead(ops)).not.toContain("site_permissions");
    expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("refuses a view-only grant with 403, and spends nothing", async () => {
    const grant = makeGrant();
    const { client, ops } = makeClient(
      siteHandler({ grantRow: grantRow(grant, ["view"]), ownerId: OWNER_ID }),
    );
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await suggest({
      headers: { "X-RCF-Editor-Grant": grant },
    });

    expect(response.status).toBe(403);
    expect(tablesRead(ops)).not.toContain("site_permissions");
    expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("charges the owner, not the session's user, for an edit session made by a collaborator", async () => {
    // An edit session can be created by any collaborator on the site. Billing
    // `access.userId` would charge whoever opened it; the site's owner is the
    // payer by definition, the same one seat billing uses.
    const { client } = makeClient(
      siteHandler({
        editSession: {
          id: "edit-session-1",
          user_id: COLLABORATOR_ID,
          permissions: ["edit"],
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        ownerId: OWNER_ID,
      }),
    );
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await suggest({
      body: { editToken: EDIT_SESSION_TOKEN },
    });

    expect(response.status).toBe(200);
    expect(mockConsumeFeatureUsage).toHaveBeenCalledTimes(1);
    expect(mockConsumeFeatureUsage.mock.calls[0][0]).toBe(OWNER_ID);
    expect(mockConsumeFeatureUsage.mock.calls[0][0]).not.toBe(COLLABORATOR_ID);
  });

  it("refuses a grant minted for one site when the body names another", async () => {
    const grant = makeGrant();
    const { client, ops } = makeClient(
      siteHandler({ grantRow: grantRow(grant), ownerId: OWNER_ID }),
    );
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await suggest({
      headers: { "X-RCF-Editor-Grant": grant },
      body: { siteId: OTHER_SITE_ID },
    });

    expect(response.status).toBe(401);
    expect(tablesRead(ops)).not.toContain("site_permissions");
    expect(mockConsumeFeatureUsage).not.toHaveBeenCalled();
  });

  it("answers the preflight with 204, public CORS, the grant header allowed and no credentials", async () => {
    // Without the header in the allow-list the browser strips it before the
    // request is sent, and grant holders fail on every customer domain while
    // every server-side test here passes.
    const response = (await OPTIONS(
      new NextRequest("https://www.recopyfa.st/api/ai/suggest", {
        method: "OPTIONS",
        headers: { Origin: MINTING_ORIGIN },
      }),
    )) as unknown as Response;

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-RCF-Editor-Grant",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
