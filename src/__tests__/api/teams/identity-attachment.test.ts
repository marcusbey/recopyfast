/**
 * A-12, the paths no handler test reached.
 *
 * `members-embed.test.ts` pins the source-level rule (no `auth.users` under
 * `src/app/api/teams`) and the GET member list. This file exercises the other
 * three handlers a customer actually hits, plus the guard that silently never
 * ran:
 *
 *   - PATCH /api/teams/:teamId/members     — the role update's `.select()` echo
 *   - GET   /api/teams/:teamId/invitations — the pending list
 *   - POST  /api/teams/:teamId/invitations — the insert echo, and the
 *                                            already-a-member guard
 *
 * The Supabase stand-in below refuses ANY select naming `auth.users` with the
 * real PGRST200 error, exactly as PostgREST does. That is what makes these tests
 * regression tests rather than shape tests: reinstating an embed fails them, and
 * no amount of fixture tuning makes an embed work.
 *
 * `.from("auth.users")` is refused the same way — the old already-a-member guard
 * used it and destructured the error away, so it never fired once. Here the
 * refusal is loud.
 */

import { NextRequest } from "next/server";

const TEAM_ID = "team-1";
const OWNER_ID = "user-owner";
const EDITOR_ID = "user-editor";

const AUTH_USERS: Record<string, { email: string; name: string }> = {
  [OWNER_ID]: { email: "owner@example.com", name: "Olive Owner" },
  [EDITOR_ID]: { email: "editor@example.com", name: "Ed Editor" },
};

/** Verbatim, because the point is that this is permanent and not a blip. */
const PGRST200 = {
  code: "PGRST200",
  message:
    "Could not find a relationship between 'team_members' and 'auth.users' in the schema cache",
  details: null,
  hint: null,
};

interface Row {
  [column: string]: unknown;
}

/** The rows every test starts from. Rebuilt per test so writes cannot leak. */
function newTables(): Record<string, Row[]> {
  return {
    teams: [
      { id: TEAM_ID, name: "Kestrel", owner_id: OWNER_ID, max_members: 10 },
    ],
    team_members: [
      {
        id: "member-1",
        team_id: TEAM_ID,
        user_id: OWNER_ID,
        role: "owner",
        joined_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "member-2",
        team_id: TEAM_ID,
        user_id: EDITOR_ID,
        role: "editor",
        joined_at: "2026-02-01T00:00:00.000Z",
      },
    ],
    team_invitations: [
      {
        id: "invite-1",
        team_id: TEAM_ID,
        email: "pending@example.com",
        role: "viewer",
        invited_by: OWNER_ID,
        accepted_at: null,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ],
    collaboration_notifications: [],
  };
}

let tables = newTables();
const mockGetUser = jest.fn();

interface Settled {
  data: unknown;
  error: { code: string; message: string } | null;
  count?: number | null;
}

/**
 * A PostgREST-shaped fake over `tables`.
 *
 * Embeds of `public` relations (`team:teams(name)`) are resolved from the same
 * store, so a handler that keeps the legitimate embeds still passes. Anything
 * naming `auth.users` — as a table or as an embed — is refused.
 */
function makeSupabase() {
  return {
    auth: { getUser: mockGetUser },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let selectColumns = "";
      let headOnly = false;
      let pendingInsert: Row | null = null;
      let pendingUpdate: Row | null = null;

      const matching = () =>
        (tables[table] ?? []).filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        );

      /** `team:teams(name)` / `team:teams(owner_id)` — same store, public schema. */
      const decorate = (row: Row): Row => {
        if (!/team:teams\(/.test(selectColumns)) return row;
        const team = (tables.teams ?? []).find(
          (candidate) => candidate.id === row.team_id,
        );
        const requested = selectColumns.match(/team:teams\(([^)]*)\)/)?.[1];
        const fields = (requested ?? "")
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean);
        const projected: Row = {};
        for (const field of fields) projected[field] = team?.[field];
        return { ...row, team: team ? projected : null };
      };

      const settle = (): Settled => {
        if (
          table.includes("auth.users") ||
          selectColumns.includes("auth.users")
        ) {
          return { data: null, error: PGRST200, count: null };
        }

        if (pendingInsert) {
          const inserted = { id: `${table}-new`, ...pendingInsert };
          tables[table] = [...(tables[table] ?? []), inserted];
          return { data: [decorate(inserted)], error: null };
        }

        if (pendingUpdate) {
          const updated = matching().map((row) => ({
            ...row,
            ...pendingUpdate,
          }));
          tables[table] = (tables[table] ?? []).map(
            (row) =>
              updated.find((candidate) => candidate.id === row.id) ?? row,
          );
          return { data: updated.map(decorate), error: null };
        }

        const rows = matching().map(decorate);
        return {
          data: headOnly ? null : rows,
          error: null,
          count: rows.length,
        };
      };

      const builder: Record<string, unknown> = {
        select: (columns?: string, options?: { head?: boolean }) => {
          selectColumns = columns ?? "";
          headOnly = options?.head === true;
          return builder;
        },
        insert: (payload: Row) => {
          pendingInsert = payload;
          return builder;
        },
        update: (payload: Row) => {
          pendingUpdate = payload;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        // Only ever used for `accepted_at`/`revoked_at` null checks here.
        is: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        // Expiry windows: every fixture invitation is live, so this is a no-op.
        gt: () => builder,
        order: () => builder,
        range: () => builder,
        single: () => {
          const result = settle();
          if (result.error) return Promise.resolve(result);
          const rows = (result.data as Row[]) ?? [];
          return Promise.resolve(
            rows.length > 0
              ? { data: rows[0], error: null }
              : {
                  data: null,
                  error: { code: "PGRST116", message: "No rows found" },
                },
          );
        },
        maybeSingle: () => {
          const result = settle();
          if (result.error) return Promise.resolve(result);
          const rows = (result.data as Row[]) ?? [];
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then: (
          onOk: (v: Settled) => unknown,
          onErr?: (e: unknown) => unknown,
        ) => Promise.resolve(settle()).then(onOk, onErr),
      };

      return builder;
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: jest.fn(() => Promise.resolve(makeSupabase())),
  createClient: jest.fn(() => Promise.resolve(makeSupabase())),
}));

