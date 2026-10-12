/**
 * @jest-environment node
 */

/**
 * s96 — the service-role access to `tool_reports`, against a schema-strict
 * fake: it refuses any table or column the migration does not define, and
 * records every filter, so the cache window, the expiry filter and the fixed
 * projection are asserted as calls, not assumed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CACHE_WINDOW_MS,
  createReportStore,
  ReportStoreError,
} from "../report-store";

const COLUMNS = new Set([
  "id",
  "tool",
  "cache_key",
  "url",
  "report",
  "created_at",
  "expires_at",
]);

type Call = [string, ...unknown[]];

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const checkColumns = (list: string) => {
    for (const column of list.split(",").map((part) => part.trim())) {
      if (!COLUMNS.has(column)) throw new Error(`unknown column ${column}`);
    }
  };
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "gt",
    "order",
    "limit",
    "insert",
    "single",
    "maybeSingle",
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      if (method === "select") checkColumns(args[0] as string);
      if (method === "eq" || method === "gt" || method === "order") {
        if (!COLUMNS.has(args[0] as string))
          throw new Error(`unknown column ${String(args[0])}`);
      }
      if (method === "insert") {
        for (const key of Object.keys(args[0] as object)) {
          if (!COLUMNS.has(key)) throw new Error(`unknown column ${key}`);
        }
      }
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  const client = {
    from(table: string) {
      if (table !== "tool_reports")
        throw new Error(`unexpected table ${table}`);
      calls.push(["from", table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const NOW = new Date("2026-10-11T12:00:00.000Z");
const ID = "6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c";

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("findCachedReportId", () => {
  it("asks for the newest unexpired row of the last 24 h for this key", async () => {
    const { client, calls } = fakeClient({ data: [{ id: ID }], error: null });

    const id = await createReportStore(client).findCachedReportId(
      "a".repeat(64),
      NOW,
    );

    expect(id).toBe(ID);
    expect(calls).toEqual([
      ["from", "tool_reports"],
      ["select", "id"],
      ["eq", "cache_key", "a".repeat(64)],
      [
        "gt",
        "created_at",
        new Date(NOW.getTime() - CACHE_WINDOW_MS).toISOString(),
      ],
      ["gt", "expires_at", NOW.toISOString()],
      ["order", "created_at", { ascending: false }],
      ["limit", 1],
    ]);
    expect(CACHE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("answers null on a miss", async () => {
    const { client } = fakeClient({ data: [], error: null });

    expect(
      await createReportStore(client).findCachedReportId("b".repeat(64), NOW),
    ).toBeNull();
  });

  it("surfaces a database error as ReportStoreError, with no database text", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "PGRST000", message: "secret detail" },
    });

    await expect(
      createReportStore(client).findCachedReportId("c".repeat(64), NOW),
    ).rejects.toEqual(new ReportStoreError("cache lookup"));
  });
});

describe("insertReport", () => {
  it("writes the four columns and returns the new id", async () => {
    const { client, calls } = fakeClient({ data: { id: ID }, error: null });

    const id = await createReportStore(client).insertReport({
      tool: "website-spell-checker",
      cacheKey: "d".repeat(64),
      url: "https://example.com/",
      report: { v: 1 },
    });

    expect(id).toBe(ID);
    expect(calls).toEqual([
      ["from", "tool_reports"],
      [
        "insert",
        {
          tool: "website-spell-checker",
          cache_key: "d".repeat(64),
          url: "https://example.com/",
          report: { v: 1 },
        },
      ],
      ["select", "id"],
      ["single"],
    ]);
  });

  it("surfaces an insert error", async () => {
    const { client } = fakeClient({ data: null, error: { code: "23514" } });

    await expect(
      createReportStore(client).insertReport({
        tool: "t",
        cacheKey: "e".repeat(64),
        url: "https://e.test/",
        report: {},
      }),
    ).rejects.toBeInstanceOf(ReportStoreError);
  });
});

describe("getReportById", () => {
  it("reads one unexpired row by id with the fixed projection", async () => {
    const { client, calls } = fakeClient({
      data: {
        id: ID,
        tool: "website-spell-checker",
        report: { v: 1 },
        created_at: "2026-10-11T11:00:00Z",
        expires_at: "2026-11-10T11:00:00Z",
      },
      error: null,
    });

    const row = await createReportStore(client).getReportById(ID, NOW);

    expect(row).toEqual({
      id: ID,
      tool: "website-spell-checker",
      report: { v: 1 },
      createdAt: "2026-10-11T11:00:00Z",
      expiresAt: "2026-11-10T11:00:00Z",
    });
    expect(calls).toEqual([
      ["from", "tool_reports"],
      ["select", "id, tool, report, created_at, expires_at"],
      ["eq", "id", ID],
      ["gt", "expires_at", NOW.toISOString()],
      ["maybeSingle"],
    ]);
  });

  it("answers null for an unknown or expired id", async () => {
    const { client } = fakeClient({ data: null, error: null });

    expect(await createReportStore(client).getReportById(ID, NOW)).toBeNull();
  });

  it("throws on a read error", async () => {
    const { client } = fakeClient({ data: null, error: { code: "XX000" } });

    await expect(
      createReportStore(client).getReportById(ID, NOW),
    ).rejects.toBeInstanceOf(ReportStoreError);
  });
});
