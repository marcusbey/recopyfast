/**
 * A-12 — handlers embed `auth.users` over PostgREST, which cannot resolve it.
 *
 * PostgREST only exposes the schemas listed in its config (`public`, plus
 * whatever is added explicitly). `auth` is not one of them, so
 * `select("*, user:auth.users!fk(email, raw_user_meta_data)")` is not a slow or
 * partial query — it is a hard PGRST200 "could not find a relationship", and
 * the handler answers 500 to every caller.
 *
 * Six sites did this. Five in the Teams feature, which is what the audit counted:
 *   - teams/[teamId]/members/route.ts:44   (GET member list)
 *   - teams/[teamId]/members/route.ts:174  (PATCH role update)
 *   - teams/[teamId]/invitations/route.ts:49, :237
 *   - teams/[teamId]/activity/route.ts:48
 * plus `.from("auth.users")` at invitations/route.ts:169, whose error was
 * discarded — so the "already a member" guard silently never ran. And a sixth,
 * found while fixing those, in `lib/collaboration/permissions.ts`
 * (`getActiveEditingSessions`), which failed the same way but returned `[]`, so
 * editor presence read as "nobody is editing" instead of erroring.
 *
 * The repo already knew the answer: sites/[siteId]/share/route.ts resolves
 * identities through `auth.admin.getUserById` on a service-role client. That is
 * now `@/lib/auth/user-identity`, and every one of the six goes through it.
 *
 * WHY THE SCAN COVERS ALL OF `src` AND NOT JUST THE TEAMS ROUTES
 * -------------------------------------------------------------
 * Scoped to `src/app/api/teams`, this scan was green while the sixth site shipped
 * — it could not see the file. A tripwire that only watches where the bug was
 * already found tells you nothing about where it goes next, and this bug is a
 * copy-paste idiom, so the next instance will be somewhere new. Production
 * sources are therefore all in scope.
 *
 * Test files are excluded: their Supabase stand-ins have to name `auth.users`
 * to refuse it, which is the opposite of the defect.
 *
 * Two tests, deliberately:
 *   1. The source scan, which catches the whole class repo-wide.
 *   2. A handler test on GET members, which pins the behaviour a caller sees.
 *      Its Supabase stand-in refuses any `.select()` naming `auth.users` with
 *      the real PGRST200 error, and offers `auth.admin.getUserById` — so the
 *      documented fix makes it pass, and nothing else does.
 */

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// 1. Source scan
// ---------------------------------------------------------------------------

const SRC_DIR = path.join(process.cwd(), "src");
const TEAMS_API_DIR = path.join(process.cwd(), "src/app/api/teams");

/** Production TypeScript under a directory. Tests are not production sources. */
function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : collectSourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];

    return [full];
  });
}

function collectRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

function findAuthUsersReferences(): string[] {
  return collectSourceFiles(SRC_DIR).flatMap((file) => {
    const relative = path.relative(process.cwd(), file);
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        !isCommentLine(line) && line.includes("auth.users")
          ? [`${relative}:${index + 1} ${line.trim()}`]
          : [],
      );
  });
}

// ---------------------------------------------------------------------------
// 2. Handler test
// ---------------------------------------------------------------------------

const TEAM_ID = "team-1";
const CALLER_ID = "user-owner";

const AUTH_USERS: Record<string, { email: string; name: string }> = {
  "user-owner": { email: "owner@example.com", name: "Olive Owner" },
  "user-editor": { email: "editor@example.com", name: "Ed Editor" },
};

const TEAM_MEMBERS = [
  {
    id: "member-1",
    team_id: TEAM_ID,
    user_id: "user-owner",
    role: "owner",
    joined_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "member-2",
    team_id: TEAM_ID,
    user_id: "user-editor",
    role: "editor",
    joined_at: "2026-02-01T00:00:00.000Z",
  },
];

/**
 * PostgREST's answer when a select names a relationship it cannot resolve.
 * Verbatim shape, because the point of this suite is that the route treats a
 * permanent schema error as if it were a transient database blip.
 */
const PGRST200 = {
  code: "PGRST200",
  message:
    "Could not find a relationship between 'team_members' and 'auth.users' in the schema cache",
  details: null,
  hint: null,
};

const mockGetUser = jest.fn();

interface PostgrestError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** What a resolved query hands back, error branch included. */
interface Settled {
  data: unknown;
  error: PostgrestError | null;
}

/**
 * The chainable stand-in for a PostgREST builder. Annotated explicitly because
 * every method returns the object itself, which TypeScript cannot infer from a
 * self-referential initializer (TS7022).
 */
