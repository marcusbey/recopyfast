/**
 * The device grant on the content write path — asserted THROUGH the route.
 *
 * These tests deliberately do not call `validateEditorAccess` directly, and
 * deliberately do not mock `validateDeviceGrant`. The failure this story guards
 * against is not "the helper is wrong" — it is "a call site forgot to pass the
 * device context", which a helper test passes by construction, and mocking the
 * thing under protection is how a fail-open ships green. So the grant is a real
 * signed token, the origin pin is the real one, and the only thing stubbed is
 * the Supabase client underneath.
 *
 * Before s14a these could not be written at all: `extractEditorToken` returned
 * null for a grant, `validateDeviceGrant` had exactly one caller in the whole
 * app (`/api/editor/validate-grant`), and the widget shipped the sentence
 * "in-page editing isn't enabled for this site yet" to every grant holder.
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

const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
      }),
    }),
  ),
}));

jest.mock("@/lib/supabase/service");

import { OPTIONS, PUT } from "@/app/api/staging/content/[siteId]/route";
import { POST as PUBLISH } from "@/app/api/staging/publish/route";

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const SITE_ID = "site-abc";
const OTHER_SITE_ID = "site-xyz";
const EDITOR_ID = "site-editor-1";
const GRANT_ROW_ID = "grant-row-1";
const ELEMENT_ROW_ID = "content-element-1";
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
 * NOT written rather than only on the status code. A 403 that still saved the
 * content would pass a status-only test.
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
      delete: () => {
        op.kind = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return builder;
      },
      is: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return builder;
      },
      not: (column: string, _operator: string, value: unknown) => {
        op.filters.push([column, value]);
        return builder;
      },
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

function grantRow(
  grant: string,
  editorOverrides: Record<string, unknown> = {},
  rowOverrides: Record<string, unknown> = {},
) {
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
      permissions: ["edit"],
      revoked_at: null,
      ...editorOverrides,
    },
    ...rowOverrides,
  };
}

const CURRENT_ELEMENT = { id: ELEMENT_ROW_ID, staging_content: "Old copy" };

/** Answers every read the route and the grant validator make. */
function siteHandler(row: unknown) {
  return (op: Op) => {
    if (op.table === "editor_device_grants") {
      return op.kind === "select"
        ? { data: row, error: null }
        : { data: null, error: null };
    }
    if (op.table === "content_elements" && op.kind === "select") {
      return { data: CURRENT_ELEMENT, error: null };
    }
    return { data: null, error: null };
  };
}

function putWithGrant(options: {
  grant: string | null;
  origin?: string | null;
  siteId?: string;
}): Promise<Response> {
  const siteId = options.siteId ?? SITE_ID;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (options.origin !== null) {
    headers["Origin"] = options.origin ?? MINTING_ORIGIN;
  }
  if (options.grant) {
    headers["X-RCF-Editor-Grant"] = options.grant;
  }

  return PUT(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${siteId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ elementId: "headline", content: "New copy" }),
    }),
    { params: Promise.resolve({ siteId }) },
  ) as unknown as Promise<Response>;
}

function writesTo(ops: Op[], table: string) {
  return ops.filter((op) => op.table === table && op.kind !== "select");
}

describe("PUT /api/staging/content/[siteId] — the device grant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    // No signed-in user: the first-party branch is genuinely unavailable and
    // control reaches the token path, which is what is under test.
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the origin pin, through the route", () => {
    it("refuses a grant presented with no Origin header at all", async () => {
      // THE test. Nothing in the type system stops a call site omitting the
      // device context, and an omitted context is not a compile error, not a
      // test failure and not a 500 — it is a permanent cross-site editing
      // credential. Asserted through the route so a call site that forgets
      // cannot pass.
      const grant = makeGrant();
      const { client, ops } = makeClient(siteHandler(grantRow(grant)));
      mockCreateServiceRoleClient.mockReturnValue(client);

      const response = await putWithGrant({ grant, origin: null });

      expect(response.status).toBe(401);
      expect(writesTo(ops, "content_elements")).toHaveLength(0);
      expect(writesTo(ops, "staging_history")).toHaveLength(0);
    });

    it("refuses a grant replayed from an origin it was not minted on", async () => {
      const grant = makeGrant();
      const { client, ops } = makeClient(siteHandler(grantRow(grant)));
      mockCreateServiceRoleClient.mockReturnValue(client);

      const response = await putWithGrant({ grant, origin: ATTACKER_ORIGIN });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe("origin_mismatch");
      expect(writesTo(ops, "content_elements")).toHaveLength(0);
      expect(writesTo(ops, "staging_history")).toHaveLength(0);
    });
  });

  it("allows the grant header on the preflight", async () => {
    // Without this the browser strips the header before the request is sent,
    // and the feature fails silently on every customer domain while passing
    // every server-side test in this file.
    const response = (await OPTIONS(
      new NextRequest(
        `https://www.recopyfa.st/api/staging/content/${SITE_ID}`,
        { method: "OPTIONS", headers: { Origin: MINTING_ORIGIN } },
      ),
    )) as unknown as Response;

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-RCF-Editor-Grant",
    );
  });
});

