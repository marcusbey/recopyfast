/**
 * A-17 — PUT /api/staging/content/[siteId] is last-write-wins, and its audit
 * trail hides it.
 *
 * src/app/api/staging/content/[siteId]/route.ts:203-233 reads the row, then
 * issues a bare `.update()` filtered on the natural key alone: no
 * `updated_at`/`staging_updated_at` precondition, no version column, no
 * `FOR UPDATE`. Two collaborators editing the same element in the same minute
 * silently overwrite each other.
 *
 * The second half is worse than the lost edit. `previous_content` for the
 * history row is taken from the *same stale read* (`:249`), so the loser's
 * entry records "A became C" — an edit that never happened — and denies that B
 * was ever there. The audit trail does not merely omit the collision, it
 * asserts something false about it.
 *
 * A real per-element lock already exists at
 * src/lib/collaboration/permissions.ts:243-259 and is called from nowhere.
 *
 * Nothing here mocks `sanitizeIncomingContent`: the identity mock used
 * elsewhere in the suite is one of the reasons this route looks well covered.
 *
 * Both cases are `test.failing` and flip the moment the write is made
 * conditional (an `expectedUpdatedAt` precondition, an optimistic-concurrency
 * column, or the existing lock).
 */

import { NextRequest } from "next/server";
import type { EditorAccess } from "@/lib/auth/editor-access";

const SITE_ID = "site-1";
const ELEMENT_ID = "headline";

interface ContentElementRow {
  id: string;
  site_id: string;
  element_id: string;
  language: string;
  variant: string;
  staging_content: string | null;
  staging_updated_at: string;
}

interface StagingHistoryRow {
  content_element_id: string;
  previous_content: string | null;
  new_content: string;
  user_email: string;
  action: string;
}

class FakeDb {
  element: ContentElementRow = {
    id: "element-1",
    site_id: SITE_ID,
    element_id: ELEMENT_ID,
    language: "en",
    variant: "default",
    staging_content: "Version A",
    staging_updated_at: "2026-08-07T10:00:00.000Z",
  };
  history: StagingHistoryRow[] = [];

  /**
   * When set, `single()` on content_elements parks until this many readers are
   * waiting, then releases them together. That is the interleaving the route
   * has no defence against: both collaborators read before either writes.
   */
  readBarrier = 0;
  private parked: Array<() => void> = [];

  async read(): Promise<ContentElementRow> {
    if (this.readBarrier > 1) {
      await new Promise<void>((resolve) => {
        this.parked.push(resolve);
        if (this.parked.length >= this.readBarrier) {
          const waiting = this.parked;
          this.parked = [];
          waiting.forEach((release) => release());
        }
      });
    }
    return { ...this.element };
  }
}

const db = new FakeDb();

/** What the route sees back from a write it awaits directly. */
interface SettledWrite {
  data: null;
  error: null;
}

/** What the route sees back from the read it does before writing. */
interface SettledRead {
  data: { id: string; staging_content: string | null };
}

/**
 * The chainable stand-in for a PostgREST builder. Annotated explicitly because
 * every method returns the object itself, which TypeScript cannot infer from a
 * self-referential initializer (TS7022).
 */
