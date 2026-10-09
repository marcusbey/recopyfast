/**
 * s51 — `POST /api/staging/access` issues no new invite on a lapsed owner's
 * site.
 *
 * A staging invite is a credential that edits. Its writes are gated on the
 * owner's plan anyway, so inviting someone onto a lapsed site would only send
 * them a link that is refused on first save. The admin check lives inside
 * `createStagingAccess`, which also inserts, so the route reads the caller's
 * access first and gates only a caller who holds a row: anyone else keeps
 * today's refusal and learns nothing about the owner's plan.
 */

import { NextRequest } from "next/server";

const mockPermissionRow = jest.fn();
let mockSignedIn = true;

type MockRow = Record<string, unknown>;

/**
 * The site's editor directory as the signed-in admin's RLS client sees it.
 * Reads apply every `.eq()` they are given, so a lookup that drops the site
 * filter or compares the address as typed finds the wrong row.
 */
const mockDirectory: { rows: MockRow[]; readFails: boolean } = {
  rows: [],
  readFails: false,
};
const mockInserts: Array<{ table: string; payload: MockRow }> = [];
/** Every table the route reads or writes, in order (s72: refusal reads none). */
const mockTablesRead: string[] = [];

function mockReadDirectory(filters: Array<[string, unknown]>) {
  if (mockDirectory.readFails) {
    return { data: null, error: { message: "connection reset" } };
  }
  const found = mockDirectory.rows.filter((row) =>
    filters.every(([column, value]) => row[column] === value),
  );
  return { data: found[0] ?? null, error: null };
}

/** What PostgREST hands back for an inserted staging_access row. */
function mockCreatedRow(payload: MockRow): MockRow {
  return {
    ...payload,
    id: "access-new",
    last_used_at: null,
    created_at: new Date().toISOString(),
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: {
              user: mockSignedIn
                ? { id: "user-1", email: "owner@example.com" }
                : null,
            },
            error: null,
          }),
      },
      from: (table: string) => {
        mockTablesRead.push(table);
        const filters: Array<[string, unknown]> = [];
        let inserted: MockRow | null = null;
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          insert: (payload: MockRow) => {
            inserted = payload;
            mockInserts.push({ table, payload });
            return chain;
          },
          maybeSingle: () =>
            Promise.resolve(
              table === "site_editors"
                ? mockReadDirectory(filters)
                : mockPermissionRow(),
            ),
          single: () =>
            Promise.resolve(
              table === "sites"
                ? { data: { domain: "example.com" }, error: null }
                : inserted
                  ? { data: mockCreatedRow(inserted), error: null }
                  : mockPermissionRow(),
            ),
        };
        return chain;
      },
    }),
  ),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/email/resend", () => ({
  sendStagingVerificationEmail: jest.fn(() => Promise.resolve({ sent: true })),
}));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

import { POST } from "@/app/api/staging/access/route";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { sendStagingVerificationEmail } from "@/lib/email/resend";
import {
  checkOwnerCanEdit,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";

const SITE_ID = "site-123";

const mockCheckOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;

function inviteRequest(): NextRequest {
  return new NextRequest("https://www.recopyfa.st/api/staging/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      siteId: SITE_ID,
      type: "invite",
      email: "editor@example.com",
      permissions: ["view", "edit"],
    }),
  });
}

let createStagingAccess: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockSignedIn = true;
  jest.spyOn(console, "error").mockImplementation(() => {});
  createStagingAccess = jest
    .spyOn(StagingAccessManager, "createStagingAccess")
    .mockRejectedValue(new Error("Only site admins can create staging access"));
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * The no-oracle rule (s51): an unauthenticated caller — or one with no access
 * on this site — must get the same answer whether the owner's plan lapsed or
 * not, and the plan must not even be read. Sent twice, once per plan state.
 */
async function answerWhateverThePlan(send: () => Promise<Response>) {
  mockCheckOwnerCanEdit.mockResolvedValue({ ok: false, reason: "plan_ended" });
  const lapsed = await send();
  const lapsedAnswer = { status: lapsed.status, body: await lapsed.json() };

  mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });
  const paying = await send();
  const payingAnswer = { status: paying.status, body: await paying.json() };

  expect(lapsedAnswer).toEqual(payingAnswer);
  expect(JSON.stringify(lapsedAnswer.body)).not.toContain(PLAN_ENDED_MESSAGE);
  expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  return lapsedAnswer;
}

