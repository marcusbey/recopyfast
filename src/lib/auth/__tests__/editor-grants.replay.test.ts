/**
 * Regression tests for the grant replay response and rotation serialisation.
 *
 * P1-4: presenting a superseded token used to revoke EVERY grant for that
 * editor. That fires during ordinary use (a throttled tab, a resumed laptop)
 * and is triggerable at will by anyone holding one already-useless token, which
 * made it a denial-of-service primitive rather than a defence. The bar these
 * tests hold: a late replay kills that one token and nothing else.
 *
 * P3-11: refresh was validate -> mint -> revoke, none of it serialised, so two
 * tabs refreshing together both minted and the lineage forked.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  GRANT_ROTATION_GRACE_MS,
  nextActionFor,
  refreshDeviceGrant,
  revokeAllGrantsForEditor,
  validateDeviceGrant,
  type DeviceContext,
} from "../editor-grants";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  resetSigningKeyCache,
} from "../editor-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service");

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const SITE_ID = "site-123";
const EDITOR_ID = "editor-1";
const GRANT_ROW_ID = "grant-row-1";
const ORIGIN = "https://customer.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";

const device: DeviceContext = {
  origin: ORIGIN,
  userAgent: USER_AGENT,
  ip: null,
};

function makeGrantToken(overrides: Partial<Record<string, unknown>> = {}) {
  return encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
    g: GRANT_ROW_ID,
    s: SITE_ID,
    o: hashOrigin(ORIGIN),
    x: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    n: "nonce",
    ...overrides,
  });
}

interface Op {
  table: string;
  kind: "select" | "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

/**
 * Records every PostgREST operation so a test can assert on what was NOT done —
 * which is the whole point here: no lineage-wide sweep, no second mint.
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

function grantRow(overrides: Record<string, unknown> = {}) {
  const token = makeGrantToken();
  return {
    token,
    row: {
      id: GRANT_ROW_ID,
      site_editor_id: EDITOR_ID,
      grant_hash: hashOpaqueSecret(token),
      user_agent_hash: hashUserAgent(USER_AGENT),
      origin_hash: hashOrigin(ORIGIN),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      revoked_at: null,
      revoked_reason: null,
      site_editors: {
        id: EDITOR_ID,
        site_id: SITE_ID,
        email: "bob@corp.example",
        permissions: ["edit"],
        revoked_at: null,
      },
      ...overrides,
    },
  };
}

/** A bulk revoke is recognisable by filtering on the parent editor, not one row id. */
function lineageSweeps(ops: Op[]) {
  return ops.filter(
    (op) =>
      op.kind === "update" &&
      op.table === "editor_device_grants" &&
      op.filters.some(([column]) => column === "site_editor_id"),
  );
}