interface FakeQueryBuilder {
  select(columns: string): FakeQueryBuilder;
  eq(column: string, value: unknown): FakeQueryBuilder;
  order(): FakeQueryBuilder;
  single(): Promise<Settled>;
  then(
    onFulfilled: (value: Settled) => unknown,
    onRejected: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

function makeSupabase() {
  return {
    auth: { getUser: mockGetUser },
    from(table: string) {
      const state = {
        table,
        select: "",
        filters: [] as Array<[string, unknown]>,
      };

      const settle = (): Settled => {
        // The whole finding in one branch: a select that names `auth.users`
        // cannot be answered, whatever the data looks like.
        if (state.select.includes("auth.users")) {
          return { data: null, error: PGRST200 };
        }

        if (state.table !== "team_members") {
          return { data: [], error: null };
        }

        const rows = TEAM_MEMBERS.filter((row) =>
          state.filters.every(
            ([column, value]) =>
              (row as Record<string, unknown>)[column] === value,
          ),
        );
        return { data: rows, error: null };
      };

      const builder: FakeQueryBuilder = {
        select(columns: string) {
          state.select = columns ?? "";
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters.push([column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        single() {
          const result = settle();
          if (result.error) return Promise.resolve(result);
          const rows = (result.data as unknown[]) ?? [];
          return Promise.resolve(
            rows.length > 0
              ? { data: rows[0], error: null }
              : {
                  data: null,
                  error: { code: "PGRST116", message: "No rows found" },
                },
          );
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(settle()).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: jest.fn(() => Promise.resolve(makeSupabase())),
  createClient: jest.fn(() => Promise.resolve(makeSupabase())),
}));

// The supported way to read `auth.users`, and the one this repo already uses in
// sites/[siteId]/share/route.ts. Provided here so a handler rewritten that way
// passes without touching this file.
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    auth: {
      admin: {
        getUserById: jest.fn(async (userId: string) => {
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
        }),
      },
    },
  })),
}));

import { GET } from "@/app/api/teams/[teamId]/members/route";

/**
 * A member as the fixed handler would return it — the identity resolved through
 * `auth.admin.getUserById` and attached to the row. `user` is optional because
 * today's handler never gets far enough to attach one.
 */
interface MemberWithUser {
  user?: { email?: string };
}

function getMembers(): Promise<Response> {
  return GET(
    new NextRequest(`https://www.recopyfa.st/api/teams/${TEAM_ID}/members`),
    { params: Promise.resolve({ teamId: TEAM_ID }) },
  ) as unknown as Promise<Response>;
}

describe("A-12 Teams handlers embed auth.users over PostgREST", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      data: { user: { id: CALLER_ID, email: "owner@example.com" } },
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finds the sources to scan (guards against a silent no-op)", () => {
    // Guard for the scan below: an empty file list makes `toEqual([])` pass for
    // the wrong reason, which is precisely how the teams-only version of this
    // scan stayed green while a sixth embed shipped outside its directory.
    const sources = collectSourceFiles(SRC_DIR);

    expect(collectRouteFiles(TEAMS_API_DIR).length).toBeGreaterThanOrEqual(4);
    // Wide enough to reach the places the class actually spread to.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain(
      path.join(process.cwd(), "src/lib/collaboration/permissions.ts"),
    );
    expect(sources).toContain(
      path.join(process.cwd(), "src/app/api/teams/[teamId]/members/route.ts"),
    );
    // And it must not be reading the stand-ins that name auth.users on purpose.
    expect(sources.filter((file) => /\.test\.tsx?$/.test(file))).toEqual([]);
  });

  it("no production source references auth.users", () => {
    // `auth` is not in PostgREST's exposed schemas, so every reference this
    // returns is a query that can only fail. The fix is always the same:
    // resolve through @/lib/auth/user-identity.
    expect(findAuthUsersReferences()).toEqual([]);
  });

  // Guard for the handler case below. The membership check at :24-29 uses a
  // select that does NOT name auth.users, so it resolves through the same
  // stand-in. Passing here proves the stub, the session and the route wiring
  // all work — so the 500 below comes from the embed, not from this file.
  it("refuses a caller who is not a team member (guard for the handler case)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-stranger", email: "stranger@example.com" } },
      error: null,
    });

    const response = await getMembers();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Not a member of this team");
  });

  it("GET /api/teams/[teamId]/members returns members with their email", async () => {
    const response = await getMembers();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.members).toHaveLength(2);
    expect(
      body.members.map((member: MemberWithUser) => member.user?.email),
    ).toEqual(["owner@example.com", "editor@example.com"]);
  });
});
