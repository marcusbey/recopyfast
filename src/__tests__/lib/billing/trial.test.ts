/**
 * Starting the 14-day Pro trial.
 *
 * Both server-side sign-in touchpoints (`/auth/callback`, `/auth/confirm`) run
 * on EVERY sign-in, not just the first — there is no signup route and no
 * "email confirmed" event to hang this on, because signup is passwordless
 * `signInWithOtp`. So idempotency is not a nicety here: it is the only reason a
 * subscriber signing in for the hundredth time does not attempt a hundredth
 * grant.
 *
 * "One trial per account, ever" (AC 6) is ultimately a partial unique index in
 * Postgres, not the check below — the check keeps the common case from writing,
 * the index is what two concurrent sign-ins cannot race past. Both paths are
 * pinned here.
 */

interface InsertCall {
  table: string;
  row: Record<string, unknown>;
}

const inserts: InsertCall[] = [];
let insertError: { code?: string; message: string } | null = null;

const mockServiceClient = {
  from: jest.fn((table: string) => ({
    insert: jest.fn((row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return Promise.resolve({ error: insertError });
    }),
  })),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockServiceClient),
}));

jest.mock("@/lib/billing/effective-plan", () => {
  const actual = jest.requireActual("@/lib/billing/effective-plan");
  return { ...actual, resolveEntitlement: jest.fn() };
});

// Mocked explicitly, defaulting to `sold_out` in beforeEach, so the cases
// below that predate the founding offer run the real "not claimed" path
// rather than an error path that happens to fall back the same way.
jest.mock("@/lib/billing/founding-offer", () => {
  const actual = jest.requireActual("@/lib/billing/founding-offer");
  return { ...actual, claimFoundingOfferSpot: jest.fn() };
});

import {
  TRIAL_DURATION_DAYS,
  ensureTrialStarted,
  grantTrialEntitlement,
} from "@/lib/billing/trial";
import { resolveEntitlement } from "@/lib/billing/effective-plan";
import type { Entitlement } from "@/lib/billing/effective-plan";
import { claimFoundingOfferSpot } from "@/lib/billing/founding-offer";

const asMock = (fn: unknown) => fn as jest.Mock;

const USER = "user-1";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whatever client `ensureTrialStarted` is handed — it only forwards it. */
const supabase = {} as never;

const UNENTITLED: Entitlement = { kind: "none", planId: null, plan: null };

const ON_A_PLAN = {
  kind: "plan",
  planId: "pro",
  plan: { id: "pro" },
} as unknown as Entitlement;

