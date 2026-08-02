/**
 * Collaborator seats are a plan quota (H6).
 *
 * The limit was declared in the plans table — Starter sells 0 seats, Pro sells
 * 5 — and never read. `canAddCollaborator` was written, correct, and had zero
 * callers anywhere in the codebase, while POST /api/sites/[siteId]/share
 * inserted into `site_permissions` unguarded. Both plans were unlimited in
 * practice.
 *
 * These cover `canShareSite`, which is the piece that decides *whose* plan
 * pays.
 */

const mockSupabase = {
  from: jest.fn(),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
  hasAnyEntitlement: jest.requireActual("@/lib/billing/effective-plan")
    .hasAnyEntitlement,
}));

jest.mock("@/lib/credits/system", () => ({
  getUserCreditBalance: jest.fn(),
  consumeCredits: jest.fn(),
  CREDIT_COSTS: { AI_SUGGESTION: 1, AI_TRANSLATION: 1 },
}));

import { canShareSite } from "@/lib/feature-gating/permissions";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import type { Entitlement } from "@/lib/billing/effective-plan";

const mockGetEffectivePlan = getEffectivePlan as jest.MockedFunction<
  typeof getEffectivePlan
>;

const planWithSeats = (seats: number, name = "Pro"): Entitlement =>
  ({
    kind: "plan",
    planId: "pro",
    plan: { name, limits: { collaborators: seats } },
  }) as unknown as Entitlement;

/**
 * `site_permissions` is read twice with different filters: once to find the
 * owner (`permission = admin`) and once to count existing seats. Routed by
 * which filters were applied rather than by call order, so the test does not
 * silently pass if the two reads are reordered.
 */
function stubSitePermissions({
  ownerId,
  seatCount,
  ownerLookupError,
}: {
  ownerId: string | null;
  seatCount: number;
  ownerLookupError?: string;
}) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table !== "site_permissions") {
      throw new Error(`unexpected table read: ${table}`);
    }

    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      eq: jest.fn((column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      }),
      neq: jest.fn((column: string, value: unknown) => {
        filters[`neq:${column}`] = value;
        return chain;
      }),
      maybeSingle: jest.fn(() =>
        Promise.resolve(
          ownerLookupError
            ? { data: null, error: { message: ownerLookupError } }
            : {
                data: ownerId ? { user_id: ownerId } : null,
                error: null,
              },
        ),
      ),
      // The seat count is a head request; it resolves as a thenable.
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count: seatCount, error: null }).then(resolve),
    };
    return chain;
  });
}

describe("canShareSite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("charges the seat to the site owner, not to the manager doing the sharing", async () => {
    // The whole point: a Starter owner must not get unlimited seats by having
    // a Pro manager issue the invitations.
    stubSitePermissions({ ownerId: "owner-1", seatCount: 0 });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    await canShareSite("site-1", "manager-9");

    expect(mockGetEffectivePlan).toHaveBeenCalledWith("owner-1");
    expect(mockGetEffectivePlan).not.toHaveBeenCalledWith("manager-9");
  });

  it("refuses a plan that sells no collaborators", async () => {
    stubSitePermissions({ ownerId: "owner-1", seatCount: 0 });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(0, "Starter"));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.upgradeRequired).toBe(true);
  });

  it("permits the last seat inside the limit", async () => {
    // Edge worth pinning in both directions: an off-by-one here either sells a
    // seat that was not bought or withholds one that was.
    stubSitePermissions({ ownerId: "owner-1", seatCount: 4 });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(true);
  });

  it("refuses the seat past the limit", async () => {
    stubSitePermissions({ ownerId: "owner-1", seatCount: 5 });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.maxLimit).toBe(5);
  });

  it("refuses an owner holding only credits", async () => {
    // Seats are plan-shaped. A wallet balance is not an allowance.
    stubSitePermissions({ ownerId: "owner-1", seatCount: 0 });
    mockGetEffectivePlan.mockResolvedValue({
      kind: "credits",
      planId: null,
      plan: null,
    });

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/needs a plan/i);
  });

  it("refuses an owner with no entitlement at all", async () => {
    stubSitePermissions({ ownerId: "owner-1", seatCount: 0 });
    mockGetEffectivePlan.mockResolvedValue({
      kind: "none",
      planId: null,
      plan: null,
    });

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
  });

  it("falls back to the actor and says so when a site has no owner row", async () => {
    stubSitePermissions({ ownerId: null, seatCount: 0 });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    await canShareSite("site-1", "manager-9");

    expect(mockGetEffectivePlan).toHaveBeenCalledWith("manager-9");
    expect(console.error).toHaveBeenCalled();
  });

  it("throws rather than treating an unreadable owner lookup as unowned", async () => {
    // Defaulting here would read a database failure as "no owner, charge the
    // actor" — the quota equivalent of failing open.
    stubSitePermissions({
      ownerId: null,
      seatCount: 0,
      ownerLookupError: "connection reset",
    });

    await expect(canShareSite("site-1", "manager-9")).rejects.toThrow(
      /Failed to resolve site owner/,
    );
  });
});
