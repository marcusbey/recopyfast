/**
 * @jest-environment node
 */

/**
 * s68a (ADR 047) — an edit session is issued through the service role.
 *
 * Migration 20261008100000 takes every write on `edit_sessions` away from
 * `anon` and `authenticated`: the INSERT policy that let a member mint their
 * own `admin` session (H1) is gone, and so is the grant. The application's one
 * legitimate writer, `EditSessionManager.createEditSession`, used to insert
 * with the USER's RLS client — so on the new schema it must insert with the
 * service client, after the same permission check it always made.
 *
 * The permission check stays on the user's client: reading the caller's own
 * `site_permissions` row under RLS is what proves who they are and what they
 * hold (the same reasoning as `authorizeFirstPartyEditorAccess`). Only the
 * insert moves.
 *
 * The user client below answers an `edit_sessions` write with 42501, as the
 * migrated database does, so an insert left on it fails here exactly as it
 * would in production.
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { EditSessionManager } from "@/lib/auth/edit-sessions";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

const SITE_ID = "site-123";
const USER_ID = "user-1";

interface Op {
  table: string;
  kind: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

type Answer = { data: unknown; error: unknown };

function recordingClient(answer: (op: Op) => Answer) {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const op: Op = { table, kind: "select", filters: [] };
      const settle = async () => {
        ops.push(op);
        return answer(op);
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: Record<string, unknown>) => {
          op.kind = "insert";
          op.payload = payload;
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          op.kind = "update";
          op.payload = payload;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          op.filters.push([column, value]);
          return builder;
        },
        single: settle,
        maybeSingle: settle,
      };
      return builder;
    },
  };
  return { client, ops };
}

const PERMISSION_DENIED = {
  data: null,
  error: {
    code: "42501",
    message: "permission denied for table edit_sessions",
  },
};

function userClient(level: string | null) {
  return recordingClient((op) => {
    if (op.table === "site_permissions" && op.kind === "select") {
      return level
        ? { data: { permission: level, site_id: SITE_ID }, error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    return PERMISSION_DENIED;
  });
}

function serviceClient() {
  return recordingClient((op) =>
    op.table === "edit_sessions" && op.kind === "insert"
      ? {
          data: {
            id: "session-1",
            ...op.payload,
            created_at: new Date().toISOString(),
          },
          error: null,
        }
      : { data: null, error: { message: `unexpected ${op.kind} ${op.table}` } },
  );
}

function wire(level: string | null) {
  const user = userClient(level);
  const service = serviceClient();
  jest
    .mocked(createClient)
    .mockResolvedValue(
      user.client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
  jest
    .mocked(createServiceRoleClient)
    .mockReturnValue(
      service.client as unknown as ReturnType<typeof createServiceRoleClient>,
    );
  return { userOps: user.ops, serviceOps: service.ops };
}

describe("EditSessionManager.createEditSession — issued through the service role", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("inserts the session with the service client and reads only the caller's grant with theirs", async () => {
    const { userOps, serviceOps } = wire("edit");

    const session = await EditSessionManager.createEditSession({
      siteId: SITE_ID,
      userId: USER_ID,
      permissions: ["edit"],
      durationHours: 2,
    });

    expect(session).toMatchObject({
      site_id: SITE_ID,
      user_id: USER_ID,
      permissions: ["edit"],
    });
    expect(userOps.map(({ table, kind }) => `${kind} ${table}`)).toEqual([
      "select site_permissions",
    ]);
    expect(serviceOps).toEqual([
      {
        table: "edit_sessions",
        kind: "insert",
        payload: expect.objectContaining({
          site_id: SITE_ID,
          user_id: USER_ID,
          permissions: ["edit"],
          token: expect.any(String),
          expires_at: expect.any(String),
        }),
        filters: [],
      },
    ]);
  });

  it("guard: a caller with no grant on the site gets nothing, and nothing is inserted", async () => {
    const { serviceOps } = wire(null);

    const session = await EditSessionManager.createEditSession({
      siteId: SITE_ID,
      userId: USER_ID,
      permissions: ["edit"],
    });

    expect(session).toBeNull();
    expect(serviceOps).toEqual([]);
  });

  it("guard: an edit member asking for admin gets nothing, and nothing is inserted", async () => {
    const { serviceOps } = wire("edit");

    const session = await EditSessionManager.createEditSession({
      siteId: SITE_ID,
      userId: USER_ID,
      permissions: ["admin"],
    });

    expect(session).toBeNull();
    expect(serviceOps).toEqual([]);
  });
});