const mockGetUserById = jest.fn(async (userId: string) => {
  const record = AUTH_USERS[userId];
  return record
    ? {
        data: {
          user: {
            id: userId,
            email: record.email,
            user_metadata: { name: record.name },
          },
        },
        error: null,
      }
    : { data: { user: null }, error: { message: "User not found" } };
});

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    auth: { admin: { getUserById: mockGetUserById } },
  })),
}));

import { PATCH } from "@/app/api/teams/[teamId]/members/route";
import {
  GET as listInvitations,
  POST as createInvitation,
} from "@/app/api/teams/[teamId]/invitations/route";

const routeContext = { params: Promise.resolve({ teamId: TEAM_ID }) };

function patchRole(body: Record<string, unknown>): Promise<Response> {
  return PATCH(
    new NextRequest(`https://www.recopyfa.st/api/teams/${TEAM_ID}/members`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    routeContext,
  ) as unknown as Promise<Response>;
}

function invite(email: string, role = "editor"): Promise<Response> {
  return createInvitation(
    new NextRequest(
      `https://www.recopyfa.st/api/teams/${TEAM_ID}/invitations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      },
    ),
    routeContext,
  ) as unknown as Promise<Response>;
}

beforeEach(() => {
  tables = newTables();
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({
    data: { user: { id: OWNER_ID, email: AUTH_USERS[OWNER_ID].email } },
    error: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-12 — PATCH /api/teams/:teamId/members", () => {
  it("rejects an unknown member, proving the stand-in answers this handler", async () => {
    // Guard. The assertions below read a 200 body; a handler that never got
    // past its permission or lookup queries would fail them for reasons that
    // have nothing to do with the embed.
    const response = await patchRole({
      memberId: "member-404",
      role: "viewer",
    });

    expect(response.status).toBe(404);
  });

  it("updates the role and returns the member's resolved identity", async () => {
    const response = await patchRole({ memberId: "member-2", role: "manager" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.member.role).toBe("manager");
    // The echo used to name `auth.users`, so this write reported failure after
    // it had already landed.
    expect(body.member.user).toEqual({
      email: "editor@example.com",
      name: "Ed Editor",
    });
  });

  it("resolves the updated member, not the caller", async () => {
    // The identity has to come off the row being changed. Attaching the
    // caller's would look right in every test where they are the same person.
    await patchRole({ memberId: "member-2", role: "manager" });

    expect(mockGetUserById).toHaveBeenCalledWith(EDITOR_ID);
    expect(mockGetUserById).not.toHaveBeenCalledWith(OWNER_ID);
  });
});

describe("A-12 — GET /api/teams/:teamId/invitations", () => {
  it("refuses a caller who is not a manager or owner (guard)", async () => {
    tables.team_members = tables.team_members.filter(
      (row) => row.user_id !== OWNER_ID,
    );

    const response = await listInvitations(
      new NextRequest(
        `https://www.recopyfa.st/api/teams/${TEAM_ID}/invitations`,
      ),
      routeContext,
    );

    expect(response.status).toBe(403);
  });

  it("lists pending invitations with the team name and the inviter", async () => {
    const response = await listInvitations(
      new NextRequest(
        `https://www.recopyfa.st/api/teams/${TEAM_ID}/invitations`,
      ),
      routeContext,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invitations).toHaveLength(1);
    // `team:teams(name)` is a public-schema embed and must survive the fix —
    // only the `auth.users` half was ever the problem.
    expect(body.invitations[0].team).toEqual({ name: "Kestrel" });
    expect(body.invitations[0].inviter).toEqual({
      email: "owner@example.com",
      name: "Olive Owner",
    });
  });
});

