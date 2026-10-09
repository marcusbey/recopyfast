/**
 * @jest-environment node
 */

/*
 * s76 — s69 R4: removing an editor also ends their staging invites.
 *
 * `revokeSiteEditor` stamped `site_editors.revoked_at` and swept the editor's
 * device grants, and left their `staging_access` invites on that site active.
 * Since s68c every staging validator refuses an invite whose address has a
 * revoked directory row, so the rows were not load-bearing — but the dashboard
 * went on listing them as live access, and "is_active" said so to anyone
 * reading the table.
 *
 * `staging_access.email` keeps the case it was typed in; `site_editors.email`
 * is normalised. Addresses are matched in code with `normalizeEmail`, never
 * with a PostgREST `ilike`, where `_` and `%` are wildcards: `bob_x@…` would
 * have matched, and deactivated, `bobzx@…` — somebody else's access.
 *
 * The fake applies every filter it is given, so a sweep that forgets the site,
 * the activity flag or the address goes red.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { createSchemaStrictDatabase } from "@/__tests__/helpers/schema-strict-supabase";
import { revokeSiteEditor } from "../editor-directory";

jest.mock("@/lib/supabase/service");

const SITE_ID = "site-a";
const OTHER_SITE_ID = "site-b";
const EDITOR_ID = "editor-1";

type Row = Record<string, unknown>;

function makeWorld(options: { failStagingUpdate?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    site_editors: [
      {
        id: EDITOR_ID,
        site_id: SITE_ID,
        email: "bob_x@corp.example",
        revoked_at: null,
      },
    ],
    editor_device_grants: [],
    staging_access: [
      // The editor's own invite, typed in another case: ended.
      {
        id: "mine",
        site_id: SITE_ID,
        email: "Bob_X@Corp.Example",
        is_active: true,
        revoked_at: null,
      },
      // `_` as a wildcard would match this one. Somebody else: untouched.
      {
        id: "lookalike",
        site_id: SITE_ID,
        email: "bobzx@corp.example",
        is_active: true,
        revoked_at: null,
      },
      // Same address, another site: not this removal's business.
      {
        id: "other-site",
        site_id: OTHER_SITE_ID,
        email: "bob_x@corp.example",
        is_active: true,
        revoked_at: null,
      },
      // Already ended: not rewritten.
      {
        id: "ended",
        site_id: SITE_ID,
        email: "bob_x@corp.example",
        is_active: false,
        revoked_at: "2026-01-01T00:00:00.000Z",
      },
      // No address at all (a retired share link).
      {
        id: "no-email",
        site_id: SITE_ID,
        email: null,
        is_active: true,
        revoked_at: null,
      },
    ],
  };

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let update: Row | null = null;
    let returning = false;
    // Rows `from`..`to` of a paged read (Devin fix pass). Ordering is a no-op:
    // the rows are held in one order already. The page-boundary behaviour is
    // pinned on the schema-strict double below, which models both.
    let page: { from: number; to: number } | null = null;

    const matching = () =>
      (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const run = (single: boolean) => {
      if (update) {
        if (table === "staging_access" && options.failStagingUpdate) {
          return { data: null, error: { message: "connection reset" } };
        }
        const rows = matching();
        for (const row of rows) Object.assign(row, update);
        return {
          data: returning ? rows.map((row) => ({ id: row.id })) : null,
          error: null,
        };
      }
      const rows = matching();
      const paged = page ? rows.slice(page.from, page.to + 1) : rows;
      return { data: single ? (paged[0] ?? null) : paged, error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => {
        if (update) returning = true;
        return chain;
      },
      update: (values: Row) => {
        update = values;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      order: () => chain,
      range: (from: number, to: number) => {
        page = { from, to };
        return chain;
      },
      maybeSingle: () => Promise.resolve(run(true)),
      single: () => Promise.resolve(run(true)),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(run(false)).then(onOk, onErr),
    };
    return chain;
  }

  jest
    .mocked(createServiceRoleClient)
    .mockReturnValue({ from } as unknown as ReturnType<
      typeof createServiceRoleClient
    >);

  const invite = (id: string) =>
    tables.staging_access.find((row) => row.id === id) as Row;
  return { tables, invite };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("revoking an editor ends their staging invites on that site", () => {
  it("deactivates the editor's own invite, in any case, and reports it", async () => {
    const world = makeWorld();

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result.revoked).toBe(true);
    expect(result.stagingInvitesRevoked).toBe(1);
    expect(world.invite("mine").is_active).toBe(false);
    expect(typeof world.invite("mine").revoked_at).toBe("string");
  });

  it("leaves everybody else's invites, other sites and ended rows alone", async () => {
    const world = makeWorld();

    await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(world.invite("lookalike")).toMatchObject({
      is_active: true,
      revoked_at: null,
    });
    expect(world.invite("other-site")).toMatchObject({
      is_active: true,
      revoked_at: null,
    });
    expect(world.invite("ended").revoked_at).toBe("2026-01-01T00:00:00.000Z");
    expect(world.invite("no-email").is_active).toBe(true);
  });

  it("still sweeps when retried for an editor already revoked", async () => {
    // An interrupted sweep is finished by clicking remove again.
    const world = makeWorld();
    world.tables.site_editors[0].revoked_at = "2026-10-01T00:00:00.000Z";

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result.revoked).toBe(true);
    expect(world.invite("mine").is_active).toBe(false);
  });

  it("still reports the editor revoked when the invite sweep fails", async () => {
    // Best effort, like the grant sweep: every staging validator already
    // refuses an address with a revoked directory row (s68c), so a failed
    // sweep leaves stale rows, not access.
    const world = makeWorld({ failStagingUpdate: true });

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result).toMatchObject({ revoked: true, stagingInvitesRevoked: 0 });
    expect(world.tables.site_editors[0].revoked_at).not.toBeNull();
  });
});

describe("Devin fix pass — revoking reaches every invite, past PostgREST's max_rows", () => {
  // The sweep read the site's active invites in one request. PostgREST caps
  // every response at `max_rows` (1000, supabase/config.toml), so on a site
  // with more active invites than that, the editor's invite past the first
  // thousand rows was never read — and stayed active. The double below caps
  // its responses the same way.

  /** UUID-shaped ids that sort in the order of `n`. */
  const inviteId = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  function seeded(options: {
    maxRows: number;
    invites: number;
    mine: number[];
    lookalike?: number;
    /** The update (1-based) that fails, as a dropped connection would. */
    failUpdate?: number;
  }) {
    const db = createSchemaStrictDatabase({ maxRows: options.maxRows });
    db.seed("site_editors", [
      {
        id: EDITOR_ID,
        site_id: SITE_ID,
        email: "bob_x@corp.example",
        revoked_at: null,
      },
    ]);
    // Seeded newest-first, so the table's own order is not the id order.
    const rows = Array.from({ length: options.invites }, (_, n) => ({
      id: inviteId(n),
      site_id: SITE_ID,
      email: options.mine.includes(n)
        ? "Bob_X@Corp.Example"
        : n === options.lookalike
          ? "bobzx@corp.example"
          : `someone-${n}@corp.example`,
      is_active: true,
      revoked_at: null,
    })).reverse();
    db.seed("staging_access", rows);
    // The same address on another site: not this removal's business.
    db.seed("staging_access", [
      {
        id: "other-site",
        site_id: OTHER_SITE_ID,
        email: "bob_x@corp.example",
        is_active: true,
        revoked_at: null,
      },
    ]);

    // Every read of the site's invites, with the order keys it asked for: a
    // paged read without a total order can skip or repeat rows in Postgres,
    // which an in-memory table never shows.
    const pagedReads: string[][] = [];
    let updates = 0;
    const client = {
      from: (table: string) => {
        const builder = db.client.from(table);
        if (table !== "staging_access") return builder;
        const update = builder.update.bind(builder);
        builder.update = (patch) => {
          updates += 1;
          if (updates === options.failUpdate) {
            builder.then = (onOk, onErr) =>
              Promise.resolve({
                data: null,
                count: null,
                error: {
                  code: "08006",
                  message: "connection reset",
                  details: null,
                  hint: null,
                },
              }).then(onOk, onErr);
          }
          return update(patch);
        };
        const keys: string[] = [];
        const order = builder.order.bind(builder);
        const range = builder.range.bind(builder);
        builder.order = (column, opts) => {
          keys.push(column);
          return order(column, opts);
        };
        builder.range = (from, to) => {
          pagedReads.push(keys);
          return range(from, to);
        };
        return builder;
      },
    };
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        client as unknown as ReturnType<typeof createServiceRoleClient>,
      );

    const active = (id: string) =>
      db.rows("staging_access").find((row) => row.id === id)?.is_active;
    return { db, active, pagedReads };
  }

  it("ends the editor's invites on every page, and nobody else's", async () => {
    const world = seeded({
      maxRows: 1000,
      invites: 2500,
      mine: [5, 1500, 2499],
      lookalike: 2000,
    });

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result).toMatchObject({ revoked: true, stagingInvitesRevoked: 3 });
    for (const n of [5, 1500, 2499]) {
      expect(world.active(inviteId(n))).toBe(false);
    }
    expect(world.active(inviteId(2000))).toBe(true);
    expect(world.active(inviteId(1499))).toBe(true);
    expect(world.active("other-site")).toBe(true);
    expect(
      world.db.rows("staging_access").filter((row) => row.is_active === false),
    ).toHaveLength(3);
  });

  it("advances by the rows the server returned, not the rows it asked for", async () => {
    // A server capping below the page the sweep asks for: stepping by the
    // page size would jump from row 7 to row 1000 and miss all three.
    const world = seeded({ maxRows: 7, invites: 30, mine: [8, 15, 29] });

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result.stagingInvitesRevoked).toBe(3);
    for (const n of [8, 15, 29]) {
      expect(world.active(inviteId(n))).toBe(false);
    }
  });

  it("pages in a total order: each read is ordered, ending on the primary key", async () => {
    const world = seeded({ maxRows: 1000, invites: 2500, mine: [2499] });

    await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    // Three full pages and the empty one that ends the read.
    expect(world.pagedReads).toHaveLength(4);
    for (const keys of world.pagedReads) {
      expect(keys[keys.length - 1]).toBe("id");
    }
  });

  it("ends a long list of the editor's own invites in bounded batches", async () => {
    // Every invite is a new row, so one address can hold any number of them.
    // Their ids travel in the update's URL (`id=in.(…)`): one request for
    // all of them would outgrow a request line.
    const mine = Array.from({ length: 250 }, (_, n) => n * 2);
    const world = seeded({ maxRows: 1000, invites: 600, mine });

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result.stagingInvitesRevoked).toBe(250);
    for (const n of mine) expect(world.active(inviteId(n))).toBe(false);
    expect(world.active(inviteId(1))).toBe(true);

    const updates = world.db
      .queriesOn("staging_access")
      .filter((query) => query.operation === "update");
    expect(updates.length).toBeGreaterThan(1);
    for (const update of updates) {
      const ids = update.filters.find(
        (filter) => filter.column === "id" && filter.operator === "in",
      )?.value as unknown[];
      expect(ids.length).toBeLessThanOrEqual(100);
    }
  });

  // s76 verification of fa820c1 (minors 1, 2): each batched update is fenced
  // by the site as well as the ids it read, and touches active rows only, so
  // an invite already ended keeps its revoked_at and is not counted again.
  it("scopes every batched update to the site and to active invites", async () => {
    const mine = Array.from({ length: 150 }, (_, n) => n * 2);
    const world = seeded({ maxRows: 1000, invites: 400, mine });

    await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    const updates = world.db
      .queriesOn("staging_access")
      .filter((query) => query.operation === "update");
    expect(updates.length).toBeGreaterThan(1);
    for (const update of updates) {
      expect(update.filters).toEqual(
        expect.arrayContaining([
          { column: "site_id", operator: "eq", value: SITE_ID },
          { column: "is_active", operator: "eq", value: true },
        ]),
      );
    }
  });

  it("reports the invites already ended when a later batch fails", async () => {
    // Best effort: a dropped connection mid-sweep stops it, and the count
    // the DELETE route logs is what actually landed, not 0.
    const mine = Array.from({ length: 250 }, (_, n) => n * 2);
    const world = seeded({ maxRows: 1000, invites: 600, mine, failUpdate: 2 });

    const result = await revokeSiteEditor({ siteEditorId: EDITOR_ID });

    expect(result).toMatchObject({ revoked: true, stagingInvitesRevoked: 100 });
    expect(
      world.db.rows("staging_access").filter((row) => row.is_active === false),
    ).toHaveLength(100);
  });
});
