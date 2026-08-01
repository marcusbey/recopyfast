import { CollaborationPermissions } from "@/lib/collaboration/permissions";

type QueryResult = { data: unknown; error: unknown };

/**
 * Supabase query-builder stub.
 *
 * Each `.from()` call consumes the next queued result. Every chain method
 * returns the same builder, and the builder is both thenable and exposes
 * `.single()`, so it satisfies chains that terminate either way.
 *
 * The previous hand-rolled mock nested `mockSupabase.eq.mockReturnValue(...)`
 * inside itself — the inner call overwrote the outer, so `.eq().eq()` blew up
 * and every assertion landed in the module's catch-all error branch.
 */
let resultQueue: QueryResult[] = [];
const fromCalls: string[] = [];

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "is",
  "gt",
  "gte",
  "lt",
  "order",
  "limit",
  "insert",
  "update",
  "delete",
  "upsert",
];

const makeBuilder = (result: QueryResult) => {
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
    single: jest.fn(() => Promise.resolve(result)),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
  };
  for (const method of CHAIN_METHODS) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockSupabase = {
  from: jest.fn((table: string) => {
    fromCalls.push(table);
    return makeBuilder(resultQueue.shift() ?? { data: null, error: null });
  }),
};

/** Queue one result per `.from()` call, in the order the module issues them. */
const queueResults = (...results: QueryResult[]) => {
  resultQueue = [...results];
};

const ok = (data: unknown): QueryResult => ({ data, error: null });
const notFound = (): QueryResult => ({
  data: null,
  error: { message: "Not found" },
});
const empty = (): QueryResult => ({ data: null, error: null });

// The module under test imports `createClient`; `createServerClient` is only an
// alias re-export. A factory mock replaces the whole module, so both names have
// to be provided or `createClient` comes back undefined.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
  createServerClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