describe("s51 — POST /api/staging/access", () => {
  it("staging/access refuses a new invite on a lapsed owner's site", async () => {
    mockPermissionRow.mockReturnValue({
      data: { permission: "admin" },
      error: null,
    });
    mockCheckOwnerCanEdit.mockResolvedValue({
      ok: false,
      reason: "plan_ended",
    });

    const response = await POST(inviteRequest());

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      error: PLAN_ENDED_MESSAGE,
      upgradeRequired: true,
    });
    expect(mockCheckOwnerCanEdit).toHaveBeenCalledWith(SITE_ID);
    expect(createStagingAccess).not.toHaveBeenCalled();
  });

  it("answers a caller with no access on the site as today, identically whether the owner lapsed or pays", async () => {
    mockPermissionRow.mockReturnValue({ data: null, error: null });

    const answer = await answerWhateverThePlan(() => POST(inviteRequest()));

    expect(answer).toEqual({
      status: 403,
      body: { error: "Only site admins can create staging access" },
    });
  });

  it("answers a caller with no session identically whether the owner lapsed or pays", async () => {
    mockSignedIn = false;

    const answer = await answerWhateverThePlan(() => POST(inviteRequest()));

    expect(answer).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(createStagingAccess).not.toHaveBeenCalled();
  });
});

/**
 * s68c review, minor 3 — no staging invite for a removed editor.
 *
 * Since s68c every staging validator refuses a token whose address has a
 * revoked `site_editors` row for the site (HTTP `isEditorRevoked`, the socket's
 * `resolveStagingGrant`). Issuing one anyway "succeeded": the row was written,
 * the code was e-mailed, and the link was then refused everywhere with a
 * message that names no cause. The owner is told at issuance instead, in words
 * that say what to do — this route is signed-in and admin-only, so the
 * no-oracle rule of the public staging endpoints does not apply here.
 */
describe("s68c — POST /api/staging/access refuses an invite to a removed editor", () => {
  const REMOVED_EDITOR_MESSAGE =
    "This address was removed as an editor of this site. Re-add them as an editor before sending a staging invite.";

  function inviteFor(email: string): NextRequest {
    return new NextRequest("https://www.recopyfa.st/api/staging/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: SITE_ID,
        type: "invite",
        email,
        permissions: ["view", "edit"],
      }),
    });
  }

  function directoryRow(overrides: MockRow = {}): MockRow {
    return {
      id: "editor-1",
      site_id: SITE_ID,
      email: "editor@example.com",
      revoked_at: new Date(Date.now() - 60 * 1000).toISOString(),
      ...overrides,
    };
  }

  function stagingInserts() {
    return mockInserts.filter((insert) => insert.table === "staging_access");
  }

  beforeEach(() => {
    // The real manager, against the admin's RLS client double above.
    createStagingAccess.mockRestore();
    mockPermissionRow.mockReturnValue({
      data: { permission: "admin" },
      error: null,
    });
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "user-1" });
    mockDirectory.rows = [];
    mockDirectory.readFails = false;
    mockInserts.length = 0;
  });

  it.each([
    ["as the directory stores it", "editor@example.com"],
    ["in another case, with stray spaces", "  Editor@Example.COM "],
  ])(
    "answers 409 with a readable message for an address typed %s, and creates and sends nothing",
    async (_label, email) => {
      mockDirectory.rows = [directoryRow()];

      const response = await POST(inviteFor(email));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: REMOVED_EDITOR_MESSAGE,
      });
      expect(stagingInserts()).toEqual([]);
      expect(sendStagingVerificationEmail).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["has no directory row", []],
    ["has a directory row that stands", [directoryRow({ revoked_at: null })]],
    [
      "was removed on another site only",
      [directoryRow({ site_id: "site-elsewhere" })],
    ],
  ])(
    "issues the invite when the address %s (control)",
    async (_label, rows) => {
      mockDirectory.rows = rows;

      const response = await POST(inviteFor("Editor@Example.com"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        emailDelivered: true,
      });
      expect(stagingInserts()).toHaveLength(1);
      expect(sendStagingVerificationEmail).toHaveBeenCalledTimes(1);
    },
  );

  it("issues nothing when the directory cannot be read (fails closed)", async () => {
    mockDirectory.rows = [directoryRow()];
    mockDirectory.readFails = true;

    const response = await POST(inviteFor("editor@example.com"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create staging access",
    });
    expect(stagingInserts()).toEqual([]);
    expect(sendStagingVerificationEmail).not.toHaveBeenCalled();
  });
});

