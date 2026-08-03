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
 * pays, and the seat count itself, which spans both tables that grant standing
 * access: `site_permissions` and `site_editors`. That second half is the
 * interesting one — a per-table count would let the limit be avoided by
 * alternating between the two doors, each independently allowing N.
 */

const mockSupabase = {
  from: jest.fn(),
};

const mockServiceClient = {
  from: jest.fn(),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockServiceClient),
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
 * Stubs both tables a seat can live in.
 *
 * `site_permissions` is read twice with different shapes: the owner lookup ends
 * in `.maybeSingle()`, the seat count is awaited directly as a head request.
 * Routed by that difference rather than by call order, so the test does not
 * silently pass if the two reads are reordered.
 *
 * `site_editors` is read through the service-role client, because its RLS
 * SELECT policy demands `admin` on the site and the share path admits managers
 * — a request-scoped read would return 0 for exactly the caller most able to
 * exploit it.
 */
function stubSeatTables({
  ownerId,
  collaboratorSeats,
  editorSeats,
  ownerLookupError,
  collaboratorCountError,
  editorCountError,
}: {
  ownerId: string | null;
  collaboratorSeats: number;
  editorSeats: number;
  ownerLookupError?: string;
  collaboratorCountError?: string;
  editorCountError?: string;
}) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table !== "site_permissions") {
      throw new Error(`unexpected table read: ${table}`);
    }

    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      neq: jest.fn(() => chain),
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
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          collaboratorCountError
            ? { count: null, error: { message: collaboratorCountError } }
            : { count: collaboratorSeats, error: null },
        ).then(resolve),
    };
    return chain;
  });

  mockServiceClient.from.mockImplementation((table: string) => {
    if (table !== "site_editors") {
      throw new Error(`unexpected service-role read: ${table}`);
    }

    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      is: jest.fn(() => chain),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          editorCountError
            ? { count: null, error: { message: editorCountError } }
            : { count: editorSeats, error: null },
        ).then(resolve),
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
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    await canShareSite("site-1", "manager-9");

    expect(mockGetEffectivePlan).toHaveBeenCalledWith("owner-1");
    expect(mockGetEffectivePlan).not.toHaveBeenCalledWith("manager-9");
  });

  it("refuses a plan that sells no collaborators", async () => {
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(0, "Starter"));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.upgradeRequired).toBe(true);
    // Names the plan, so a Starter owner is not left guessing which one they
    // are on or what buying more would look like.
    expect(result.reason).toContain("Starter");
  });

  it("permits the last seat inside the limit", async () => {
    // Edge worth pinning in both directions: an off-by-one here either sells a
    // seat that was not bought or withholds one that was.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 4,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(true);
  });

  it("refuses the seat past the limit", async () => {
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 5,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.maxLimit).toBe(5);
  });

  it("refuses an owner holding only credits", async () => {
    // Seats are plan-shaped. A wallet balance is not an allowance.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
    });
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
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue({
      kind: "none",
      planId: null,
      plan: null,
    });

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
  });

  it("falls back to the actor and says so when a site has no owner row", async () => {
    stubSeatTables({ ownerId: null, collaboratorSeats: 0, editorSeats: 0 });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    await canShareSite("site-1", "manager-9");

    expect(mockGetEffectivePlan).toHaveBeenCalledWith("manager-9");
    expect(console.error).toHaveBeenCalled();
  });

  it("throws rather than treating an unreadable owner lookup as unowned", async () => {
    // Defaulting here would read a database failure as "no owner, charge the
    // actor" — the quota equivalent of failing open.
    stubSeatTables({
      ownerId: null,
      collaboratorSeats: 0,
      editorSeats: 0,
      ownerLookupError: "connection reset",
    });

    await expect(canShareSite("site-1", "manager-9")).rejects.toThrow(
      /Failed to resolve site owner/,
    );
  });
});

/**
 * The seat count spans both tables.
 *
 * This is the half that makes the limit hold. `canAddCollaborator` counted
 * `site_permissions` alone, so enrolling editors consumed nothing — and once
 * the editor path was gated against that same partial count, each door would
 * have independently allowed the full allowance.
 */
describe("the seat count spans both tables", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("counts editors against the allowance, not only collaborators", async () => {
    // Five editors, no collaborators, five seats sold. Under the old count this
    // site read as empty and the sixth person walked in.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 5,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.currentLimit).toBe(5);
  });

  it("blocks one path with seats taken entirely through the other", async () => {
    // The cross-path guarantee: whichever door the seats came through, the
    // next request at either door is refused. Three collaborators plus two
    // editors is five, and five is all this plan sells.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 3,
      editorSeats: 2,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(false);
    expect(result.currentLimit).toBe(5);
    expect(result.maxLimit).toBe(5);
  });

  it("permits the last seat when it is split across both tables", async () => {
    // The other edge of the same sum. Two plus two is four, so the fifth seat
    // is still owed to the customer.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 2,
      editorSeats: 2,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(true);
    expect(result.currentLimit).toBe(4);
  });

  it("ignores revoked editors, who have given their seat back", async () => {
    // Enforced by the `revoked_at IS NULL` filter rather than here; this pins
    // that a site whose editors were all removed is genuinely empty again.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(true);
    expect(mockServiceClient.from).toHaveBeenCalledWith("site_editors");
  });

  it("reads editors with the service-role client, which RLS cannot zero", async () => {
    // A manager sharing a site cannot SELECT site_editors under its policy, so
    // a request-scoped read would return 0 and wave through a full site.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 5,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    const result = await canShareSite("site-1", "manager-9");

    expect(mockServiceClient.from).toHaveBeenCalledWith("site_editors");
    expect(result.allowed).toBe(false);
  });

  it("throws rather than reading an unreadable editor count as room to spare", async () => {
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
      editorCountError: "statement timeout",
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    await expect(canShareSite("site-1", "owner-1")).rejects.toThrow(
      /Failed to count editor seats/,
    );
  });

  it("throws rather than reading an unreadable collaborator count as room to spare", async () => {
    // This one used to be swallowed outright: the previous count destructured
    // only `count` and never looked at `error`.
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
      collaboratorCountError: "statement timeout",
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(5));

    await expect(canShareSite("site-1", "owner-1")).rejects.toThrow(
      /Failed to count collaborator seats/,
    );
  });

  it("does not query either table when the plan sells unlimited seats", async () => {
    stubSeatTables({
      ownerId: "owner-1",
      collaboratorSeats: 0,
      editorSeats: 0,
    });
    mockGetEffectivePlan.mockResolvedValue(planWithSeats(-1));

    const result = await canShareSite("site-1", "owner-1");

    expect(result.allowed).toBe(true);
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });
});
