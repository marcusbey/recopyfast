/**
 * s51 — `POST /api/edit-sessions/extend` will not prolong a session on a
 * lapsed owner's site.
 *
 * Extending slides an edit session up to its 24-hour ceiling. The session's
 * writes are gated anyway, but prolonging a credential the owner's plan no
 * longer backs is issuance, and issuance refuses up front — after the session
 * itself has been validated, so the refusal is no oracle, and without touching
 * the session: nothing is revoked, and it works again once the owner pays.
 */

import { NextRequest } from "next/server";

type Recorded = { table: string; op: string };
const mockOps: Recorded[] = [];

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: () => {
          mockOps.push({ table, op: "update" });
          return chain;
        },
        single: () =>
          Promise.resolve({
            data: { created_at: new Date().toISOString() },
            error: null,
          }),
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(ok),
      };
      return chain;
    },
  })),
}));
jest.mock("@/lib/auth/editor-access", () => ({
  ...jest.requireActual("@/lib/auth/editor-access"),
  validateEditorAccess: jest.fn(),
}));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

import { POST } from "@/app/api/edit-sessions/extend/route";
import { validateEditorAccess } from "@/lib/auth/editor-access";
import {
  checkOwnerCanEdit,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";

const SITE_ID = "site-123";

const mockValidateEditorAccess = validateEditorAccess as jest.MockedFunction<
  typeof validateEditorAccess
>;
const mockCheckOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;

function extendRequest(): NextRequest {
  return new NextRequest("https://www.recopyfa.st/api/edit-sessions/extend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId: SITE_ID, editToken: "edit-token" }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOps.length = 0;
  mockValidateEditorAccess.mockResolvedValue({
    valid: true,
    access: {
      kind: "edit-session",
      siteId: SITE_ID,
      token: "edit-token",
      permissions: ["view", "edit"],
      editSessionId: "session-1",
    },
  });
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

describe("s51 — POST /api/edit-sessions/extend", () => {
  it("edit-sessions/extend refuses to prolong a session on a lapsed owner's site", async () => {
    mockCheckOwnerCanEdit.mockResolvedValue({
      ok: false,
      reason: "plan_ended",
    });

    const response = await POST(extendRequest());

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      message: PLAN_ENDED_MESSAGE,
      reason: "plan_ended",
    });
    expect(mockCheckOwnerCanEdit).toHaveBeenCalledWith(SITE_ID);
    expect(mockOps).toEqual([]);
  });

  it("still extends a session on a paying owner's site", async () => {
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });

    const response = await POST(extendRequest());

    expect(response.status).toBe(200);
    expect(mockOps).toEqual([{ table: "edit_sessions", op: "update" }]);
  });

  it("answers a token that does not validate identically whether the owner lapsed or pays", async () => {
    mockValidateEditorAccess.mockResolvedValue({
      valid: false,
      error: "Invalid edit session",
      status: 401,
    });

    const answer = await answerWhateverThePlan(() => POST(extendRequest()));

    expect(answer).toEqual({
      status: 401,
      body: { error: "Invalid edit session" },
    });
    expect(mockOps).toEqual([]);
  });
});
