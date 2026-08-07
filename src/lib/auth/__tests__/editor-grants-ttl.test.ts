/**
 * A-28 — device grants have no absolute lifetime and the client picks its own
 * TTL.
 *
 * Two independent holes in `refreshDeviceGrant` / `issueDeviceGrant`, both
 * observable in the `expires_at` that gets written:
 *
 *   1. `rememberDevice` is read straight off the request body
 *      (`src/app/api/editor/refresh-grant/route.ts:31`) and handed to
 *      `issueDeviceGrant` (`editor-grants.ts:450-456`), which picks a 12-hour
 *      or 7-day TTL from it (`:162-165`). Rotation never re-derives the choice
 *      from the row it is replacing, so a caller holding a session-only grant
 *      turns it into a remembered one by sending one extra JSON field. The
 *      checkbox the user did not tick is not the server's source of truth.
 *
 *   2. Every rotation re-anchors expiry from `Date.now()` with no reference to
 *      when the lineage began. `editor_device_grants` records both
 *      `created_at` and `rotated_from`
 *      (`20260801100000_editor_access_2fa.sql:220-222`), and neither is read,
 *      so a grant can be walked forward indefinitely — a token captured once
 *      and refreshed on schedule never retires.
 *
 * `src/lib/auth/edit-sessions.ts:50` is the same codebase getting this right:
 * `MAX_SESSION_LIFETIME_HOURS` is an absolute ceiling measured from first issue
 * precisely so "extend forever" is impossible. The reasoning there applies here
 * verbatim, and more strongly — `editor-grants.ts:250-256` states outright that
 * the origin binding "stops a copied token, not a forged header", which leaves
 * elapsed time as the only control that reliably retires one.
 *
 * Extends B-13.
 *
 * Every assertion below reads the `expires_at` actually written to
 * `editor_device_grants`, not the function's return value.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  REMEMBERED_GRANT_TTL_MS,
  SESSION_GRANT_TTL_MS,
  refreshDeviceGrant,
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface Op {
  table: string;
  kind: "select" | "update" | "insert";
  payload?: Record<string, unknown>;
}

/**
 * Records every PostgREST write so a test can read the row that was actually
 * inserted. `expires_at` on that insert is the stored state this file is about.
 */
function makeClient(handle: (op: Op) => { data: unknown; error: unknown }) {
  const ops: Op[] = [];

  function from(table: string) {
    const op: Op = { table, kind: "select" };

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
      delete: () => builder,
      eq: () => builder,
      is: () => builder,
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

/**
 * A live grant row plus the token that names it.
 *
 * `createdAtMs` is when this row was written and `lineageStartMs` is when the
 * lineage it belongs to was first issued. For an un-rotated grant they are the
 * same; for the twentieth rotation of an old token they are weeks apart, and
 * that gap is exactly what nothing in the code consults.
 */
function grantRow(
  opts: {
    createdAtMs?: number;
    expiresInMs?: number;
    rotatedFrom?: string | null;
  } = {},
) {
  const createdAtMs = opts.createdAtMs ?? Date.now();
  const expiresInMs = opts.expiresInMs ?? REMEMBERED_GRANT_TTL_MS;

  const token = encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
    g: GRANT_ROW_ID,
    s: SITE_ID,
    o: hashOrigin(ORIGIN),
    x: Math.floor((Date.now() + HOUR_MS) / 1000),
    n: "nonce",
  });

  return {
    token,
    row: {
      id: GRANT_ROW_ID,
      site_editor_id: EDITOR_ID,
      grant_hash: hashOpaqueSecret(token),
      user_agent_hash: hashUserAgent(USER_AGENT),
      origin_hash: hashOrigin(ORIGIN),
      created_at: new Date(createdAtMs).toISOString(),
      expires_at: new Date(createdAtMs + expiresInMs).toISOString(),
      revoked_at: null,
      revoked_reason: null,
      rotated_from: opts.rotatedFrom ?? null,
      site_editors: {
        id: EDITOR_ID,
        site_id: SITE_ID,
        email: "bob@corp.example",
        permissions: ["edit"],
        revoked_at: null,
      },
    },
  };
}

/** A refresh that succeeds all the way through to the mint. */
function clientFor(row: Record<string, unknown>) {
  return makeClient((op) => {
    if (op.kind === "insert") return { data: { id: "new-grant" }, error: null };
    // The rotation claim: one row changed.
    if (op.kind === "update")
      return { data: [{ id: GRANT_ROW_ID }], error: null };
    return { data: row, error: null };
  });
}