const HOLDS_CREDITS: Entitlement = {
  kind: "credits",
  planId: null,
  plan: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  inserts.length = 0;
  insertError = null;
  asMock(resolveEntitlement).mockResolvedValue(UNENTITLED);
  asMock(claimFoundingOfferSpot).mockResolvedValue({ outcome: "sold_out" });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("grantTrialEntitlement", () => {
  it("writes a Pro grant that runs out in fourteen days", async () => {
    const before = Date.now();

    await expect(grantTrialEntitlement(USER)).resolves.toEqual({
      granted: true,
      duplicate: false,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("plan_entitlements");
    expect(inserts[0].row).toMatchObject({
      user_id: USER,
      plan_id: "pro",
      source: "trial",
    });

    const expiresAt = new Date(inserts[0].row.expires_at as string).getTime();
    const expected = before + TRIAL_DURATION_DAYS * DAY_MS;
    // Tolerant of test runtime; the point is the window, not the millisecond.
    expect(expiresAt).toBeGreaterThanOrEqual(expected - 1000);
    expect(expiresAt).toBeLessThanOrEqual(
      Date.now() + TRIAL_DURATION_DAYS * DAY_MS,
    );
  });

  it("never synthesises a Stripe payment intent for a free trial", async () => {
    // The old credit refund (removed in s48) fabricated one for
    // credit_purchases, and copying that here would put a fake payment id on a
    // row the finance side reads as a purchase.
    // The uniqueness AC 6 needs comes from the partial index on `source`, not
    // from this column.
    await grantTrialEntitlement(USER);

    expect(inserts[0].row.stripe_payment_intent_id).toBeNull();
  });

  it("reports a unique violation as a duplicate rather than throwing", async () => {
    // The index firing IS the guarantee working: two sign-ins racing, or a
    // second trial attempted years later. Neither is an error.
    insertError = { code: "23505", message: "duplicate key value" };

    await expect(grantTrialEntitlement(USER)).resolves.toEqual({
      granted: false,
      duplicate: true,
    });
  });

  it("throws on a write failure that is not the uniqueness guard", async () => {
    insertError = { code: "42501", message: "permission denied" };

    await expect(grantTrialEntitlement(USER)).rejects.toThrow(
      /Failed to start a trial/,
    );
  });
});

describe("ensureTrialStarted", () => {
  it("starts a trial for a brand-new account with nothing at all", async () => {
    await ensureTrialStarted(supabase, USER);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({ plan_id: "pro", source: "trial" });
  });

  it("writes nothing on the next sign-in, because the trial now entitles them", async () => {
    // Both auth routes fire on every sign-in. The second call must be a no-op
    // and must not depend on the database rejecting it.
    asMock(resolveEntitlement).mockResolvedValue(ON_A_PLAN);

    await ensureTrialStarted(supabase, USER);

    expect(inserts).toHaveLength(0);
  });

  it("never hands a trial to a subscriber or a lifetime holder", async () => {
    asMock(resolveEntitlement).mockResolvedValue(ON_A_PLAN);

    await ensureTrialStarted(supabase, USER);

    expect(inserts).toHaveLength(0);
  });

  it("never hands a trial to someone already entitled by credits", async () => {
    asMock(resolveEntitlement).mockResolvedValue(HOLDS_CREDITS);

    await ensureTrialStarted(supabase, USER);

    expect(inserts).toHaveLength(0);
  });

  it("swallows a lost race past the entitlement check", async () => {
    // Two sign-ins in flight at once: both read "unentitled", both insert, the
    // index refuses the second. Sign-in must not fail because of it.
    insertError = { code: "23505", message: "duplicate key value" };

    await expect(ensureTrialStarted(supabase, USER)).resolves.toBeUndefined();
  });

  it("lets sign-in proceed when the grant cannot be written at all", async () => {
    // A trial is worth 14 days of Pro. Being unable to hand one out is worth a
    // log line, never a locked-out customer.
    insertError = { code: "42501", message: "permission denied" };

    await expect(ensureTrialStarted(supabase, USER)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("lets sign-in proceed when entitlement cannot be resolved", async () => {
    asMock(resolveEntitlement).mockRejectedValue(new Error("supabase down"));

    await expect(ensureTrialStarted(supabase, USER)).resolves.toBeUndefined();
    expect(inserts).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("ensureTrialStarted with the founding offer (s47a)", () => {
  it("writes no 14-day trial when the account claimed an offer spot", async () => {
    // The claim function wrote the 90-day trial row itself, in the same
    // transaction as the claim.
    asMock(claimFoundingOfferSpot).mockResolvedValue({
      outcome: "claimed",
      entitlementId: "grant-1",
      expiresAt: "2026-12-27T10:00:00.000Z",
    });

    await ensureTrialStarted(supabase, USER);

    expect(claimFoundingOfferSpot).toHaveBeenCalledWith(USER);
    expect(inserts).toHaveLength(0);
  });

  it.each(["sold_out", "ineligible"])(
    "writes today's 14-day trial when the claim is %s",
    async (outcome) => {
      asMock(claimFoundingOfferSpot).mockResolvedValue({ outcome });

      await ensureTrialStarted(supabase, USER);

      expect(inserts).toHaveLength(1);
      expect(inserts[0].row).toMatchObject({
        plan_id: "pro",
        source: "trial",
        stripe_payment_intent_id: null,
      });
      expect(inserts[0].row).not.toHaveProperty("offer_id");
    },
  );

  it.each([
    [
      "rejects",
      () =>
        asMock(claimFoundingOfferSpot).mockRejectedValue(
          new Error("Failed to claim the founding offer: timeout"),
        ),
    ],
    [
      "throws",
      () =>
        asMock(claimFoundingOfferSpot).mockImplementation(() => {
          throw new Error("unexpected");
        }),
    ],
  ])(
    "falls back to the 14-day trial when the claim %s",
    async (_label, arrange) => {
      arrange();

      await expect(ensureTrialStarted(supabase, USER)).resolves.toBeUndefined();

      expect(inserts).toHaveLength(1);
      expect(inserts[0].row).toMatchObject({ plan_id: "pro", source: "trial" });
      expect(console.error).toHaveBeenCalled();
    },
  );

  it("lets sign-in proceed, and logs, when the claim and the fallback both fail", async () => {
    asMock(claimFoundingOfferSpot).mockRejectedValue(new Error("rpc down"));
    insertError = { code: "42501", message: "permission denied" };

    await expect(ensureTrialStarted(supabase, USER)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a plan", ON_A_PLAN],
    ["credits", HOLDS_CREDITS],
  ])(
    "an account entitled by %s neither claims nor writes",
    async (_label, entitlement) => {
      asMock(resolveEntitlement).mockResolvedValue(entitlement);

      await ensureTrialStarted(supabase, USER);

      expect(claimFoundingOfferSpot).not.toHaveBeenCalled();
      expect(inserts).toHaveLength(0);
    },
  );
});
