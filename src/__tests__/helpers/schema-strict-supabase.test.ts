/**
 * @jest-environment node
 */

/**
 * s44 — the database double that would have caught the v1 rate limiter.
 *
 * `/api/v1/content` refused every request in production, from the day it
 * shipped: its limiter read `api_keys.rate_limit` and counted `rate_limits` by
 * `key` and `timestamp`, and no schema this repository ever had contains any of
 * the three. PostgREST answered each query with 42703, the limiter took the
 * error for "over the limit", and a freshly created key's first call got a 429.
 *
 * The suite guarding that limiter stayed green throughout, because its stub
 * answered any query on any column — and its key fixture even carried a
 * `rate_limit` value production does not have. A double is only a guard if it
 * can say "no such column". This one derives every table's columns from
 * `supabase/migrations/` and answers an unknown column the way PostgREST does.
 *
 * The column lists below are production's, as queried live by the operator on
 * 2026-09-25. They anchor the migration reader: if it ever disagrees with what
 * production actually has, it is the reader that is wrong.
 */

import { migrationColumns } from "./migration-columns";
import { createSchemaStrictDatabase } from "./schema-strict-supabase";

const PRODUCTION_RATE_LIMITS_COLUMNS = [
  "id",
  "identifier",
  "identifier_type",
  "requests_count",
  "window_start",
  "window_size_minutes",
  "limit_per_window",
  "created_at",
  "updated_at",
];

/** `COLUMN_ALLOWLISTS.api_keys` in src/__tests__/db/column-privileges.test.ts, plus the secret. */
const PRODUCTION_API_KEYS_COLUMNS = [
  "id",
  "user_id",
  "name",
  "key_hash",
  "key_prefix",
  "scopes",
  "rate_limit_per_minute",
  "is_active",
  "last_used_at",
  "expires_at",
  "created_at",
  "updated_at",
  "site_id",
];

const KEY_ROW = {
  id: "key-1",
  user_id: "user-1",
  site_id: "site-1",
  name: "CI",
  key_hash: "hash-1",
  key_prefix: "rcp_abcdef12",
  scopes: ["read"],
  rate_limit_per_minute: 100,
  is_active: true,
};

function sorted(columns: Iterable<string>): string[] {
  return [...columns].sort();
}

describe("columns derived from the migrations", () => {
  it("reads rate_limits exactly as production has it", () => {
    expect(sorted(migrationColumns("rate_limits") ?? [])).toEqual(
      sorted(PRODUCTION_RATE_LIMITS_COLUMNS),
    );
  });

  it("reads api_keys as production has it, including the later site_id", () => {
    expect(sorted(migrationColumns("api_keys") ?? [])).toEqual(
      sorted(PRODUCTION_API_KEYS_COLUMNS),
    );
  });

  it("follows ALTER TABLE … ADD COLUMN across files", () => {
    const columns = migrationColumns("content_elements");

    // 20251230000000_staging_workflow.sql and 20260924030000_content_page_path.sql
    expect(columns).toEqual(expect.any(Set));
    expect(columns?.has("published_content")).toBe(true);
    expect(columns?.has("page_path")).toBe(true);
    expect(columns?.has("current_content")).toBe(true);
  });

  it("knows no table that no migration creates", () => {
    expect(migrationColumns("no_such_table")).toBeUndefined();
  });
});