describe("A-12 — POST /api/teams/:teamId/invitations", () => {
  it("creates the invitation and echoes the inviter", async () => {
    const response = await invite("newcomer@example.com");
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.invitation.email).toBe("newcomer@example.com");
    expect(body.invitation.inviter).toEqual({
      email: "owner@example.com",
      name: "Olive Owner",
    });
    expect(
      tables.team_invitations.some(
        (row) => row.email === "newcomer@example.com",
      ),
    ).toBe(true);
  });

  it("refuses to invite someone who is already a member", async () => {
    // The guard that never fired. It used to look the address up via
    // `.from("auth.users")` with the error discarded, so `inviteeUser` was
    // always null and this returned 201 over an existing member.
    const response = await invite(AUTH_USERS[EDITOR_ID].email);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("User is already a team member");
    expect(
      tables.team_invitations.some(
        (row) => row.email === AUTH_USERS[EDITOR_ID].email,
      ),
    ).toBe(false);
  });

  it("matches the existing member regardless of address casing", async () => {
    const response = await invite(AUTH_USERS[EDITOR_ID].email.toUpperCase());

    expect(response.status).toBe(400);
  });

  it("still refuses a duplicate pending invitation", async () => {
    // Unchanged behaviour, asserted so the member guard above cannot be
    // mistaken for the one that produces this message.
    const response = await invite("pending@example.com");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invitation already sent to this email");
  });

  it("records a member whose identity will not resolve instead of ignoring it", async () => {
    // A member pointing at a deleted account cannot be claimed as a duplicate,
    // so the invitation proceeds — but the gap in the guard's knowledge is
    // logged rather than passed over, which is what the old `.from("auth.users")`
    // version did for every member on every request.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGetUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "auth service unavailable" },
    });

    const response = await invite("newcomer@example.com");

    expect(response.status).toBe(201);
    expect(warn).toHaveBeenCalled();
  });

  it("still enforces the team's member cap", async () => {
    // The cap is now measured from the same member list the duplicate guard
    // reads, rather than a separate COUNT — so this pins that one read serves
    // both and the limit did not get lost in the swap.
    tables.teams = [{ ...tables.teams[0], max_members: 2 }];

    const response = await invite("newcomer@example.com");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Team is at maximum capacity");
  });
});
