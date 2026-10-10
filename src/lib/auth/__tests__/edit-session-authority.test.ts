/**
 * @jest-environment node
 */

/*
 * s68a (ADR 047) — an edit session carries no authority of its own.
 *
 * H1: the validator used to return `normalizePermissions(session.permissions)`
 * and nothing else, so whatever the row said was what its bearer could do. An
 * `edit` member who wrote an `admin` row (the INSERT policy let them) published
 * to the live site with it, and a member removed from the site kept their
 * session until it expired — which, for a row inserted directly, was 2099.
 *
 * Now the holder's LIVE direct `site_permissions` row decides, read at every
 * validation; the row only narrows. Anything the validator refuses is refused
 * with the one message the route already returned, so the refusal is no oracle
 * for "member removed" vs "token wrong".
 *
 * The fake applies every `.eq()` / `.gte()` it is given, so a lookup that
 * forgets a filter (the site, the holder) finds the wrong row and goes red.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { validateEditorAccess } from "../editor-access";

jest.mock("@/lib/supabase/service");

const SITE_ID = "site-1";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const REFUSED = {
  valid: false,
  error: "Invalid or expired edit session",
  status: 401,
};

type Row = Record<string, unknown>;

function session(overrides: Row): Row {
  return {
    id: `session-${String(overrides.token)}`,
    site_id: SITE_ID,
    is_active: true,
    created_at: new Date(Date.now() - HOUR_MS).toISOString(),
    expires_at: new Date(Date.now() + HOUR_MS).toISOString(),
    ...overrides,
  };
}

const tables: Record<string, Row[]> = {
  edit_sessions: [
    // (a) an edit member's self-minted admin row
    session({
      token: "admin-row-edit-member",
      user_id: "editor",
      permissions: ["admin"],
    }),
    // (b) a member since removed from the site
    session({
      token: "removed-member",
      user_id: "removed",
      permissions: ["edit"],
    }),
    // (c) no holder at all — what the old e2e seeds wrote
    session({ token: "no-holder", user_id: null, permissions: ["edit"] }),
    // (d) issued 25 h ago, expiry pushed out by a direct write
    session({
      token: "past-lifetime",
      user_id: "admin",
      permissions: ["edit"],
      created_at: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * HOUR_MS).toISOString(),
    }),
    // (e) an admin's deliberately narrow session
    session({
      token: "edit-row-admin-holder",
      user_id: "admin",
      permissions: ["edit"],
    }),
    // (f) review M1: `created_at` is as writable as `expires_at` was. Dated
    // 2099 with a 12 h `expires_at`, the age is negative and passed the
    // ceiling; the session then never expired.
    session({
      token: "created-in-2099",
      user_id: "editor",
      permissions: ["edit"],
      created_at: "2099-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T12:00:00.000Z",
    }),
    // ...and just past the 5 min skew tolerance, so a looser bound goes red.
    session({
      token: "created-6-min-ahead",
      user_id: "editor",
      permissions: ["edit"],
      created_at: new Date(Date.now() + 6 * MINUTE_MS).toISOString(),
    }),
    // (g) a fresh session from a database clock running a little ahead
    session({
      token: "created-4-min-ahead",
      user_id: "editor",
      permissions: ["edit"],
      created_at: new Date(Date.now() + 4 * MINUTE_MS).toISOString(),
    }),
  ],
  site_permissions: [
    { site_id: SITE_ID, user_id: "editor", permission: "edit" },
    { site_id: SITE_ID, user_id: "admin", permission: "admin" },
    // A team grant has no `user_id`. A lookup that matched a NULL holder
    // against it would hand (c) admin.
    { site_id: SITE_ID, user_id: null, team_id: "team-1", permission: "admin" },
    // The removed member still holds a row — on ANOTHER site.
    { site_id: "site-2", user_id: "removed", permission: "admin" },
  ],
};

function filteringClient() {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () =>
        (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return chain;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return chain;
        },
        single: async () => {
          const found = rows();
          return found.length === 1
            ? { data: found[0], error: null }
            : { data: null, error: { message: "no rows" } };
        },
        maybeSingle: async () => {
          const found = rows();
          return found.length > 1
            ? { data: null, error: { message: "multiple rows" } }
            : { data: found[0] ?? null, error: null };
        },
        update: () => ({
          eq: () => ({ then: (resolve: (v: unknown) => void) => resolve({}) }),
        }),
      };
      return chain;
    },
  };
}

function validate(token: string) {
  return validateEditorAccess({
    siteId: SITE_ID,
    token: { kind: "edit-session", token },
  });
}

describe("an edit session grants at most its holder's live grant (ADR 047)", () => {
  beforeEach(() => {
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        filteringClient() as unknown as ReturnType<
          typeof createServiceRoleClient
        >,
      );
  });

  it("(a) an admin row held by a live edit member grants view and edit only", async () => {
    const result = await validate("admin-row-edit-member");

    expect(result.valid).toBe(true);
    expect(result.access?.permissions).toEqual(["view", "edit"]);
  });

  it("(b) a holder with no live grant on this site is refused, with the existing message", async () => {
    await expect(validate("removed-member")).resolves.toEqual(REFUSED);
  });

  it("(c) a session with no holder is refused, with the same message", async () => {
    await expect(validate("no-holder")).resolves.toEqual(REFUSED);
  });

  it("(d) refuses a session past the 24 h lifetime, whatever its expires_at", async () => {
    await expect(validate("past-lifetime")).resolves.toEqual(REFUSED);
  });

  it("(e) guard: the row narrows — a live admin's edit session grants view and edit", async () => {
    const result = await validate("edit-row-admin-holder");

    expect(result.valid).toBe(true);
    expect(result.access?.permissions).toEqual(["view", "edit"]);
    expect(result.access?.userId).toBe("admin");
  });

  it("(f) refuses a session whose created_at is in the future beyond the 5 min skew tolerance", async () => {
    await expect(validate("created-in-2099")).resolves.toEqual(REFUSED);
    await expect(validate("created-6-min-ahead")).resolves.toEqual(REFUSED);
  });

  it("(g) guard: accepts a fresh session whose created_at is up to 5 min ahead (clock skew)", async () => {
    const result = await validate("created-4-min-ahead");

    expect(result.valid).toBe(true);
    expect(result.access?.permissions).toEqual(["view", "edit"]);
  });
});