describe("the schema-strict database double", () => {
  it("refuses the column the old limiter read from api_keys", async () => {
    const db = createSchemaStrictDatabase();
    db.seed("api_keys", [KEY_ROW]);

    const { data, error } = await db.client
      .from("api_keys")
      .select("rate_limit, rate_limit_per_minute, is_active")
      .eq("id", "key-1")
      .single();

    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "42703" });
    expect(error?.message).toContain("rate_limit");
  });

  it("refuses the old limiter's count on rate_limits", async () => {
    const db = createSchemaStrictDatabase();

    const { count, error } = await db.client
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("key", "api_key:key-1")
      .gte("timestamp", new Date(0).toISOString());

    expect(count).toBeNull();
    expect(error).toMatchObject({ code: "42703" });
  });

  it("refuses the old limiter's insert and writes nothing", async () => {
    const db = createSchemaStrictDatabase();

    const { error } = await db.client
      .from("rate_limits")
      .insert({ key: "api_key:key-1", timestamp: new Date(0).toISOString() });

    expect(error).toMatchObject({ code: "PGRST204" });
    expect(db.rows("rate_limits")).toEqual([]);
  });

  it("refuses a fixture that seeds a column the table does not have", () => {
    const db = createSchemaStrictDatabase();

    expect(() =>
      db.seed("api_keys", [{ ...KEY_ROW, rate_limit: 1000 }]),
    ).toThrow(/rate_limit/);
  });

  it("answers a table no migration creates as PostgREST does", async () => {
    const db = createSchemaStrictDatabase();

    const { data, error } = await db.client.from("no_such_table").select("*");

    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "42P01" });
  });

  it("serves real columns with filters, projection and single rows", async () => {
    const db = createSchemaStrictDatabase();
    db.seed("api_keys", [
      KEY_ROW,
      { ...KEY_ROW, id: "key-2", key_hash: "hash-2", is_active: false },
    ]);

    const one = await db.client
      .from("api_keys")
      .select("id, rate_limit_per_minute")
      .eq("key_hash", "hash-1")
      .eq("is_active", true)
      .single();
    const none = await db.client
      .from("api_keys")
      .select("id")
      .eq("key_hash", "hash-2")
      .eq("is_active", true)
      .maybeSingle();
    const missing = await db.client
      .from("api_keys")
      .select("id")
      .eq("key_hash", "nope")
      .single();
    const all = await db.client.from("api_keys").select("*").limit(1);

    expect(one).toMatchObject({
      data: { id: "key-1", rate_limit_per_minute: 100 },
      error: null,
    });
    expect(Object.keys(one.data ?? {})).toEqual([
      "id",
      "rate_limit_per_minute",
    ]);
    expect(none).toMatchObject({ data: null, error: null });
    expect(missing.data).toBeNull();
    expect(missing.error).toMatchObject({ code: "PGRST116" });
    expect(all.data).toHaveLength(1);
  });

  it("applies inserts, updates and deletes to its rows", async () => {
    const db = createSchemaStrictDatabase();

    const inserted = await db.client
      .from("content_elements")
      .insert({ site_id: "site-1", element_id: "hero", selector: "h1" })
      .select()
      .single();
    const updated = await db.client
      .from("content_elements")
      .update({ published_content: "Hello" })
      .eq("element_id", "hero")
      .select("element_id, published_content")
      .single();

    expect(inserted.error).toBeNull();
    expect(inserted.data).toMatchObject({
      site_id: "site-1",
      element_id: "hero",
    });
    expect(typeof (inserted.data as { id?: unknown }).id).toBe("string");
    expect(updated.data).toEqual({
      element_id: "hero",
      published_content: "Hello",
    });

    const deleted = await db.client
      .from("content_elements")
      .delete()
      .eq("element_id", "hero");

    expect(deleted.error).toBeNull();
    expect(db.rows("content_elements")).toEqual([]);
  });

  it("refuses an update naming a column the table does not have", async () => {
    const db = createSchemaStrictDatabase();
    db.seed("api_keys", [KEY_ROW]);

    const { error } = await db.client
      .from("api_keys")
      .update({ rate_limit: 5 })
      .eq("id", "key-1");

    expect(error).toMatchObject({ code: "PGRST204" });
    expect(db.rows("api_keys")[0]).not.toHaveProperty("rate_limit");
  });

  it("records every query it was asked, refused ones included", async () => {
    const db = createSchemaStrictDatabase();

    await db.client
      .from("api_keys")
      .select("id")
      .eq("key_hash", "x")
      .maybeSingle();
    await db.client.from("rate_limits").select("*").eq("key", "k");

    expect(db.queries).toEqual([
      expect.objectContaining({
        table: "api_keys",
        operation: "select",
        columns: ["id"],
        filters: [{ column: "key_hash", operator: "eq", value: "x" }],
      }),
      expect.objectContaining({ table: "rate_limits", operation: "select" }),
    ]);
    expect(db.queriesOn("rate_limits")).toHaveLength(1);
  });
});
