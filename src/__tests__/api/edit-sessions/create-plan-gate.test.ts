/**
 * s51 — `POST /api/edit-sessions/create` refuses a lapsed owner's site up front.
 *
 * An edit session is a credential that writes for up to 24 hours. Every write
 * it could make is already gated on the owner's plan, but minting one for a
 * site whose owner has lapsed only hands out a link that will be refused on
 * first save — so the refusal belongs here, with the owner's message, before
 * anything is inserted.
 *
 * The trap is ordering. Authorization hides inside `createEditSession`, which
 * also inserts; gating before it would answer "plan ended" to any signed-in
 * account naming any site id — an oracle on a stranger's billing. So the route
 * asks `authorizeFirstPartyEditorAccess` first (real here, against a stubbed
 * `site_permissions` read) and only gates a caller who holds a row.
 */

import { NextRequest } from "next/server";

const mockPermissionRow = jest.fn();
let mockSignedIn = true;

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
      from: () => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve(mockPermissionRow()),
          single: () =>
            Promise.resolve({
              data: { id: "site-123", domain: "example.com", name: "Example" },
              error: null,
            }),
        };
        return chain;
      },
    }),
  ),
}));
jest.mock("@/lib/auth/edit-sessions", () => ({
  EditSessionManager: { createEditSession: jest.fn() },
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

import { POST } from "@/app/api/edit-sessions/create/route";
import { EditSessionManager } from "@/lib/auth/edit-sessions";
import {
  checkOwnerCanEdit,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";

const SITE_ID = "site-123";

const mockCreateEditSession =
  EditSessionManager.createEditSession as jest.MockedFunction<
    typeof EditSessionManager.createEditSession
  >;
const mockCheckOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;

function createRequest(): NextRequest {
  return new NextRequest(
    "https://app.recopyfast.test/api/edit-sessions/create",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId: SITE_ID, permissions: ["edit"] }),
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignedIn = true;
  jest.spyOn(console, "error").mockImplementation(() => {});
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("s51 — POST /api/edit-sessions/create", () => {
  it("edit-sessions/create refuses a lapsed owner's site with the plan-ended message and inserts no session", async () => {
    mockPermissionRow.mockReturnValue({
      data: { permission: "admin" },
      error: null,
    });
    mockCheckOwnerCanEdit.mockResolvedValue({
      ok: false,
      reason: "plan_ended",
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(402);
    // The dashboard's Edit website button reads `error`.
    await expect(response.json()).resolves.toMatchObject({
      error: PLAN_ENDED_MESSAGE,
      upgradeRequired: true,
    });
    expect(mockCheckOwnerCanEdit).toHaveBeenCalledWith(SITE_ID);
    expect(mockCreateEditSession).not.toHaveBeenCalled();
  });

  it("edit-sessions/create answers a caller with no access on the site as today, reading no plan", async () => {
    mockPermissionRow.mockReturnValue({ data: null, error: null });
    // What the real `createEditSession` answers for a caller with no row.
    mockCreateEditSession.mockResolvedValue(null);

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create edit session. Check your site permissions.",
    });
    expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  });

  it("answers a caller with no session identically whether the owner lapsed or pays", async () => {
    mockSignedIn = false;

    const answer = await answerWhateverThePlan(() => POST(createRequest()));

    expect(answer).toEqual({
      status: 401,
      body: { error: "Authentication required" },
    });
    expect(mockCreateEditSession).not.toHaveBeenCalled();
  });

  it("answers a signed-in caller with no access on the site identically whether the owner lapsed or pays", async () => {
    mockPermissionRow.mockReturnValue({ data: null, error: null });
    mockCreateEditSession.mockResolvedValue(null);

    const answer = await answerWhateverThePlan(() => POST(createRequest()));

    expect(answer.status).toBe(403);
  });
});