/**
 * s68b M6 — the invite `label` is admin-chosen free text mailed, beside a real
 * code, to an address the admin chooses. The emails now escape it; the route
 * bounds it first, so nothing is created for a label that is not a string,
 * runs past 80 characters, or carries control characters (header-shaped
 * `\r\nBcc:` text included).
 */
describe("s68b — POST /api/staging/access label rule", () => {
  function labelledInvite(label: unknown): NextRequest {
    return new NextRequest("https://www.recopyfa.st/api/staging/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: SITE_ID,
        type: "invite",
        email: "editor@example.com",
        permissions: ["view", "edit"],
        label,
      }),
    });
  }

  beforeEach(() => {
    mockPermissionRow.mockReturnValue({
      data: { permission: "admin" },
      error: null,
    });
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });
  });

  it.each([
    ["a non-string label", 42],
    ["a label over 80 characters", "x".repeat(81)],
    ["a label with control characters", "Launch\r\nBcc: victim@example.com"],
  ])("refuses %s with 400 and creates nothing", async (_name, label) => {
    const response = await POST(labelledInvite(label));

    expect(response.status).toBe(400);
    expect(createStagingAccess).not.toHaveBeenCalled();
    expect(sendStagingVerificationEmail).not.toHaveBeenCalled();
  });

  it("stores and emails a normal label", async () => {
    createStagingAccess.mockResolvedValue({
      access: { token: "staging-token", label: "Spring launch" },
      verificationCode: "482913",
    });

    const response = await POST(labelledInvite("Spring launch"));

    expect(response.status).toBe(200);
    expect(createStagingAccess).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Spring launch" }),
    );
    expect(sendStagingVerificationEmail).toHaveBeenCalledWith(
      "editor@example.com",
      "482913",
      "Spring launch",
    );
  });
});

/**
 * s72 — the invite's address is an address.
 *
 * A staging invite's `email` becomes the `created_by` of every version its
 * holder saves, and the embed's History tab rendered that as markup on the
 * customer's origin (s70a review F1). The route checked only that an email was
 * present, so a site admin could invite `<img/src/onerror=alert(1)>@x.co`. It
 * now refuses anything that is not a string holding a valid address — before
 * the site is read, before anything is created or mailed — with a fixed message
 * that never repeats what was sent.
 */
describe("s72 — POST /api/staging/access email rule", () => {
  const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

  function inviteWithEmail(email: unknown): NextRequest {
    return new NextRequest("https://www.recopyfa.st/api/staging/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: SITE_ID,
        type: "invite",
        email,
        permissions: ["view", "edit"],
      }),
    });
  }

  beforeEach(() => {
    mockPermissionRow.mockReturnValue({
      data: { permission: "admin" },
      error: null,
    });
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });
    // An admin on a paying site: whatever reaches the manager is created and
    // mailed, so a refusal below is the address rule and nothing else.
    createStagingAccess.mockResolvedValue({
      access: { token: "staging-token", email: "editor@example.com" },
      verificationCode: "482913",
    });
    mockTablesRead.length = 0;
  });

  it.each([
    ["a number", 42],
    ["an array holding an address", ["editor@example.com"]],
    ["an object", {}],
    ["an address-shaped payload", "<img/src/onerror=alert(1)>@x.co"],
    ["a dotless domain", "editor@example"],
    ["255 characters", "a".repeat(243) + "@example.com"],
  ])(
    "refuses %s with 400, creates and sends nothing, echoes nothing",
    async (_case, email) => {
      const response = await POST(inviteWithEmail(email));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ error: INVALID_EMAIL_MESSAGE });
      const sent = typeof email === "string" ? email : JSON.stringify(email);
      expect(JSON.stringify(body)).not.toContain(sent);
      expect(createStagingAccess).not.toHaveBeenCalled();
      expect(sendStagingVerificationEmail).not.toHaveBeenCalled();
      // Refused before the site is read (review minor 2): no table touched.
      expect(mockTablesRead).toEqual([]);
    },
  );

  it("creates the invite for the trimmed address when it is sent with stray spaces", async () => {
    const response = await POST(inviteWithEmail(" editor@example.com "));

    expect(response.status).toBe(200);
    expect(createStagingAccess).toHaveBeenCalledWith(
      expect.objectContaining({ email: "editor@example.com" }),
    );
    // The code goes to the address that was checked and stored.
    expect(sendStagingVerificationEmail).toHaveBeenCalledWith(
      "editor@example.com",
      "482913",
      undefined,
    );
  });
});
