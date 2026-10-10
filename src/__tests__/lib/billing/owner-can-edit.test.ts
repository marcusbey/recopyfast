/**
 * s51 — editing needs the SITE OWNER's plan.
 *
 * Before s51 nothing on the write side read a plan: a lapsed trial, a
 * credits-only account, or an owner whose subscription had ended kept editing
 * and publishing live, and so did every editor and API key they had issued.
 * `checkOwnerCanEdit` is the one helper every write path asks. These pin the
 * three properties the story turns on:
 *
 *   - it is keyed by the site's owner, never by whoever is calling — an editor
 *     on a device grant has no account, and a collaborator's plan must not
 *     stand in for the owner's;
 *   - it fails closed, but a resolution error is not "your plan ended": a
 *     Supabase blip must not tell a paying customer they lapsed;
 *   - the refusal is a 402, never a 401/403 — the widget treats those as
 *     terminal and forgets the edit link (recopyfast.src.js
 *     `handleTerminalWriteFailure`).
 */

const mockServiceClient = { from: jest.fn() };

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockServiceClient),
}));

jest.mock("@/lib/feature-gating/permissions", () => ({
  resolveSiteOwnerId: jest.fn(),
}));

jest.mock("@/lib/billing/effective-plan", () => ({
  ...jest.requireActual("@/lib/billing/effective-plan"),
  resolveEntitlement: jest.fn(),
}));

import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";
import { resolveSiteOwnerId } from "@/lib/feature-gating/permissions";
import { resolveEntitlement } from "@/lib/billing/effective-plan";
import type { Entitlement } from "@/lib/billing/effective-plan";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";

const SITE = "11111111-1111-4111-8111-111111111111";
const OWNER = "owner-1";

const mockResolveSiteOwnerId = resolveSiteOwnerId as jest.MockedFunction<
  typeof resolveSiteOwnerId
>;
const mockResolveEntitlement = resolveEntitlement as jest.MockedFunction<
  typeof resolveEntitlement
>;

const ON_PLAN: Entitlement = {
  kind: "plan",
  planId: "pro",
  plan: { id: "pro", name: "Pro" } as SubscriptionPlan,
};
const CREDITS_ONLY: Entitlement = { kind: "credits", planId: null, plan: null };
const NOTHING: Entitlement = { kind: "none", planId: null, plan: null };

describe("checkOwnerCanEdit", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockResolveSiteOwnerId.mockResolvedValue(OWNER);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("allows a write when the site owner holds a plan", async () => {
    mockResolveEntitlement.mockResolvedValue(ON_PLAN);

    await expect(checkOwnerCanEdit(SITE)).resolves.toEqual({
      ok: true,
      ownerId: OWNER,
    });
  });

  it("refuses a credits-only owner as plan_ended", async () => {
    mockResolveEntitlement.mockResolvedValue(CREDITS_ONLY);

    await expect(checkOwnerCanEdit(SITE)).resolves.toEqual({
      ok: false,
      reason: "plan_ended",
    });
  });

  it("refuses an owner with no entitlement as plan_ended", async () => {
    mockResolveEntitlement.mockResolvedValue(NOTHING);

    await expect(checkOwnerCanEdit(SITE)).resolves.toEqual({
      ok: false,
      reason: "plan_ended",
    });
  });

  it("resolves the site's owner, never the caller", async () => {
    mockResolveEntitlement.mockResolvedValue(ON_PLAN);

    await checkOwnerCanEdit(SITE);

    // The signature is the first guard: there is no caller argument to key on.
    expect(checkOwnerCanEdit).toHaveLength(1);
    expect(mockResolveSiteOwnerId).toHaveBeenCalledWith(
      mockServiceClient,
      SITE,
    );
    expect(mockResolveEntitlement).toHaveBeenCalledTimes(1);
    expect(mockResolveEntitlement).toHaveBeenCalledWith(
      mockServiceClient,
      OWNER,
    );
  });

  it("refuses a site with no admin row as no_owner and logs it", async () => {
    mockResolveSiteOwnerId.mockResolvedValue(null);

    await expect(checkOwnerCanEdit(SITE)).resolves.toEqual({
      ok: false,
      reason: "no_owner",
    });
    expect(mockResolveEntitlement).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(SITE));
  });

  it("fails closed as unavailable when the owner lookup throws", async () => {
    mockResolveSiteOwnerId.mockRejectedValue(new Error("connection reset"));

    await expect(checkOwnerCanEdit(SITE)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(mockResolveEntitlement).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(SITE),
      expect.any(Error),
    );
  });

  it("fails closed as unavailable when the entitlement read throws", async () => {
    mockResolveEntitlement.mockRejectedValue(
      new Error("Failed to read plan entitlements: timeout"),
    );

    await expect(checkOwnerCanEdit(SITE)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(SITE),
      expect.any(Error),
    );
  });
});

describe("ownerCanEditRefusal", () => {
  it("answers plan_ended and no_owner with 402 { error, message, reason, upgradeRequired: true }", async () => {
    for (const reason of ["plan_ended", "no_owner"] as const) {
      const response = ownerCanEditRefusal({ ok: false, reason });

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        error: PLAN_ENDED_MESSAGE,
        message: PLAN_ENDED_MESSAGE,
        reason,
        upgradeRequired: true,
      });
    }
    expect(PLAN_ENDED_MESSAGE).toBe(
      "This site's plan has ended — the owner can reactivate it.",
    );
  });

  it("answers unavailable with a retryable 503 that is not the plan message", async () => {
    const response = ownerCanEditRefusal({ ok: false, reason: "unavailable" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.reason).toBe("unavailable");
    expect(body.upgradeRequired).toBeUndefined();
    expect(body.error).toEqual(expect.any(String));
    expect(body.message).toBe(body.error);
    expect(body.error).not.toBe(PLAN_ENDED_MESSAGE);
    expect(body.error).not.toMatch(/plan/i);
  });
});
