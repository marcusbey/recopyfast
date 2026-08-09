/**
 * A-6 — plan change, cancel and reactivate charge Stripe, then fail on an
 * RLS-blocked write.
 *
 * `src/lib/stripe/subscription.ts:86,186,246` opens the caller's RLS-scoped
 * client, and `20260804130000_restore_missing_rls_policies.sql:54-62` grants
 * `authenticated` SELECT only on `billing_subscriptions`. With no UPDATE policy
 * Postgres updates zero rows and returns no error, so `.select().single()`
 * answers PGRST116, the function throws, and the route 500s — after Stripe has
 * already been mutated and the card already charged.
 *
 * These tests deliberately do NOT reuse the mocks in
 * `src/__tests__/api/billing/subscription.test.ts:18-22`, which replace
 * `updateSubscription` / `cancelSubscription` / `reactivateSubscription` with
 * `jest.fn()`. Mocking the three functions under test out entirely is exactly
 * why the existing suite is green. Here the real functions run against a client
 * that behaves like the production policy set: SELECT sees the row, UPDATE
 * matches nothing.
 *
 * The service-role client CAN write, and the three writes now run on it — the
 * fix every other billing write already had. These cases were `test.failing`
 * markers while the defect stood; they are enforced now.
 */

interface SubscriptionRow {
  id: string;
  user_id: string;
  customer_id: string;
  stripe_subscription_id: string;
  plan: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
}

const SUBSCRIPTION_ROW_ID = "row-1";
const STRIPE_SUBSCRIPTION_ID = "sub_stripe_1";
const CURRENT_PRICE_ID = "price_pro_monthly";
const TARGET_PRICE_ID = "price_starter_monthly";

/** The single `billing_subscriptions` row every test starts from. */
function seedRow(): SubscriptionRow {
  return {
    id: SUBSCRIPTION_ROW_ID,
    user_id: "user-1",
    customer_id: "cus_row_1",
    stripe_subscription_id: STRIPE_SUBSCRIPTION_ID,
    plan: "pro",
    status: "active",
    current_period_start: "2026-08-01T00:00:00.000Z",
    current_period_end: "2026-09-01T00:00:00.000Z",
    cancel_at: null,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

/** Stored state, shared by both clients — one table, two policy sets. */
let stored: SubscriptionRow = seedRow();

/** Ordered log of the side effects, so "Stripe first" can be asserted. */
let effects: string[] = [];

/**
 * When true, no client may update — models "the database write failed" for a
 * reason other than RLS. Used to pin the no-rollback behaviour, which stays
 * true whichever client the write ends up on.
 */
let allWritesBlocked = false;

type SupabaseError = { code?: string; message: string; details?: string };

/**
 * A `billing_subscriptions` client under one policy set.
 *
 * `canWrite: false` is the production `authenticated` role: SELECT resolves,
 * UPDATE silently matches zero rows. That zero-row update is not an error in
 * PostgREST, so the failure only surfaces at `.select().single()` as PGRST116 —
 * long after Stripe has been told to charge.
 */
function createPolicyScopedClient(role: "authenticated" | "service_role") {
  const canWrite = role === "service_role" && !allWritesBlocked;

  const from = () => {
    let isWrite = false;
    let patch: Partial<SubscriptionRow> = {};

    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      update: (values: Partial<SubscriptionRow>) => {
        isWrite = true;
        patch = values;
        return builder;
      },
      single: async (): Promise<{
        data: SubscriptionRow | null;
        error: SupabaseError | null;
      }> => {
        if (!isWrite) {
          return { data: { ...stored }, error: null };
        }

        effects.push(`db.update:${role}`);

        if (!canWrite) {
          // Zero rows matched. PostgREST does not call this an error; the
          // single-row coercion is what finally complains.
          return {
            data: null,
            error: {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
              details: "The result contains 0 rows",
            },
          };
        }

        stored = { ...stored, ...patch };
        return { data: { ...stored }, error: null };
      },
    };

    return builder;
  };

  return { from };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createPolicyScopedClient("authenticated")),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() =>
    createPolicyScopedClient("service_role"),
  ),
}));

const mockStripeRetrieve = jest.fn();
const mockStripeUpdate = jest.fn();
const mockStripeCancel = jest.fn();

// Indirected through arrows: the factory body runs while `@/lib/stripe/config`
// is first imported, which is before the `const`s above are initialised.
jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    subscriptions: {
      retrieve: (...args: unknown[]) => mockStripeRetrieve(...args),
      update: (...args: unknown[]) => mockStripeUpdate(...args),
      cancel: (...args: unknown[]) => mockStripeCancel(...args),
    },
  },
}));

jest.mock("@/lib/stripe/plans", () => ({
  getPaidPlan: jest.fn(async (planId: string) => ({ id: planId })),
  resolveStripePriceId: jest.fn(async () => TARGET_PRICE_ID),
  findPlanById: jest.fn(async () => null),
  isPaidPlanId: (value: unknown) => value === "starter" || value === "pro",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
}));

import {
  cancelSubscription,
  reactivateSubscription,
  updateSubscription,
} from "@/lib/stripe/subscription";

