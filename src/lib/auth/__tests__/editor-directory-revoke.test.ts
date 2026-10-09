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
      return { data: single ? (rows[0] ?? null) : rows, error: null };
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