interface FakeQueryBuilder {
  select(): FakeQueryBuilder;
  eq(): FakeQueryBuilder;
  update(payload: Record<string, unknown>): FakeQueryBuilder;
  insert(payload: Record<string, unknown>): FakeQueryBuilder;
  single(): Promise<SettledRead>;
  then(
    onFulfilled: (value: SettledWrite) => unknown,
    onRejected: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

function makeServiceClient() {
  return {
    from(table: string) {
      const state: {
        table: string;
        op: "select" | "update" | "insert";
        payload: Record<string, unknown> | null;
      } = { table, op: "select", payload: null };

      const builder: FakeQueryBuilder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          state.op = "update";
          state.payload = payload;
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        async single() {
          const row = await db.read();
          return { data: { id: row.id, staging_content: row.staging_content } };
        },
        then(onFulfilled, onRejected) {
          const run = async (): Promise<SettledWrite> => {
            if (state.op === "update" && state.table === "content_elements") {
              db.element = {
                ...db.element,
                staging_content: String(state.payload!.staging_content),
                staging_updated_at: String(state.payload!.staging_updated_at),
              };
              return { data: null, error: null };
            }

            if (state.op === "insert" && state.table === "staging_history") {
              db.history = [
                ...db.history,
                state.payload as unknown as StagingHistoryRow,
              ];
              return { data: null, error: null };
            }

            return { data: null, error: null };
          };

          return run().then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => makeServiceClient()),
}));

// Only the session is stubbed. `requireEditorPermission` and the permission
// ladder run for real.
jest.mock("@/lib/auth/editor-access", () => {
  const actual = jest.requireActual("@/lib/auth/editor-access");
  return {
    ...actual,
    authorizeFirstPartyEditorAccess: jest.fn(),
  };
});

import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import { PUT } from "@/app/api/staging/content/[siteId]/route";

const mockAuthorize = authorizeFirstPartyEditorAccess as jest.MockedFunction<
  typeof authorizeFirstPartyEditorAccess
>;

function accessFor(email: string): EditorAccess {
  return {
    kind: "staging",
    siteId: SITE_ID,
    token: "first-party",
    permissions: ["view", "edit"],
    email,
    userId: email,
    stagingAccessId: null,
    verified: true,
  };
}

function putContent(params: {
  content: string;
  expectedUpdatedAt: string;
}): Promise<Response> {
  return PUT(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${SITE_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        elementId: ELEMENT_ID,
        content: params.content,
        expectedUpdatedAt: params.expectedUpdatedAt,
      }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as unknown as Promise<Response>;
}

describe("A-17 concurrent staging writes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db.element = {
      id: "element-1",
      site_id: SITE_ID,
      element_id: ELEMENT_ID,
      language: "en",
      variant: "default",
      staging_content: "Version A",
      staging_updated_at: "2026-08-07T10:00:00.000Z",
    };
    db.history = [];
    db.readBarrier = 0;
    mockAuthorize.mockResolvedValue(accessFor("first@example.com"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("stores a single edit (control)", async () => {
    const response = await putContent({
      content: "Version B",
      expectedUpdatedAt: db.element.staging_updated_at,
    });

    expect(response.status).toBe(200);
    expect(db.element.staging_content).toBe("Version B");
    expect(db.history).toHaveLength(1);
    expect(db.history[0].previous_content).toBe("Version A");
  });

  test.failing(
    "refuses a write whose expectedUpdatedAt no longer matches the row",
    async () => {
      // Both collaborators loaded the editor at this version.
      const sharedVersion = db.element.staging_updated_at;

      const first = await putContent({
        content: "Version B",
        expectedUpdatedAt: sharedVersion,
      });
      expect(first.status).toBe(200);

      // The second still quotes the version they loaded. The row has moved on.
      const second = await putContent({
        content: "Version C",
        expectedUpdatedAt: sharedVersion,
      });

      expect(second.status).toBe(409);
      // And the refusal must actually refuse: B survives.
      expect(db.element.staging_content).toBe("Version B");
    },
  );

  // Guard for the interleave case below: the read barrier releases, both
  // handlers run to completion, and both write. Without this a deadlock or a
  // rejected promise would make the `test.failing` below pass for the wrong
  // reason — it passes on any throw, including one of this file's making.
  it("completes both interleaved writes (guard for the audit-trail case)", async () => {
    db.readBarrier = 2;

    const responses = await Promise.all([
      putContent({
        content: "Version B",
        expectedUpdatedAt: db.element.staging_updated_at,
      }),
      putContent({
        content: "Version C",
        expectedUpdatedAt: db.element.staging_updated_at,
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(db.history).toHaveLength(2);
  });

  test.failing(
    "records what each edit actually replaced, not a stale read",
    async () => {
      // Genuine interleave: neither writer's read observes the other's write,
      // which is the window the route leaves open.
      db.readBarrier = 2;

      mockAuthorize
        .mockResolvedValueOnce(accessFor("first@example.com"))
        .mockResolvedValueOnce(accessFor("second@example.com"));

      await Promise.all([
        putContent({
          content: "Version B",
          expectedUpdatedAt: db.element.staging_updated_at,
        }),
        putContent({
          content: "Version C",
          expectedUpdatedAt: db.element.staging_updated_at,
        }),
      ]);

      expect(db.history).toHaveLength(2);

      // The audit trail must be a chain: whatever the second entry claims it
      // replaced has to be what the first entry actually wrote. Today both
      // entries claim they replaced "Version A", so one of them is a lie about
      // a change a customer may later be asked to explain.
      expect(db.history[1].previous_content).toBe(db.history[0].new_content);
    },
  );
});
