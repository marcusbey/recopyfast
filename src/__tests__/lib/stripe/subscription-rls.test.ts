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

/**
 * When true, the SELECT finds no row — the "no subscription" state (s82: its
 * refusal is a `BillingRefusal` a route may show).
 */
let rowMissing = false;

/**
 * When true, the SELECT itself fails — the database is down, not the row
 * missing (s82 review, finding 3: that is an `Error`, logged and answered 500,
 * never the customer-facing "No active subscription found").
 */
let readFails = false;

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

  const from = (table: string) => {
    // s82: `reactivateSubscription` and `updateSubscription` ask whether a
    // lifetime grant covers the plan before they touch Stripe. This account
    // holds none, so the read answers no rows and every case below behaves as
    // before; the grant cases live in reactivate-lifetime.test.ts.
    if (table === "plan_entitlements") {
      const grants: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      for (const method of ["select", "eq", "is", "neq", "or", "returns"]) {
        grants[method] = () => grants;
      }
      return grants;
    }

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
          if (readFails) {
            return {
              data: null,
              error: {
                code: "08006",
                message: "connection to server was lost",
              },
            };
          }
          if (rowMissing) {
            return {
              data: null,
              error: {
                code: "PGRST116",
                message:
                  "JSON object requested, multiple (or no) rows returned",
              },
            };
          }
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
import { BillingRefusal } from "@/lib/billing/billing-refusal";

/** The provider answers every test starts from (shared by both suites below). */
function armStripeDefaults() {
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
}

describe("A-6: subscription writes run under the caller's RLS policy set", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = seedRow();
    effects = [];
    allWritesBlocked = false;
    rowMissing = false;
    readFails = false;

    armStripeDefaults();
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

/**
 * s82 (s69 L5): the sentences these functions write for the customer are
 * `BillingRefusal`s — the routes answer them with their own words and status
 * and answer everything else generically. A refusal is decided before Stripe
 * is touched.
 */
describe("s82: deliberate refusals are BillingRefusals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored = seedRow();
    effects = [];
    allWritesBlocked = false;
    rowMissing = false;
    readFails = false;
    armStripeDefaults();
  });

  async function refusalOf(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(BillingRefusal);
    return error as BillingRefusal;
  }

  it("a change to the price already billed is a 409", async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: STRIPE_SUBSCRIPTION_ID,
      metadata: {},
      items: { data: [{ id: "si_1", price: { id: TARGET_PRICE_ID } }] },
    });

    const refusal = await refusalOf(
      updateSubscription("user-1", { planId: "starter" }),
    );

    expect(refusal.status).toBe(409);
    expect(refusal.message).toBe("You are already on this plan");
    expect(mockStripeUpdate).not.toHaveBeenCalled();
  });

  it("no subscription to change, cancel or reactivate is a 404", async () => {
    rowMissing = true;

    const change = await refusalOf(
      updateSubscription("user-1", { planId: "starter" }),
    );
    const cancel = await refusalOf(cancelSubscription("user-1"));
    const reactivate = await refusalOf(reactivateSubscription("user-1"));

    expect([change.status, cancel.status, reactivate.status]).toEqual([
      404, 404, 404,
    ]);
    expect(change.message).toBe("No active subscription found");
    expect(cancel.message).toBe("No active subscription found");
    expect(reactivate.message).toBe("No subscription found");
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockStripeCancel).not.toHaveBeenCalled();
  });

  it("reactivating a subscription not set to cancel is a 409", async () => {
    const refusal = await refusalOf(reactivateSubscription("user-1"));

    expect(refusal.status).toBe(409);
    expect(refusal.message).toBe(
      "Subscription is not scheduled for cancellation",
    );
    expect(mockStripeUpdate).not.toHaveBeenCalled();
  });

  it("a failed subscription read is not a refusal: it is an error, before Stripe", async () => {
    readFails = true;

    const outcomes = await Promise.all(
      [
        updateSubscription("user-1", { planId: "starter" }),
        cancelSubscription("user-1"),
        reactivateSubscription("user-1"),
      ].map((promise) =>
        promise.then(
          () => null,
          (reason: unknown) => reason,
        ),
      ),
    );

    for (const error of outcomes) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(BillingRefusal);
    }
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockStripeCancel).not.toHaveBeenCalled();
  });

  it("a failed database write is not a refusal: its text stays server-side", async () => {
    allWritesBlocked = true;

    const error = await updateSubscription("user-1", {
      planId: "starter",
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BillingRefusal);
  });
});

/**
 * s82, Devin Review on PR #81 (finding 2): a plan change applied to a
 * subscription scheduled to cancel kept the cancellation. An owner whose
 * subscription was set to end — by them, or by a lifetime purchase — switched
 * up to Agency, paid the prorated difference, and still lost Agency at period
 * end. Buying another plan means keeping it: the change clears the scheduled
 * cancellation in the same Stripe update, and the row stops saying it ends.
 */
