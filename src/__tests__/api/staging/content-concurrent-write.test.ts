/**
 * A-17 — PUT /api/staging/content/[siteId] remains last-write-wins because it
 * does not enforce the caller's expectedUpdatedAt value.
 *
 * The atomic save function now owns the draft and history write under a row
 * lock. Concurrent calls are serialized at that database boundary, so each
 * history entry truthfully records the content it replaced even though the
 * later edit may still overwrite the earlier one.
 *
 * Nothing here mocks `sanitizeIncomingContent`: the identity mock used
 * elsewhere in the suite is one of the reasons this route looks well covered.
 *
 * The lost-update case remains `test.failing`: the route still ignores
 * `expectedUpdatedAt`. The audit-chain case is now a plain test because the
 * atomic save function locks the row and records the value each edit actually
 * replaced inside the same transaction.
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
}

const db = new FakeDb();

let atomicSaveQueue = Promise.resolve();

function makeServiceClient() {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe("save_staging_content_atomic");
      const save = atomicSaveQueue.then(() => {
        const previousContent = db.element.staging_content;
        const now = new Date().toISOString();
        db.element = {
          ...db.element,
          staging_content: String(args.p_staging_content),
          staging_updated_at: now,
        };
        db.history = [
          ...db.history,
          {
            content_element_id: db.element.id,
            previous_content: previousContent,
            new_content: String(args.p_staging_content),
            user_email: String(args.p_user_email),
            action: previousContent === null ? "create" : "update",
          },
        ];
        return {
          data: [{ content_element_id: db.element.id, updated_at: now }],
          error: null,
        };
      });
      atomicSaveQueue = save.then(
        () => undefined,
        () => undefined,
      );
      return save;
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
    atomicSaveQueue = Promise.resolve();
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

  // Guard for the concurrent case below: both handlers run to completion and
  // both write. Without this, a rejected promise would leave the audit-chain
  // assertion below unexercised.
  it("completes both interleaved writes (guard for the audit-trail case)", async () => {
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

  test("records what each edit actually replaced, not a stale read", async () => {
    // Both requests enter together. The fake RPC queue models the database row
    // lock: the second transaction sees the first transaction's committed
    // value before it records previous_content.

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
    // replaced has to be what the first entry actually wrote.
    expect(db.history[1].previous_content).toBe(db.history[0].new_content);
  });
});
