import {
  AUTH_CASCADE_DATABASE_TABLES,
  CAPTURED_DATABASE_IDENTITIES,
  CAPTURED_DATABASE_TABLES,
  EXPLICITLY_DELETED_DATABASE_TABLES,
  capturedCleanupDeliveries,
  databaseTablesCountedAsResidue,
  provisionDisposableBillingUser,
} from "../../../e2e/support/stripe-provider-fixture";

describe("provisionDisposableBillingUser", () => {
  function dependencies(
    initialState: {
      customerIds: string[];
      subscriptionIds: string[];
      entitlementIds: string[];
    } = { customerIds: [], subscriptionIds: [], entitlementIds: [] },
  ) {
    return {
      createConfirmedUser: jest.fn().mockResolvedValue({ id: "user-1" }),
      readInitialBillingState: jest.fn().mockResolvedValue(initialState),
      signInWithPassword: jest.fn().mockResolvedValue({ userId: "user-1" }),
    };
  }

  it("creates a confirmed user, establishes the browser session, and proves a clean billing baseline", async () => {
    const deps = dependencies();

    const fixture = await provisionDisposableBillingUser(deps, {
      email: "s25-fixture@recopyfast.invalid",
      password: "temporary-password",
    });

    expect(deps.createConfirmedUser).toHaveBeenCalledWith({
      email: "s25-fixture@recopyfast.invalid",
      password: "temporary-password",
      emailConfirm: true,
    });
    expect(deps.signInWithPassword).toHaveBeenCalledWith({
      email: "s25-fixture@recopyfast.invalid",
      password: "temporary-password",
    });
    expect(deps.readInitialBillingState).toHaveBeenCalledWith("user-1");
    expect(fixture).toEqual({
      email: "s25-fixture@recopyfast.invalid",
      password: "temporary-password",
      userId: "user-1",
    });
  });

  it.each([
    ["billing customer", { customerIds: ["customer-row"] }],
    ["subscription", { subscriptionIds: ["subscription-row"] }],
    ["trial or paid grant", { entitlementIds: ["entitlement-row"] }],
  ])("refuses a pre-existing %s", async (_label, override) => {
    const deps = dependencies({
      customerIds: [],
      subscriptionIds: [],
      entitlementIds: [],
      ...override,
    });

    await expect(
      provisionDisposableBillingUser(deps, {
        email: "s25-fixture@recopyfast.invalid",
        password: "temporary-password",
      }),
    ).rejects.toThrow(/clean billing baseline/i);
  });

  it("surfaces browser sign-in failure for the external janitor to reconcile", async () => {
    const deps = dependencies();
    deps.signInWithPassword.mockRejectedValue(new Error("sign-in failed"));

    await expect(
      provisionDisposableBillingUser(deps, {
        email: "s25-fixture@recopyfast.invalid",
        password: "temporary-password",
      }),
    ).rejects.toThrow("sign-in failed");
  });
});

describe("captured database identities", () => {
  it("uses the reservation table's real user_id primary key", () => {
    expect(CAPTURED_DATABASE_IDENTITIES).toMatchObject({
      checkout_reservations: "user_id",
      checkout_pending_intents: "id",
    });
    expect(
      Object.entries(CAPTURED_DATABASE_IDENTITIES).filter(
        ([table]) =>
          table !== "checkout_reservations" &&
          table !== "checkout_pending_intents",
      ),
    ).toEqual(
      expect.arrayContaining([
        ["billing_customers", "id"],
        ["billing_events", "id"],
        ["billing_invoices", "id"],
        ["billing_payment_methods", "id"],
        ["billing_subscriptions", "id"],
        ["plan_entitlements", "id"],
      ]),
    );
  });

  it("leaves checkout-intent deletion to the owned Auth cascade", () => {
    expect(AUTH_CASCADE_DATABASE_TABLES).toEqual(["checkout_pending_intents"]);
    expect(CAPTURED_DATABASE_TABLES).toContain("checkout_pending_intents");
    expect(EXPLICITLY_DELETED_DATABASE_TABLES).not.toContain(
      "checkout_pending_intents",
    );
    expect(EXPLICITLY_DELETED_DATABASE_TABLES).toHaveLength(
      CAPTURED_DATABASE_TABLES.length - 1,
    );
    expect(databaseTablesCountedAsResidue(true)).toEqual(
      EXPLICITLY_DELETED_DATABASE_TABLES,
    );
    expect(databaseTablesCountedAsResidue(false)).toEqual(
      CAPTURED_DATABASE_TABLES,
    );
  });
});

describe("capturedCleanupDeliveries", () => {
  it("matches only processed terminal rows for captured provider IDs", () => {
    const rows = [
      {
        id: "db-event-late",
        stripe_event_id: "evt_late",
        event_type: "customer.deleted",
        processed: true,
        data: { object: { id: "cus_late" } },
      },
      {
        id: "db-event-unprocessed",
        stripe_event_id: "evt_unprocessed",
        event_type: "customer.deleted",
        processed: false,
        data: { object: { id: "cus_late" } },
      },
      {
        id: "db-event-other",
        stripe_event_id: "evt_other",
        event_type: "customer.deleted",
        processed: true,
        data: { object: { id: "cus_other" } },
      },
    ];

    expect(
      capturedCleanupDeliveries(
        { stripeCustomerId: "cus_late", stripeSubscriptionId: undefined },
        rows,
      ),
    ).toEqual([rows[0]]);
  });
});