describe("PUT /api/staging/content/[siteId] — grading and attribution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("saves the change for a grant carrying edit rights", async () => {
    const grant = makeGrant();
    const { client, ops } = makeClient(siteHandler(grantRow(grant)));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await putWithGrant({ grant });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const contentWrite = writesTo(ops, "content_elements")[0];
    expect(contentWrite?.payload?.staging_content).toBe("New copy");
  });

  it("names the grant holder in staging_history, not the credential type", async () => {
    // `user_email` falls back to `access.kind` when there is no email. Landing
    // the literal string "device-grant" in the only per-edit record that can
    // name a non-account editor would make the audit trail useless for exactly
    // the caller it exists for.
    const grant = makeGrant();
    const { client, ops } = makeClient(siteHandler(grantRow(grant)));
    mockCreateServiceRoleClient.mockReturnValue(client);

    await putWithGrant({ grant });

    const history = writesTo(ops, "staging_history")[0];
    expect(history?.payload?.user_email).toBe(EDITOR_EMAIL);
    // Not attributable to any staging invite.
    expect(history?.payload?.staging_access_id).toBeNull();
  });

  it("refuses a view-only grant and writes nothing", async () => {
    const grant = makeGrant();
    const { client, ops } = makeClient(
      siteHandler(grantRow(grant, { permissions: ["view"] })),
    );
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await putWithGrant({ grant });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("edit");
    expect(writesTo(ops, "content_elements")).toHaveLength(0);
    expect(writesTo(ops, "staging_history")).toHaveLength(0);
  });

  it("refuses a grant minted for another site on this site's content route", async () => {
    // AC 2, and until the grant became a principal this could not be tested at
    // all: the editor could edit no site, so "only that site" was vacuous.
    const grant = makeGrant({
      s: OTHER_SITE_ID,
      o: hashOrigin(MINTING_ORIGIN),
    });
    const { client, ops } = makeClient(siteHandler(grantRow(grant)));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await putWithGrant({ grant });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("site_mismatch");
    expect(writesTo(ops, "content_elements")).toHaveLength(0);
  });
});

describe("POST /api/staging/publish — the device grant", () => {
  function publishWithGrant(grant: string): Promise<Response> {
    return PUBLISH(
      new NextRequest("https://www.recopyfa.st/api/staging/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          Origin: MINTING_ORIGIN,
          "X-RCF-Editor-Grant": grant,
        },
        body: JSON.stringify({ siteId: SITE_ID }),
      }),
    ) as unknown as Promise<Response>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses an edit-only grant", async () => {
    const grant = makeGrant();
    const { client } = makeClient(siteHandler(grantRow(grant)));
    const rpc = jest.fn();
    mockCreateServiceRoleClient.mockReturnValue(
      Object.assign(client, { rpc }) as ReturnType<
        typeof createServiceRoleClient
      >,
    );

    const response = await publishWithGrant(grant);

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a publish grant through, attributed to its holder", async () => {
    const grant = makeGrant();
    const { client } = makeClient(
      siteHandler(grantRow(grant, { permissions: ["publish"] })),
    );
    const rpc = jest.fn(async () => ({ data: [], error: null }));
    mockCreateServiceRoleClient.mockReturnValue(
      Object.assign(client, { rpc }) as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );

    const response = await publishWithGrant(grant);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.publishedBy).toBe(EDITOR_EMAIL);
    expect(rpc).toHaveBeenCalledWith(
      "publish_staging_content_atomic",
      expect.objectContaining({ p_user_email: EDITOR_EMAIL }),
    );
  });
});