describe("A-6: subscription writes run under the caller's RLS policy set", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = seedRow();
    effects = [];
    allWritesBlocked = false;

    mockStripeRetrieve.mockResolvedValue({
      id: STRIPE_SUBSCRIPTION_ID,
      metadata: { user_id: "user-1" },
      items: { data: [{ id: "si_1", price: { id: CURRENT_PRICE_ID } }] },
    });

    mockStripeUpdate.mockImplementation(async () => {
      effects.push("stripe.update");
      return {
        id: STRIPE_SUBSCRIPTION_ID,
        status: "active",
        cancel_at: null,
        canceled_at: null,
        latest_invoice: { status: "paid", hosted_invoice_url: null },
        items: {
          data: [
            {
              id: "si_1",
              price: { id: TARGET_PRICE_ID },
              current_period_start: 1785484800,
              current_period_end: 1788163200,
            },
          ],
        },
      };
    });

    mockStripeCancel.mockImplementation(async () => {
      effects.push("stripe.cancel");
      return {
        id: STRIPE_SUBSCRIPTION_ID,
        status: "canceled",
        cancel_at: null,
        canceled_at: 1785484800,
      };
    });
  });

  /**
   * Companion to the test below, kept from when that was a `test.failing`
   * marker: a marker passes on ANY failure, so each one needed a sibling
   * proving the harness reached the code under test. Getting as far as
   * `stripe.subscriptions.update` means the imports resolved, the plan lookup
   * answered, and the SELECT found the seeded row — everything except the
   * write. True on both sides of the fix.
   */
  it("guard: updateSubscription reaches Stripe with the resolved price", async () => {
    expect(stored.plan).toBe("pro");

    await updateSubscription("user-1", { planId: "starter" }).catch(
      () => undefined,
    );

    expect(mockStripeRetrieve).toHaveBeenCalledWith(STRIPE_SUBSCRIPTION_ID);
    expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
  });

  it("updateSubscription stores the plan the customer was charged for", async () => {
    await expect(
      updateSubscription("user-1", { planId: "starter" }),
    ).resolves.toMatchObject({ subscription: { plan_id: "starter" } });

    // The assertion that matters: the row, not the return value.
    expect(stored.plan).toBe("starter");
  });

  it("guard: cancelSubscription reaches Stripe with cancel_at_period_end", async () => {
    expect(stored.cancel_at).toBeNull();

    await cancelSubscription("user-1").catch(() => undefined);

    expect(mockStripeUpdate).toHaveBeenCalledWith(STRIPE_SUBSCRIPTION_ID, {
      cancel_at_period_end: true,
    });
  });

  it("cancelSubscription stores the cancellation Stripe accepted", async () => {
    mockStripeUpdate.mockImplementation(async () => {
      effects.push("stripe.update");
      return {
        id: STRIPE_SUBSCRIPTION_ID,
        status: "active",
        cancel_at: 1788163200,
        canceled_at: null,
      };
    });

    await expect(cancelSubscription("user-1")).resolves.toMatchObject({
      cancel_at_period_end: true,
    });

    expect(stored.cancel_at).toBe(new Date(1788163200 * 1000).toISOString());
  });

  it("guard: reactivateSubscription reaches Stripe once a cancellation is scheduled", async () => {
    // Without `cancel_at` the function throws before touching Stripe, so this
    // also proves the fixture the test below depends on is doing its job.
    stored = { ...seedRow(), cancel_at: "2026-09-01T00:00:00.000Z" };

    await reactivateSubscription("user-1").catch(() => undefined);

    expect(mockStripeUpdate).toHaveBeenCalledWith(STRIPE_SUBSCRIPTION_ID, {
      cancel_at_period_end: false,
    });
  });

  it("reactivateSubscription clears the scheduled cancellation it just undid at Stripe", async () => {
    stored = { ...seedRow(), cancel_at: "2026-09-01T00:00:00.000Z" };

    await expect(reactivateSubscription("user-1")).resolves.toMatchObject({
      cancel_at_period_end: false,
    });

    expect(stored.cancel_at).toBeNull();
  });

  /**
   * Fix-stable: whichever client the write lands on, Stripe is mutated first
   * and nothing compensates when the write fails. This is why the failure costs
   * money rather than merely showing an error — the proration has already been
   * invoiced with `always_invoice`.
   */
  it("charges Stripe before the database write, and does not undo the charge when that write fails", async () => {
    allWritesBlocked = true;

    await expect(
      updateSubscription("user-1", { planId: "starter" }),
    ).rejects.toThrow(/Failed to update subscription/);

    expect(mockStripeUpdate).toHaveBeenCalledWith(
      STRIPE_SUBSCRIPTION_ID,
      expect.objectContaining({
        proration_behavior: "always_invoice",
        items: [{ id: "si_1", price: TARGET_PRICE_ID }],
      }),
    );

    // Stripe first, database second, and no third call putting Stripe back.
    expect(effects[0]).toBe("stripe.update");
    expect(effects.slice(1).every((effect) => effect.startsWith("db."))).toBe(
      true,
    );
    expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
    expect(mockStripeCancel).not.toHaveBeenCalled();

    // The customer's stored plan is untouched: they paid the difference for a
    // plan the product still says they do not have.
    expect(stored.plan).toBe("pro");
  });

  it("refuses a plan change to the price the subscription is already on, before charging anything", async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: STRIPE_SUBSCRIPTION_ID,
      metadata: {},
      items: { data: [{ id: "si_1", price: { id: TARGET_PRICE_ID } }] },
    });

    await expect(
      updateSubscription("user-1", { planId: "starter" }),
    ).rejects.toThrow("You are already on this plan");

    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(stored.plan).toBe("pro");
  });
});
