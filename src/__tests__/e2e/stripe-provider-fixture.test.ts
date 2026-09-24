import {
  CAPTURED_DATABASE_IDENTITIES,
  captureOwnedCheckoutSessions,
  capturedCleanupDeliveries,
  cleanupCapturedFixture,
  hasAllCapturedCleanupDeliveries,
  provisionDisposableBillingUser,
  reconcileCapturedCheckoutForCleanup,
  type CapturedFixtureIds,
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
      deleteAuthUser: jest.fn().mockResolvedValue(undefined),
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
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it.each([
    ["billing customer", { customerIds: ["customer-row"] }],
    ["subscription", { subscriptionIds: ["subscription-row"] }],
    ["trial or paid grant", { entitlementIds: ["entitlement-row"] }],
  ])(
    "refuses a pre-existing %s and removes the captured Auth user",
    async (_label, override) => {
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

      expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-1");
    },
  );

  it("removes the captured Auth user when browser sign-in fails", async () => {
    const deps = dependencies();
    deps.signInWithPassword.mockRejectedValue(new Error("sign-in failed"));

    await expect(
      provisionDisposableBillingUser(deps, {
        email: "s25-fixture@recopyfast.invalid",
        password: "temporary-password",
      }),
    ).rejects.toThrow("sign-in failed");

    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });

  it("exposes provisional Auth cleanup before post-create sign-in awaits", async () => {
    const onAuthUserCreated = jest.fn();
    const deps = dependencies();
    deps.signInWithPassword.mockImplementation(async () => {
      expect(onAuthUserCreated).toHaveBeenCalledTimes(1);
      return { userId: "user-1" };
    });

    await provisionDisposableBillingUser(
      deps,
      {
        email: "s25-fixture@recopyfast.invalid",
        password: "temporary-password",
      },
      { onAuthUserCreated },
    );

    const ownership = onAuthUserCreated.mock.calls[0][0] as {
      userId: string;
      cleanup: () => Promise<void>;
    };
    expect(ownership.userId).toBe("user-1");
    await ownership.cleanup();
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });
});