describe("CollaborationPermissions", () => {
  let permissions: CollaborationPermissions;

  beforeEach(() => {
    jest.clearAllMocks();
    resultQueue = [];
    fromCalls.length = 0;
    permissions = new CollaborationPermissions();
  });

  describe("checkTeamPermission", () => {
    it("grants permission to a team member holding a required role", async () => {
      queueResults(ok({ role: "manager" }));

      const result = await permissions.checkTeamPermission(
        "user-id",
        "team-id",
        ["manager", "owner"],
      );

      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe("manager");
      expect(fromCalls).toEqual(["team_members"]);
    });

    it("denies permission when the user has no membership row", async () => {
      queueResults(notFound());

      const result = await permissions.checkTeamPermission(
        "user-id",
        "team-id",
        ["manager", "owner"],
      );

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe("User is not a member of this team");
    });

    it("denies permission when the member's role is not in the required set", async () => {
      queueResults(ok({ role: "viewer" }));

      const result = await permissions.checkTeamPermission(
        "user-id",
        "team-id",
        ["manager", "owner"],
      );

      expect(result.hasPermission).toBe(false);
      expect(result.userRole).toBe("viewer");
      expect(result.reason).toBe("Requires one of: manager, owner");
    });
  });

  describe("checkSitePermission", () => {
    it("grants permission from a direct site_permissions row", async () => {
      // "edit" maps to the "editor" team role.
      queueResults(ok({ permission: "edit" }));

      const result = await permissions.checkSitePermission(
        "user-id",
        "site-id",
        ["editor", "manager"],
      );

      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe("editor");
    });

    it("falls back to team-granted site permissions when there is no direct row", async () => {
      queueResults(
        empty(), // direct site_permissions lookup
        ok([
          {
            permission: "edit",
            team: { team_members: [{ role: "manager" }] },
          },
        ]), // team-granted site_permissions
      );

      const result = await permissions.checkSitePermission(
        "user-id",
        "site-id",
        ["editor"],
      );

      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe("editor");
    });

    it("grants permission when the site belongs to a team the user is in", async () => {
      queueResults(
        empty(), // no direct permission
        ok([]), // no team-granted site permission
        ok({ team: { team_members: [{ role: "owner" }] } }), // site's owning team
      );

      const result = await permissions.checkSitePermission(
        "user-id",
        "site-id",
        ["owner"],
      );

      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe("owner");
    });

    it("denies permission when no route grants access", async () => {
      queueResults(empty(), ok([]), empty());

      const result = await permissions.checkSitePermission(
        "user-id",
        "site-id",
        ["owner"],
      );

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe("Insufficient permissions for this site");
    });

    it("denies permission when the direct row grants a role below the requirement", async () => {
      queueResults(
        ok({ permission: "view" }), // maps to "viewer"
        ok([]),
        empty(),
      );

      const result = await permissions.checkSitePermission(
        "user-id",
        "site-id",
        ["owner"],
      );

      expect(result.hasPermission).toBe(false);
    });
  });

  describe("checkContentEditPermission", () => {
    it("denies editing while another user holds an active session", async () => {
      queueResults(
        ok({ site_id: "site-id" }), // content_elements lookup
        ok([{ user_id: "other-user" }]), // active sessions by others
      );

      const result = await permissions.checkContentEditPermission(
        "user-id",
        "content-id",
      );

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe(
        "Content is currently being edited by another user",
      );
    });

    it("reports content not found when the element lookup fails", async () => {
      queueResults(notFound());

      const result = await permissions.checkContentEditPermission(
        "user-id",
        "content-id",
      );

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe("Content element not found");
    });

    it("delegates to the site permission check when no one else is editing", async () => {
      queueResults(
        ok({ site_id: "site-id" }), // content_elements lookup
        ok([]), // no active sessions
        ok({ permission: "edit" }), // direct site permission
      );

      const result = await permissions.checkContentEditPermission(
        "user-id",
        "content-id",
      );

      expect(result.hasPermission).toBe(true);
      expect(result.userRole).toBe("editor");
    });
  });

  describe("startEditingSession", () => {
    it("creates an editing session when the user has permission", async () => {
      const permissionCheck = jest
        .spyOn(permissions, "checkContentEditPermission")
        .mockResolvedValue({ hasPermission: true });

      queueResults(
        empty(), // close any existing session
        ok({ session_token: "session-token" }), // insert new session
      );

      const token = await permissions.startEditingSession(
        "user-id",
        "content-id",
      );

      expect(token).toBe("session-token");
      expect(permissionCheck).toHaveBeenCalledWith("user-id", "content-id");
    });

    it("returns null without touching the database when permission is denied", async () => {
      const permissionCheck = jest
        .spyOn(permissions, "checkContentEditPermission")
        .mockResolvedValue({ hasPermission: false, reason: "No permission" });

      const token = await permissions.startEditingSession(
        "user-id",
        "content-id",
      );

      expect(token).toBeNull();
      expect(permissionCheck).toHaveBeenCalledWith("user-id", "content-id");
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("returns null when the session insert fails", async () => {
      jest
        .spyOn(permissions, "checkContentEditPermission")
        .mockResolvedValue({ hasPermission: true });

      queueResults(empty(), notFound());

      const token = await permissions.startEditingSession(
        "user-id",
        "content-id",
      );

      expect(token).toBeNull();
    });
  });

  describe("endEditingSession", () => {
    it("reports success when the update succeeds", async () => {
      queueResults(ok({}));

      await expect(
        permissions.endEditingSession("session-token"),
      ).resolves.toBe(true);
    });

    it("reports failure when the update errors", async () => {
      queueResults(notFound());

      await expect(
        permissions.endEditingSession("session-token"),
      ).resolves.toBe(false);
    });
  });

  describe("getActiveEditingSessions", () => {
    it("returns the active sessions for a content element", async () => {
      const mockSessions = [
        { id: "session1", user_id: "user1", user: { email: "u1@example.com" } },
        { id: "session2", user_id: "user2", user: { email: "u2@example.com" } },
      ];

      queueResults(ok(mockSessions));

      const sessions = await permissions.getActiveEditingSessions("content-id");

      expect(sessions).toEqual(mockSessions);
      expect(fromCalls).toEqual(["content_editing_sessions"]);
    });
  });
});
