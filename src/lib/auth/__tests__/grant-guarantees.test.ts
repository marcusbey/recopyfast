/**
 * The three properties a grant has to keep, now that it authorises writes.
 *
 * Every one of these is true today and every one is a single careless edit from
 * being false — and what a false one costs is somebody else's live site
 * defaced with our credentials. They were untestable as *criteria* until s14a,
 * because a grant authorised nothing: "not reusable across sites" is not a
 * property worth asserting about a token that cannot be used on any site.
 *
 *   1. Not guessable — the handoff code is a 32-byte CSPRNG secret, stored only
 *      as a hash, dead in sixty seconds. A wrong code costs exactly the
 *      rejection an unknown one costs.
 *   2. Not reusable across sites — the site is re-pinned at redemption, and
 *      again in the signed grant payload. (The route-level half of this is in
 *      `src/__tests__/api/staging/content-device-grant.test.ts`, which is AC 2
 *      proper: a grant minted for site A refused on site B's content route.)
 *   3. Not valid after somebody else redeems it — the code is consumed by a
 *      conditional update BEFORE the grant is minted, so two racers produce
 *      exactly one grant.
 */

// Must precede the imports: editor-crypto memoises the signing key on first use.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  createHandoff,
  redeemHandoff,
  HANDOFF_TTL_MS,
} from "../editor-handoff";
import { hashOpaqueSecret, resetSigningKeyCache } from "../editor-crypto";
import type { DeviceContext } from "../editor-grants";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service");

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const SITE_ID = "site-abc";
const OTHER_SITE_ID = "site-xyz";
const EDITOR_ID = "site-editor-1";
const DEVICE: DeviceContext = {
  origin: "https://helloworld.example",
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
  ip: null,
};

interface Op {
  table: string;
  kind: "select" | "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

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

function handoffRow(code: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "handoff-1",
    code_hash: hashOpaqueSecret(code),
    remember_device: true,
    expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
    consumed_at: null,
    site_editor_id: EDITOR_ID,
    site_editors: {
      id: EDITOR_ID,
      site_id: SITE_ID,
      email: "bob@corp.example",
      permissions: ["edit"],
      revoked_at: null,
    },
    ...overrides,
  };
}

