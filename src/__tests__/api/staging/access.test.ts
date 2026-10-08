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
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve(mockPermissionRow()),
          single: () =>
            Promise.resolve(
              table === "sites"
                ? { data: { domain: "example.com" }, error: null }
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
import { sendStagingVerificationEmail } from "@/lib/email/resend";
import { StagingAccessManager } from "@/lib/auth/staging-access";
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
