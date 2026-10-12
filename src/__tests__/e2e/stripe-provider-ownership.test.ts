import {
  assertOwnedCheckoutSession,
  assertOwnedCustomer,
  assertOwnedSubscription,
  cancelOwnedSubscription,
  deleteOwnedCustomer,
  expireOwnedCheckoutSession,
} from "../../../e2e/support/stripe-provider-ownership";

const ownership = { authUserId: "user-run", startedAtUnix: 1_000 };

describe("provider-truth ownership guards", () => {
  it("accepts only a fresh test Customer with exact user metadata", () => {
    expect(() =>
      assertOwnedCustomer(
        {
          id: "cus_owned",
          livemode: false,
          created: 1_001,
          metadata: { user_id: "user-run" },
        },
        ownership,
      ),
    ).not.toThrow();
    expect(() =>
      assertOwnedCustomer(
        {
          id: "cus_foreign",
          livemode: false,
          created: 1_001,
          metadata: { user_id: "other-user" },
        },
        ownership,
      ),
    ).toThrow(/refusing provider mutation/i);
  });

  it("refuses live, old, or foreign Checkout Sessions", () => {
    for (const session of [
      {
        id: "cs_live",
        livemode: true,
        created: 1_001,
        client_reference_id: "user-run",
        metadata: { user_id: "user-run" },
        customer: "cus_owned",
      },
      {
        id: "cs_old",
        livemode: false,
        created: 999,
        client_reference_id: "user-run",
        metadata: { user_id: "user-run" },
        customer: "cus_owned",
      },
      {
        id: "cs_foreign",
        livemode: false,
        created: 1_001,
        client_reference_id: "other-user",
        metadata: { user_id: "other-user" },
        customer: "cus_foreign",
      },
    ]) {
      expect(() =>
        assertOwnedCheckoutSession(session, ownership, new Set(["cus_owned"])),
      ).toThrow(/refusing provider mutation/i);
    }
  });

  it("requires a fresh test Subscription whose metadata and Customer are both owned", () => {
    expect(() =>
      assertOwnedSubscription(
        {
          id: "sub_owned",
          livemode: false,
          created: 1_001,
          customer: "cus_owned",
          metadata: { user_id: "user-run" },
        },
        ownership,
        new Set(["cus_owned"]),
      ),
    ).not.toThrow();
    expect(() =>
      assertOwnedSubscription(
        {
          id: "sub_foreign",
          livemode: false,
          created: 1_001,
          customer: "cus_foreign",
          metadata: { user_id: "user-run" },
        },
        ownership,
        new Set(["cus_owned"]),
      ),
    ).toThrow(/refusing provider mutation/i);
  });

  it("never calls a provider mutation for foreign test objects", async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    const foreignCustomer = {
      id: "cus_foreign",
      livemode: false,
      created: 1_001,
      metadata: { user_id: "other-user" },
    };
    const foreignSession = {
      id: "cs_foreign",
      livemode: false,
      created: 1_001,
      client_reference_id: "other-user",
      metadata: { user_id: "other-user" },
      customer: "cus_foreign",
    };
    const foreignSubscription = {
      id: "sub_foreign",
      livemode: false,
      created: 1_001,
      customer: "cus_foreign",
      metadata: { user_id: "other-user" },
    };

    await expect(
      deleteOwnedCustomer(foreignCustomer, ownership, mutate),
    ).rejects.toThrow(/refusing provider mutation/i);
    await expect(
      expireOwnedCheckoutSession(
        foreignSession,
        ownership,
        new Set(["cus_owned"]),
        mutate,
      ),
    ).rejects.toThrow(/refusing provider mutation/i);
    await expect(
      cancelOwnedSubscription(
        foreignSubscription,
        ownership,
        new Set(["cus_owned"]),
        mutate,
      ),
    ).rejects.toThrow(/refusing provider mutation/i);
    expect(mutate).not.toHaveBeenCalled();
  });
});