describe("a grant is not guessable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("mints a high-entropy code and stores only its hash", async () => {
    const { client, ops } = makeClient(() => ({ data: null, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const code = await createHandoff({
      siteEditorId: EDITOR_ID,
      rememberDevice: true,
    });

    expect(code).not.toBeNull();
    // 32 CSPRNG bytes, base64url — not a 6-digit number anyone can walk.
    expect(code!.length).toBeGreaterThanOrEqual(40);

    const insert = ops.find((op) => op.kind === "insert");
    expect(insert?.payload?.code_hash).toBe(hashOpaqueSecret(code!));
    // A dump of the table yields nothing presentable.
    expect(JSON.stringify(insert?.payload)).not.toContain(code!);

    const ttl = Date.parse(String(insert?.payload?.expires_at)) - Date.now();
    expect(ttl).toBeLessThanOrEqual(HANDOFF_TTL_MS + 1000);
    expect(ttl).toBeGreaterThan(0);
  });

  it("refuses a wrong code exactly as it refuses an unknown one", async () => {
    // Both land on the same lookup-by-hash miss and the same reason. A branch
    // that distinguished them would tell an attacker when a guess was close.
    const { client, ops } = makeClient(() => ({ data: null, error: null }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const wrong = await redeemHandoff({
      code: "not-the-code",
      siteId: SITE_ID,
      device: DEVICE,
    });
    const unknown = await redeemHandoff({
      code: "also-not-the-code",
      siteId: SITE_ID,
      device: DEVICE,
    });

    expect(wrong).toEqual({ ok: false, reason: "unknown" });
    expect(unknown).toEqual(wrong);

    // Looked up by hash, never by the plaintext secret.
    for (const op of ops) {
      for (const [column, value] of op.filters) {
        expect(column).not.toBe("code");
        expect(value).not.toBe("not-the-code");
      }
    }
  });

  it("refuses a code that has aged past its sixty seconds", async () => {
    const code = "a-code";
    const { client } = makeClient(() => ({
      data: handoffRow(code, {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
      error: null,
    }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    await expect(
      redeemHandoff({ code, siteId: SITE_ID, device: DEVICE }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });
});

describe("a grant is not reusable across sites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses to redeem a code on a site its editor row does not belong to", async () => {
    const code = "a-code";
    const { client, ops } = makeClient(() => ({
      data: handoffRow(code),
      error: null,
    }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await redeemHandoff({
      code,
      siteId: OTHER_SITE_ID,
      device: DEVICE,
    });

    expect(result).toEqual({ ok: false, reason: "site_mismatch" });
    // Refused before the code was spent, so the real link still works.
    expect(ops.some((op) => op.kind === "update")).toBe(false);
    expect(ops.some((op) => op.kind === "insert")).toBe(false);
  });

  it("pins the minted grant to the editor's own site, not the caller's claim", async () => {
    const code = "a-code";
    const { client, ops } = makeClient((op) => {
      if (op.table === "editor_handoffs") {
        return op.kind === "select"
          ? { data: handoffRow(code), error: null }
          : { data: [{ id: "handoff-1" }], error: null };
      }
      if (op.kind === "insert") return { data: { id: "grant-1" }, error: null };
      return { data: null, error: null };
    });
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await redeemHandoff({
      code,
      siteId: SITE_ID,
      device: DEVICE,
    });

    expect(result.ok).toBe(true);
    const grantInsert = ops.find(
      (op) => op.table === "editor_device_grants" && op.kind === "insert",
    );
    expect(grantInsert?.payload?.site_editor_id).toBe(EDITOR_ID);
  });
});

describe("a grant is not valid after somebody else redeems it", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("produces exactly one grant when two callers race on the same code", async () => {
    const code = "a-code";
    let consumed = false;

    const { client, ops } = makeClient((op) => {
      if (op.table === "editor_handoffs") {
        if (op.kind === "select") {
          // Both racers read the row before either consumed it — which is the
          // whole point: the read cannot be the serialisation point.
          return { data: handoffRow(code), error: null };
        }
        if (consumed) return { data: [], error: null };
        consumed = true;
        return { data: [{ id: "handoff-1" }], error: null };
      }
      if (op.kind === "insert") return { data: { id: "grant-1" }, error: null };
      return { data: null, error: null };
    });
    mockCreateServiceRoleClient.mockReturnValue(client);

    const [first, second] = await Promise.all([
      redeemHandoff({ code, siteId: SITE_ID, device: DEVICE }),
      redeemHandoff({ code, siteId: SITE_ID, device: DEVICE }),
    ]);

    const outcomes = [first.ok, second.ok].sort();
    expect(outcomes).toEqual([false, true]);
    expect(first.ok ? second : first).toEqual({
      ok: false,
      reason: "consumed",
    });

    // One winner, one grant. Consuming after minting would have produced two.
    expect(
      ops.filter(
        (op) => op.table === "editor_device_grants" && op.kind === "insert",
      ),
    ).toHaveLength(1);
  });

  it("refuses a code that was already spent", async () => {
    const code = "a-code";
    const { client, ops } = makeClient(() => ({
      data: handoffRow(code, { consumed_at: new Date().toISOString() }),
      error: null,
    }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    await expect(
      redeemHandoff({ code, siteId: SITE_ID, device: DEVICE }),
    ).resolves.toEqual({ ok: false, reason: "consumed" });
    expect(ops.some((op) => op.kind === "insert")).toBe(false);
  });

  it("refuses a code whose editor was revoked between issue and redemption", async () => {
    const code = "a-code";
    const { client } = makeClient(() => ({
      data: handoffRow(code, {
        site_editors: {
          id: EDITOR_ID,
          site_id: SITE_ID,
          email: "bob@corp.example",
          permissions: ["edit"],
          revoked_at: new Date().toISOString(),
        },
      }),
      error: null,
    }));
    mockCreateServiceRoleClient.mockReturnValue(client);

    await expect(
      redeemHandoff({ code, siteId: SITE_ID, device: DEVICE }),
    ).resolves.toEqual({ ok: false, reason: "editor_revoked" });
  });
});