describe("captured database identities", () => {
  it("uses the reservation table's real user_id primary key", () => {
    expect(CAPTURED_DATABASE_IDENTITIES).toMatchObject({
      checkout_reservations: "user_id",
    });
    expect(
      Object.entries(CAPTURED_DATABASE_IDENTITIES).filter(
        ([table]) => table !== "checkout_reservations",
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
});

describe("cleanupCapturedFixture", () => {
  const captured: CapturedFixtureIds = {
    authUserId: "user-1",
    checkoutSessionId: "cs_test_1",
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: "sub_test_1",
    databaseRows: {
      billing_customers: ["bc-1"],
      billing_events: ["be-1", "be-2"],
      billing_invoices: ["bi-1"],
      billing_payment_methods: [],
      billing_subscriptions: ["bs-1"],
      checkout_reservations: ["cr-1"],
      plan_entitlements: [],
    },
  };

  function dependencies() {
    return {
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      deleteAuthUser: jest.fn().mockResolvedValue(undefined),
      deleteCustomer: jest.fn().mockResolvedValue(undefined),
      deleteDatabaseRows: jest.fn().mockResolvedValue(undefined),
    };
  }

  it("cancels/deletes provider objects, then deletes only captured row IDs and the captured user", async () => {
    const deps = dependencies();

    await cleanupCapturedFixture(captured, deps);

    expect(deps.cancelSubscription).toHaveBeenCalledWith("sub_test_1");
    expect(deps.deleteCustomer).toHaveBeenCalledWith("cus_test_1");
    expect(deps.deleteDatabaseRows.mock.calls).toEqual([
      ["billing_invoices", ["bi-1"]],
      ["billing_payment_methods", []],
      ["billing_subscriptions", ["bs-1"]],
      ["billing_events", ["be-1", "be-2"]],
      ["plan_entitlements", []],
      ["checkout_reservations", ["cr-1"]],
      ["billing_customers", ["bc-1"]],
    ]);
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-1");
    expect(deps.deleteDatabaseRows).not.toHaveBeenCalledWith(
      expect.anything(),
      ["user-1"],
    );
  });

  it("attempts every exact cleanup step before surfacing failures", async () => {
    const deps = dependencies();
    deps.cancelSubscription.mockRejectedValue(new Error("cancel failed"));
    deps.deleteDatabaseRows.mockRejectedValueOnce(new Error("row failed"));

    await expect(cleanupCapturedFixture(captured, deps)).rejects.toThrow(
      /cleanup failed in 2 steps: cancel_subscription, delete_billing_invoices/i,
    );

    expect(deps.deleteCustomer).toHaveBeenCalledWith("cus_test_1");
    expect(deps.deleteDatabaseRows).toHaveBeenCalledTimes(7);
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });

  it("preserves local delivery evidence and Auth ownership for the external janitor", async () => {
    const deps = {
      ...dependencies(),
      waitForProviderDeliveries: jest.fn().mockResolvedValue(undefined),
    };

    await cleanupCapturedFixture(captured, deps, {
      deferLocalCleanupToJanitor: true,
    });

    expect(deps.cancelSubscription).toHaveBeenCalledWith("sub_test_1");
    expect(deps.deleteCustomer).toHaveBeenCalledWith("cus_test_1");
    expect(deps.waitForProviderDeliveries).toHaveBeenCalledTimes(1);
    expect(deps.deleteDatabaseRows).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("reports only fixed cleanup labels and never raw provider errors or IDs", async () => {
    const deps = dependencies();
    deps.cancelSubscription.mockRejectedValue(
      new Error("subscription sub_sensitive failed"),
    );
    deps.deleteCustomer.mockRejectedValue(
      new Error("customer cus_sensitive failed"),
    );

    let error: Error | undefined;
    try {
      await cleanupCapturedFixture(captured, deps);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/cancel_subscription, delete_customer/i);
    expect(error?.message).not.toContain("sub_sensitive");
    expect(error?.message).not.toContain("cus_sensitive");
  });

  it("does not wait for provider deliveries when no provider object was created", async () => {
    const deps = {
      ...dependencies(),
      waitForProviderDeliveries: jest.fn().mockResolvedValue(undefined),
    };

    await cleanupCapturedFixture(
      {
        ...captured,
        stripeCustomerId: undefined,
        stripeSubscriptionId: undefined,
      },
      deps,
    );

    expect(deps.waitForProviderDeliveries).not.toHaveBeenCalled();
  });

  it("still reconciles Checkout and runs exact cleanup when initial database discovery fails", async () => {
    const lateCaptured: CapturedFixtureIds = {
      authUserId: "user-late",
      checkoutSessionId: "cs_test_late",
      databaseRows: {
        billing_customers: [],
        billing_events: [],
        billing_invoices: [],
        billing_payment_methods: [],
        billing_subscriptions: [],
        checkout_reservations: [],
        plan_entitlements: [],
      },
    };
    const deps = {
      ...dependencies(),
      reconcileCheckout: jest.fn().mockImplementation(async () => {
        lateCaptured.stripeCustomerId = "cus_late_after_submit";
      }),
      captureBeforeProviderCleanup: jest
        .fn()
        .mockRejectedValue(new Error("database discovery failed")),
    };

    await expect(cleanupCapturedFixture(lateCaptured, deps)).rejects.toThrow(
      /cleanup failed in 1 steps/i,
    );

    expect(deps.reconcileCheckout).toHaveBeenCalledTimes(1);
    expect(deps.deleteCustomer).toHaveBeenCalledWith("cus_late_after_submit");
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-late");
  });
});

describe("reconcileCapturedCheckoutForCleanup", () => {
  function captured(): CapturedFixtureIds {
    return {
      authUserId: "user-1",
      checkoutSessionId: "cs_test_open",
      databaseRows: {
        billing_customers: [],
        billing_events: [],
        billing_invoices: [],
        billing_payment_methods: [],
        billing_subscriptions: [],
        checkout_reservations: [],
        plan_entitlements: [],
      },
    };
  }

  it("captures a customer created during a failed submit and expires the still-open Checkout Session", async () => {
    const ids = captured();
    const dependencies = {
      retrieveCheckoutSession: jest.fn().mockResolvedValue({
        status: "open",
        customer: "cus_late",
        subscription: null,
      }),
      expireCheckoutSession: jest.fn().mockResolvedValue({
        status: "expired",
        customer: "cus_late",
        subscription: null,
      }),
    };

    await reconcileCapturedCheckoutForCleanup(ids, dependencies);

    expect(dependencies.retrieveCheckoutSession).toHaveBeenCalledWith(
      "cs_test_open",
    );
    expect(dependencies.expireCheckoutSession).toHaveBeenCalledWith(
      "cs_test_open",
    );
    expect(ids.stripeCustomerId).toBe("cus_late");
  });

  it("captures a customer that appears only on the expired Session response", async () => {
    const ids = captured();
    const dependencies = {
      retrieveCheckoutSession: jest.fn().mockResolvedValue({
        status: "open",
        customer: null,
        subscription: null,
      }),
      expireCheckoutSession: jest.fn().mockResolvedValue({
        status: "expired",
        customer: { id: "cus_after_expire" },
        subscription: null,
      }),
    };

    await reconcileCapturedCheckoutForCleanup(ids, dependencies);

    expect(ids.stripeCustomerId).toBe("cus_after_expire");
  });

  it("captures a late subscription from a completed Session without expiring it", async () => {
    const ids = captured();
    const dependencies = {
      retrieveCheckoutSession: jest.fn().mockResolvedValue({
        status: "complete",
        customer: { id: "cus_complete" },
        subscription: { id: "sub_complete" },
      }),
      expireCheckoutSession: jest.fn(),
    };

    await reconcileCapturedCheckoutForCleanup(ids, dependencies);

    expect(dependencies.expireCheckoutSession).not.toHaveBeenCalled();
    expect(ids).toMatchObject({
      stripeCustomerId: "cus_complete",
      stripeSubscriptionId: "sub_complete",
    });
  });
});

describe("capturedCleanupDeliveries", () => {
  it("matches an unattributed customer.deleted row by the late Customer ID and excludes unrelated events", () => {
    const rows = [
      {
        id: "db-event-late",
        stripe_event_id: "evt_late",
        event_type: "customer.deleted",
        processed: true,
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

  it("requires a processed terminal event for every captured provider ID", () => {
    const captured = {
      stripeCustomerId: "cus_1",
      stripeCustomerIds: ["cus_1", "cus_2"],
      stripeSubscriptionId: "sub_1",
      stripeSubscriptionIds: ["sub_1", "sub_2"],
    };
    const partial = [
      {
        id: "db-cus-1",
        stripe_event_id: "evt_cus_1",
        event_type: "customer.deleted",
        processed: true,
        data: { object: { id: "cus_1" } },
      },
      {
        id: "db-sub-1",
        stripe_event_id: "evt_sub_1",
        event_type: "customer.subscription.deleted",
        processed: true,
        data: { object: { id: "sub_1" } },
      },
    ];

    expect(hasAllCapturedCleanupDeliveries(captured, partial)).toBe(false);
    expect(
      hasAllCapturedCleanupDeliveries(captured, [
        ...partial,
        {
          id: "db-cus-2",
          stripe_event_id: "evt_cus_2",
          event_type: "customer.deleted",
          processed: true,
          data: { object: { id: "cus_2" } },
        },
        {
          id: "db-sub-2",
          stripe_event_id: "evt_sub_2",
          event_type: "customer.subscription.deleted",
          processed: true,
          data: { object: { id: "sub_2" } },
        },
      ]),
    ).toBe(true);
  });
});

describe("captureOwnedCheckoutSessions", () => {
  it("records only Sessions created for the disposable user during this run", () => {
    const ids: CapturedFixtureIds = {
      authUserId: "user-run",
      databaseRows: {
        billing_customers: [],
        billing_events: [],
        billing_invoices: [],
        billing_payment_methods: [],
        billing_subscriptions: [],
        checkout_reservations: [],
        plan_entitlements: [],
      },
    };

    const captured = captureOwnedCheckoutSessions(ids, {
      userId: "user-run",
      startedAtUnix: 1_000,
      sessions: [
        {
          id: "cs_old",
          created: 999,
          client_reference_id: "user-run",
          metadata: { user_id: "user-run" },
        },
        {
          id: "cs_other",
          created: 1_001,
          client_reference_id: "other-user",
          metadata: { user_id: "other-user" },
        },
        {
          id: "cs_owned",
          created: 1_002,
          client_reference_id: null,
          metadata: { user_id: "user-run" },
        },
      ],
    });

    expect(captured.map((session) => session.id)).toEqual(["cs_owned"]);
    expect(ids.checkoutSessionId).toBe("cs_owned");
    expect(ids.checkoutSessionIds).toEqual(["cs_owned"]);
  });
});