describe("validateDeviceGrant — replay response", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a token superseded moments ago (sibling tab mid-refresh)", async () => {
    const { token, row } = grantRow({
      revoked_at: new Date(Date.now() - 5_000).toISOString(),
      revoked_reason: "rotated",
    });
    const { client } = makeClient(() => ({ data: row, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await validateDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
    });

    expect(result.valid).toBe(true);
  });

  it("accepts a tab that was backgrounded for 90 seconds", async () => {
    // The exact self-inflicted scenario: two tabs, one refreshes, the other
    // wakes after timer throttling. Under the old 60s grace this signed the
    // user out everywhere.
    const { token, row } = grantRow({
      revoked_at: new Date(Date.now() - 90_000).toISOString(),
      revoked_reason: "rotated",
    });
    const { client, ops } = makeClient(() => ({ data: row, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await validateDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
    });

    expect(result.valid).toBe(true);
    expect(lineageSweeps(ops)).toHaveLength(0);
  });

  it("refuses a token superseded beyond the grace window", async () => {
    const { token, row } = grantRow({
      revoked_at: new Date(
        Date.now() - GRANT_ROTATION_GRACE_MS - 60_000,
      ).toISOString(),
      revoked_reason: "rotated",
    });
    const { client } = makeClient(() => ({ data: row, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await validateDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
    });

    expect(result).toEqual({ valid: false, reason: "replayed" });
  });

  it("does NOT revoke the editor's other grants on a late replay", async () => {
    // The P1-4 regression. If this fails, a single unauthenticated request
    // carrying a stale token signs an editor out of every device again.
    const { token, row } = grantRow({
      revoked_at: new Date(
        Date.now() - GRANT_ROTATION_GRACE_MS - 60_000,
      ).toISOString(),
      revoked_reason: "rotated",
    });
    const { client, ops } = makeClient(() => ({ data: row, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    await validateDeviceGrant({ grant: token, siteId: SITE_ID, device });

    expect(lineageSweeps(ops)).toHaveLength(0);
  });

  it("stays destructive-free even when replayed repeatedly", async () => {
    // An attacker looping the same stale token must not accumulate into a sweep.
    const { token, row } = grantRow({
      revoked_at: new Date(
        Date.now() - GRANT_ROTATION_GRACE_MS - 60_000,
      ).toISOString(),
      revoked_reason: "rotated",
    });
    const { client, ops } = makeClient(() => ({ data: row, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await validateDeviceGrant({
        grant: token,
        siteId: SITE_ID,
        device,
      });
      expect(result).toEqual({ valid: false, reason: "replayed" });
    }

    expect(lineageSweeps(ops)).toHaveLength(0);
  });

  it("still refuses a grant revoked for a reason other than rotation", async () => {
    const { token, row } = grantRow({
      revoked_at: new Date().toISOString(),
      revoked_reason: "manual",
    });
    const { client } = makeClient(() => ({ data: row, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await validateDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
    });

    expect(result).toEqual({ valid: false, reason: "revoked" });
  });
});

describe("lineageSweeps detector", () => {
  // Guards the assertions above. If this helper could not see a sweep, every
  // "expect(lineageSweeps(ops)).toHaveLength(0)" would pass vacuously and the
  // regression could return unnoticed.
  it("detects a real lineage-wide revoke", async () => {
    const { client, ops } = makeClient(() => ({
      data: [{ id: "a" }, { id: "b" }],
      error: null,
    }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const killed = await revokeAllGrantsForEditor(EDITOR_ID, "manual");

    expect(killed).toBe(2);
    expect(lineageSweeps(ops)).toHaveLength(1);
  });
});

describe("nextActionFor", () => {
  it("sends a replayed token to refresh, not to a code prompt", () => {
    expect(nextActionFor("replayed")).toBe("refresh");
    expect(nextActionFor("raced")).toBe("refresh");
  });

  it("still hides the editor UI when access is genuinely gone", () => {
    expect(nextActionFor("editor_revoked")).toBe("hide");
    expect(nextActionFor("site_mismatch")).toBe("hide");
  });

  it("still asks for a code when the credential is unusable", () => {
    expect(nextActionFor("expired")).toBe("verify");
    expect(nextActionFor("device_mismatch")).toBe("verify");
  });
});

describe("refreshDeviceGrant — rotation is serialised", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("mints exactly once for the caller that wins the claim", async () => {
    const { token, row } = grantRow();
    const { client, ops } = makeClient((op) => {
      if (op.kind === "insert") {
        return { data: { id: "new-grant" }, error: null };
      }
      if (op.kind === "update") {
        // Claim succeeds: one row changed.
        return { data: [{ id: GRANT_ROW_ID }], error: null };
      }
      return { data: row, error: null };
    });
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await refreshDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
      rememberDevice: false,
    });

    expect(result.ok).toBe(true);
    expect(ops.filter((op) => op.kind === "insert")).toHaveLength(1);
  });

  it("does not mint for the caller that loses the claim", async () => {
    // The P3-11 regression: previously both concurrent refreshes minted,
    // forking the lineage into two live grants from one token.
    const { token, row } = grantRow();
    const { client, ops } = makeClient((op) => {
      if (op.kind === "update") {
        const isClaim = op.payload?.revoked_reason === "rotated";
        // Claim loses: the sibling already rotated this row, zero rows match.
        if (isClaim) return { data: [], error: null };
        return { data: null, error: null };
      }
      return { data: row, error: null };
    });
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await refreshDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
      rememberDevice: false,
    });

    expect(result).toEqual({ ok: false, reason: "raced" });
    expect(ops.filter((op) => op.kind === "insert")).toHaveLength(0);
  });

  it("restores the old grant when minting fails after the claim", async () => {
    // Without the rollback the holder is left with a token we just superseded
    // and no replacement — locked out of a session they were entitled to keep.
    const { token, row } = grantRow();
    const { client, ops } = makeClient((op) => {
      if (op.kind === "insert") {
        return { data: null, error: { message: "insert failed" } };
      }
      if (op.kind === "update") {
        return { data: [{ id: GRANT_ROW_ID }], error: null };
      }
      return { data: row, error: null };
    });
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await refreshDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
      rememberDevice: false,
    });

    expect(result).toEqual({ ok: false, reason: "error" });

    const rollback = ops.find(
      (op) => op.kind === "update" && op.payload?.revoked_at === null,
    );
    expect(rollback).toBeDefined();
    expect(rollback?.payload?.revoked_reason).toBeNull();
  });
});