describe("s82: a plan change keeps a subscription scheduled to cancel", () => {
  const PERIOD_END = 1788163200; // 2026-09-01T00:00:00Z

  beforeEach(() => {
    jest.clearAllMocks();
    stored = { ...seedRow(), cancel_at: "2026-09-01T00:00:00.000Z" };
    effects = [];
    allWritesBlocked = false;
    rowMissing = false;
    readFails = false;
    armStripeDefaults();
  });

  function scheduledInStripe(fields: Record<string, unknown>) {
    mockStripeRetrieve.mockResolvedValue({
      id: STRIPE_SUBSCRIPTION_ID,
      metadata: { user_id: "user-1" },
      items: { data: [{ id: "si_1", price: { id: CURRENT_PRICE_ID } }] },
      ...fields,
    });
  }

  it("clears a cancellation at period end in the same update that changes the price", async () => {
    scheduledInStripe({ cancel_at_period_end: true, cancel_at: PERIOD_END });

    await updateSubscription("user-1", { planId: "starter" });

    expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
    expect(mockStripeUpdate).toHaveBeenCalledWith(
      STRIPE_SUBSCRIPTION_ID,
      expect.objectContaining({
        items: [{ id: "si_1", price: TARGET_PRICE_ID }],
        cancel_at_period_end: false,
      }),
    );
    // Stripe answers with no cancellation; the row stops saying it ends.
    expect(stored.cancel_at).toBeNull();
  });

  it("clears a cancellation date set elsewhere (the Stripe dashboard)", async () => {
    scheduledInStripe({
      cancel_at_period_end: false,
      cancel_at: PERIOD_END + 86400,
    });

    await updateSubscription("user-1", { planId: "starter" });

    const [, params] = mockStripeUpdate.mock.calls[0];
    expect(params).toEqual(expect.objectContaining({ cancel_at: "" }));
    expect(params).not.toHaveProperty("cancel_at_period_end");
  });

  it("sends no cancellation field for a subscription that renews", async () => {
    scheduledInStripe({ cancel_at_period_end: false, cancel_at: null });

    await updateSubscription("user-1", { planId: "starter" });

    const [, params] = mockStripeUpdate.mock.calls[0];
    expect(params).not.toHaveProperty("cancel_at_period_end");
    expect(params).not.toHaveProperty("cancel_at");
  });
});

describe("s82 review m-5: a plan change never undoes a chargeback's cancellation", () => {
  const PERIOD_END = 1788163200; // 2026-09-01T00:00:00Z

  beforeEach(() => {
    jest.clearAllMocks();
    stored = { ...seedRow(), cancel_at: "2026-09-01T00:00:00.000Z" };
    effects = [];
    allWritesBlocked = false;
    rowMissing = false;
    readFails = false;
    armStripeDefaults();
  });

  function inStripe(fields: Record<string, unknown>) {
    mockStripeRetrieve.mockResolvedValue({
      id: STRIPE_SUBSCRIPTION_ID,
      items: { data: [{ id: "si_1", price: { id: CURRENT_PRICE_ID } }] },
      ...fields,
    });
  }

  it("refuses, in words, to switch a subscription set to end after a lost chargeback", async () => {
    inStripe({
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
      metadata: {
        user_id: "user-1",
        cancelled_reason: "chargeback",
        disputeId: "dp_1",
      },
    });

    const error = await updateSubscription("user-1", {
      planId: "starter",
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(BillingRefusal);
    expect((error as BillingRefusal).status).toBe(409);
    expect((error as BillingRefusal).message).toBe(
      "This subscription is ending after a disputed payment, so its plan can't be changed. Contact support if you'd like to keep it.",
    );
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(stored.cancel_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("drops the stale reason when it clears a lifetime purchase's cancellation", async () => {
    inStripe({
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
      metadata: {
        user_id: "user-1",
        cancelled_reason: "lifetime_purchase",
        paymentIntentId: "pi_lifetime",
      },
    });

    await updateSubscription("user-1", { planId: "starter" });

    const [, params] = mockStripeUpdate.mock.calls[0];
    expect(params).toEqual(
      expect.objectContaining({ cancel_at_period_end: false }),
    );
    // "" is how Stripe unsets a metadata key.
    expect(params.metadata).toEqual(
      expect.objectContaining({ cancelled_reason: "", plan_id: "starter" }),
    );
  });

  it("leaves the metadata's reasons alone on a subscription that renews", async () => {
    inStripe({
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { user_id: "user-1" },
    });

    await updateSubscription("user-1", { planId: "starter" });

    const [, params] = mockStripeUpdate.mock.calls[0];
    expect(params.metadata).not.toHaveProperty("cancelled_reason");
  });

  it("allows the change once support has undone the chargeback's cancellation", async () => {
    inStripe({
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { user_id: "user-1", cancelled_reason: "chargeback" },
    });

    await updateSubscription("user-1", { planId: "starter" });

    expect(mockStripeUpdate).toHaveBeenCalledTimes(1);
  });
});