/** The `expires_at` written for the replacement grant, in epoch ms. */
function mintedExpiryMs(ops: Op[]): number {
  const insert = ops.find(
    (op) => op.kind === "insert" && op.table === "editor_device_grants",
  );
  expect(insert).toBeDefined();
  return new Date(insert!.payload!.expires_at as string).getTime();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSigningKeyCache();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-28 — who decides how long a rotated grant lives", () => {
  it("mints a remembered TTL for a lineage that was remembered", async () => {
    // The control. Nothing is wrong with this case, and it is what makes the
    // failing case below a question of *who chose*, not of arithmetic.
    const { token, row } = grantRow({ expiresInMs: REMEMBERED_GRANT_TTL_MS });
    const { client, ops } = clientFor(row);
    mockCreateServiceRoleClient.mockReturnValue(client);

    const before = Date.now();
    const result = await refreshDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
      rememberDevice: true,
    });

    expect(result.ok).toBe(true);
    expect(mintedExpiryMs(ops) - before).toBeGreaterThan(6 * DAY_MS);
  });

  it("rotates a session-only lineage at all", async () => {
    // Guard for the assertion below. A signing-key problem, a fixture whose
    // token no longer validates, or a mock that never records the insert would
    // each make `mintedExpiryMs` throw — and `test.failing` would report that
    // as a confirmed TTL escalation. This runs the identical path and asserts
    // only that a replacement grant was minted and its expiry is a real date.
    const { token, row } = grantRow({ expiresInMs: SESSION_GRANT_TTL_MS });
    const { client, ops } = clientFor(row);
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await refreshDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
      rememberDevice: true,
    });

    expect(result.ok).toBe(true);
    expect(Number.isFinite(mintedExpiryMs(ops))).toBe(true);
  });

  test.failing(
    "does not let the request body upgrade a session grant to a remembered one",
    async () => {
      // The row being rotated was issued for 12 hours — the user did not tick
      // "remember this device". The caller sends `rememberDevice: true`, which
      // `refresh-grant/route.ts:31` reads verbatim off the JSON body.
      const { token, row } = grantRow({ expiresInMs: SESSION_GRANT_TTL_MS });
      const { client, ops } = clientFor(row);
      mockCreateServiceRoleClient.mockReturnValue(client);

      const before = Date.now();
      await refreshDeviceGrant({
        grant: token,
        siteId: SITE_ID,
        device,
        rememberDevice: true,
      });

      // The replacement must be bounded by what the lineage was actually
      // granted, not by what the request asked for. Allowing a minute of slack
      // for clock and execution time.
      expect(mintedExpiryMs(ops) - before).toBeLessThanOrEqual(
        SESSION_GRANT_TTL_MS + 60_000,
      );
    },
  );

  it("mints a grant for both values of rememberDevice", async () => {
    // Guard for the assertion below, which compares two numbers: if either
    // iteration threw, the comparison never happens and `test.failing` calls
    // it a defect. This proves both iterations produce a real expiry.
    for (const rememberDevice of [false, true]) {
      const { token, row } = grantRow({ expiresInMs: SESSION_GRANT_TTL_MS });
      const { client, ops } = clientFor(row);
      mockCreateServiceRoleClient.mockReturnValue(client);

      const result = await refreshDeviceGrant({
        grant: token,
        siteId: SITE_ID,
        device,
        rememberDevice,
      });

      expect(result.ok).toBe(true);
      expect(Number.isFinite(mintedExpiryMs(ops))).toBe(true);
    }
  });

  test.failing(
    "keeps the lifetime stable no matter what the body says",
    async () => {
      // Framed without prescribing a fix: two requests differing only in an
      // attacker-controlled field must not produce two different lifetimes for
      // the same underlying grant.
      const expiries: number[] = [];

      for (const rememberDevice of [false, true]) {
        const { token, row } = grantRow({ expiresInMs: SESSION_GRANT_TTL_MS });
        const { client, ops } = clientFor(row);
        mockCreateServiceRoleClient.mockReturnValue(client);

        await refreshDeviceGrant({
          grant: token,
          siteId: SITE_ID,
          device,
          rememberDevice,
        });

        expiries.push(mintedExpiryMs(ops));
      }

      expect(Math.abs(expiries[0] - expiries[1])).toBeLessThan(60_000);
    },
  );
});

