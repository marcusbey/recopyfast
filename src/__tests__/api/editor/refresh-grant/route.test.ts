/**
 * s51 — `POST /api/editor/refresh-grant` will not rotate a lapsed owner's grant.
 *
 * Refreshing slides a device grant's expiry by minting a replacement and
 * retiring the old token — issuance, which a lapsed owner's site does not get.
 * The refusal must not look like a verdict on the grant: no `nextAction`, so
 * the widget keeps the grant it holds (it ignores every refresh refusal but
 * `refresh`), and nothing is rotated or revoked. When the owner picks a plan
 * the same grant slides again.
 *
 * It is asked only once the grant itself has been authenticated. A garbage
 * grant with a public site id and a forged Origin must hear what it always
 * heard, not whether the customer lapsed.
 */

// Must precede the imports: editor-crypto memoises the signing key on first use.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";

jest.mock("@/lib/auth/editor-grants", () => ({
  ...jest.requireActual("@/lib/auth/editor-grants"),
  validateDeviceGrant: jest.fn(),
  refreshDeviceGrant: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  ...jest.requireActual("@/lib/api/rate-limit"),
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

import { POST } from "@/app/api/editor/refresh-grant/route";
import {
  refreshDeviceGrant,
  validateDeviceGrant,
} from "@/lib/auth/editor-grants";
import {
  checkOwnerCanEdit,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";

const SITE_ID = "site-1";

const mockValidateDeviceGrant = validateDeviceGrant as jest.MockedFunction<
  typeof validateDeviceGrant
>;
const mockRefreshDeviceGrant = refreshDeviceGrant as jest.MockedFunction<
  typeof refreshDeviceGrant
>;
const mockCheckOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;

const actualGrants = jest.requireActual<
  typeof import("@/lib/auth/editor-grants")
>("@/lib/auth/editor-grants");

function refreshRequest(grant = "rcfg1.held"): NextRequest {
  return new NextRequest("https://www.recopyfa.st/api/editor/refresh-grant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://helloworld.com",
      "User-Agent": "jest",
    },
    body: JSON.stringify({ grant, siteId: SITE_ID }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockValidateDeviceGrant.mockResolvedValue({
    valid: true,
    grant: {
      grantId: "grant-1",
      siteEditorId: "editor-1",
      siteId: SITE_ID,
      email: "bob@example.com",
      permissions: ["view", "edit"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  } as Awaited<ReturnType<typeof validateDeviceGrant>>);
  mockRefreshDeviceGrant.mockResolvedValue({
    ok: true,
    grant: "rcfg1.rotated",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  mockCheckOwnerCanEdit.mockResolvedValue({
    ok: false,
    reason: "plan_ended",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("s51 — POST /api/editor/refresh-grant", () => {
  it("refresh-grant refuses to rotate a lapsed owner's grant and revokes nothing", async () => {
    const response = await POST(refreshRequest());

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      reason: "plan_ended",
      message: PLAN_ENDED_MESSAGE,
    });
    // No `nextAction`: in particular never "refresh", which would send the
    // widget re-reading storage for a rotation that never happened.
    expect(body).not.toHaveProperty("nextAction");
    expect(mockCheckOwnerCanEdit).toHaveBeenCalledWith(SITE_ID);
    // refreshDeviceGrant is what retires the old token and mints the new one.
    expect(mockRefreshDeviceGrant).not.toHaveBeenCalled();
  });

  it("reads no plan for a grant that does not authenticate", async () => {
    mockValidateDeviceGrant.mockResolvedValue({
      valid: false,
      reason: "unknown",
    } as Awaited<ReturnType<typeof validateDeviceGrant>>);
    mockRefreshDeviceGrant.mockResolvedValue({ ok: false, reason: "unknown" });

    const response = await POST(refreshRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "unknown",
      nextAction: "verify",
    });
    expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  });

  it("answers a garbage grant identically whether the owner lapsed or pays", async () => {
    // The real validator and rotator: a forged token fails signature decoding
    // before any database read, which is exactly the caller this must not
    // tell anything to — anyone can send one with a public site id.
    mockValidateDeviceGrant.mockImplementation(
      actualGrants.validateDeviceGrant,
    );
    mockRefreshDeviceGrant.mockImplementation(actualGrants.refreshDeviceGrant);

    const answerWhen = async (
      plan: Awaited<ReturnType<typeof checkOwnerCanEdit>>,
    ) => {
      mockCheckOwnerCanEdit.mockResolvedValue(plan);
      const response = await POST(refreshRequest("rcfg1.forged.token"));
      return { status: response.status, body: await response.json() };
    };

    const lapsed = await answerWhen({ ok: false, reason: "plan_ended" });
    const paying = await answerWhen({ ok: true, ownerId: "owner-1" });

    expect(lapsed).toEqual(paying);
    expect(lapsed.status).toBe(401);
    expect(JSON.stringify(lapsed.body)).not.toContain(PLAN_ENDED_MESSAGE);
    expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  });

  it("answers a failed plan read with a retryable 503 that rotates nothing", async () => {
    mockCheckOwnerCanEdit.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });

    const response = await POST(refreshRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/plan/i);
    expect(mockRefreshDeviceGrant).not.toHaveBeenCalled();
  });

  it("still rotates a paying owner's grant", async () => {
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });

    const response = await POST(refreshRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      grant: "rcfg1.rotated",
    });
  });
});

describe("s76 — A-28: the body does not choose the replacement's lifetime", () => {
  it("does not forward the body's rememberDevice to the rotation", async () => {
    // The lineage decides (refreshDeviceGrant reads the row it rotates). This
    // route used to read `rememberDevice` off the JSON body and hand it on,
    // which is how a session-only grant became a seven-day one.
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });

    const response = await POST(
      new NextRequest("https://www.recopyfa.st/api/editor/refresh-grant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://helloworld.com",
          "User-Agent": "jest",
        },
        body: JSON.stringify({
          grant: "rcfg1.held",
          siteId: SITE_ID,
          rememberDevice: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRefreshDeviceGrant).toHaveBeenCalledTimes(1);
    expect(mockRefreshDeviceGrant.mock.calls[0][0]).not.toHaveProperty(
      "rememberDevice",
    );
  });
});