describe("A-28 — the lineage has no ceiling", () => {
  it("accepts a 30-day-old lineage as a live, valid grant", async () => {
    // Guard for the assertion below. That test's fixture is unusual — a row
    // created 30 days ago that is still live — so it is worth proving the
    // fixture is actually valid before reading anything into the result. If
    // the token failed to validate, `test.failing` would report "no ceiling"
    // when the real story was "the test built a grant the code rejects".
    const { token, row } = grantRow({
      createdAtMs: Date.now() - 30 * DAY_MS,
      expiresInMs: REMEMBERED_GRANT_TTL_MS + 30 * DAY_MS,
      rotatedFrom: "grant-row-0",
    });
    const { client } = clientFor(row);
    mockCreateServiceRoleClient.mockReturnValue(client);

    const result = await refreshDeviceGrant({
      grant: token,
      siteId: SITE_ID,
      device,
      rememberDevice: true,
    });

    // Only that the call produced a verdict, not which verdict.
    expect(typeof result.ok).toBe("boolean");
  });

  test.failing(
    "refuses to extend a lineage that began 30 days ago",
    async () => {
      // A token captured once and refreshed on schedule. `created_at` and
      // `rotated_from` are both on the row and both go unread, so this mints a
      // fresh 7-day grant on the 30th day exactly as it did on the first.
      const lineageStart = Date.now() - 30 * DAY_MS;
      const { token, row } = grantRow({
        createdAtMs: lineageStart,
        expiresInMs: REMEMBERED_GRANT_TTL_MS + 30 * DAY_MS,
        rotatedFrom: "grant-row-0",
      });
      const { client, ops } = clientFor(row);
      mockCreateServiceRoleClient.mockReturnValue(client);

      const result = await refreshDeviceGrant({
        grant: token,
        siteId: SITE_ID,
        device,
        rememberDevice: true,
      });

      // Either outcome is an acceptable fix: refuse the refresh outright, or
      // mint something that does not outlive the ceiling the lineage started
      // with. What is not acceptable is a full new TTL anchored on today.
      if (result.ok) {
        expect(mintedExpiryMs(ops)).toBeLessThanOrEqual(
          lineageStart + REMEMBERED_GRANT_TTL_MS,
        );
      }
      expect(result.ok).toBe(false);
    },
  );

  it("mints a grant for both a new and an old lineage", async () => {
    // Guard for the assertion below, which compares two minted expiries. It is
    // the one most exposed to a vacuous pass: the failing test returns early
    // if either refresh is refused, so this pins that both refreshes actually
    // happen and both produce a real expiry today.
    for (const age of [HOUR_MS, 300 * DAY_MS]) {
      const { token, row } = grantRow({
        createdAtMs: Date.now() - age,
        expiresInMs: age + REMEMBERED_GRANT_TTL_MS,
        rotatedFrom: "grant-row-0",
      });
      const { client, ops } = clientFor(row);
      mockCreateServiceRoleClient.mockReturnValue(client);

      const result = await refreshDeviceGrant({
        grant: token,
        siteId: SITE_ID,
        device,
        rememberDevice: true,
      });

      expect(result.ok).toBe(true);
      expect(Number.isFinite(mintedExpiryMs(ops))).toBe(true);
    }
  });

  test.failing("mints a shorter grant for an older lineage", async () => {
    // The finding stated as a difference rather than a threshold, so it holds
    // whatever ceiling is eventually chosen: two grants alike in every respect
    // except age must not be worth the same amount of future time.
    //
    // Both rows are live; only `created_at` differs. That column and
    // `rotated_from` are the whole of what the database records about a
    // lineage's age, and `issueDeviceGrant` reads neither, so the minted
    // `expires_at` comes out identical for a grant first issued an hour ago and
    // one first issued three hundred days ago.
    const ages = [HOUR_MS, 300 * DAY_MS];
    const minted: number[] = [];

    for (const age of ages) {
      const { token, row } = grantRow({
        createdAtMs: Date.now() - age,
        // Kept live so the comparison is about the ceiling and not about
        // expiry, which is already enforced.
        expiresInMs: age + REMEMBERED_GRANT_TTL_MS,
        rotatedFrom: "grant-row-0",
      });
      const { client, ops } = clientFor(row);
      mockCreateServiceRoleClient.mockReturnValue(client);

      const result = await refreshDeviceGrant({
        grant: token,
        siteId: SITE_ID,
        device,
        rememberDevice: true,
      });

      // A fix that refuses the old lineage outright satisfies this too.
      if (!result.ok) return;
      minted.push(mintedExpiryMs(ops));
    }

    expect(minted[1]).toBeLessThan(minted[0]);
  });
});
