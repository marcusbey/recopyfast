/**
 * A-21 — two concurrent checkouts create two subscriptions.
 *
 * `src/app/api/billing/checkout/route.ts:106-117` guards the subscription
 * intent with `getUserSubscription`, which reads `billing_subscriptions` — a
 * table written only by the Stripe webhook, *after* the first payment
 * completes. Two clicks (or a double-submit, or a retried request) both find
 * nothing and both get a Checkout Session, and both land as separate rows and
 * separate monthly charges.
 *
 * The lifetime intent beside it (`:129-149`) does have a real server-side
 * precondition; the subscription intent has no concurrency-safe equivalent.
 * That contrast is pinned by the fix-stable cases at the bottom.
 *
 * `getUserSubscription` is stubbed to read the same in-memory table the webhook
 * would write, and is held at a barrier so both callers genuinely observe the
 * empty state. The defect under test is the check-then-act in the route, not
 * anything inside that read.
 */

type Row = Record<string, unknown>;
type RowsResult = { data: Row[] | null; error: null };

let db: Record<string, Row[]> = {};
let pendingIntent: Row | null = null;
let failNextAttach = false;
let failSubscriptionRead = false;
let failClaim = false;
let blockClaimForSubscription = false;

const mockGetUser = jest.fn();

/**
 * Cookie-scoped client. `from()` is a working in-memory store rather than a
 * stub so a fix that reserves the intent in the database has something to run
 * against.
 */
function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" = "select";
    let values: Row = {};

    const rows = (): Row[] => db[table] ?? [];

    const run = (): RowsResult => {
      if (operation === "insert") {
        db[table] = [...rows(), { ...values }];
        return { data: [{ ...values }], error: null };
      }
      return {
        data: rows().filter((row) =>
          predicates.every((predicate) => predicate(row)),
        ),
        error: null,
      };
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, allowed: unknown[]) => {
        predicates.push((row) => allowed.includes(row[column]));
        return builder;
      },
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (payload: Row) => {
        operation = "insert";
        values = payload;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "billing_subscriptions" && failSubscriptionRead) {
          return { data: null, error: { message: "read failed" } };
        }
        const { data } = run();
        return { data: data?.[0] ?? null, error: null };
      },
      then: <T>(
        resolve: (result: RowsResult) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };

    return builder;
  };

  return { auth: { getUser: mockGetUser }, from };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

const mockIntentClient = {
  rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_subscription_checkout_intent") {
      if (failClaim) {
        return { data: null, error: { message: "claim failed" } };
      }
      if (blockClaimForSubscription) {
        return {
          data: null,
          error: {
            code: "P0001",
            message: "user already has a non-terminal subscription",
          },
        };
      }
      if (!pendingIntent) {
        pendingIntent = {
          id: "intent_1",
          user_id: USER_ID,
          stripe_session_id: null,
          checkout_url: null,
          expires_at: args.p_expires_at,
        };
        return { data: [{ ...pendingIntent, is_new: true }], error: null };
      }
      return { data: [{ ...pendingIntent, is_new: false }], error: null };
    }
    if (name === "attach_subscription_checkout_session") {
      if (failNextAttach) {
        failNextAttach = false;
        return { data: null, error: { message: "write lost" } };
      }
      pendingIntent = pendingIntent
        ? {
            ...pendingIntent,
            stripe_session_id: args.p_stripe_session_id,
            checkout_url: args.p_checkout_url,
          }
        : null;
      return { data: null, error: null };
    }
    if (
      name === "finish_subscription_checkout_intent" ||
      name === "expire_unattached_subscription_checkout_intent"
    ) {
      pendingIntent = null;
      return { data: null, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  }),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockIntentClient),
}));

const mockCreateCheckoutSession = jest.fn();
const mockFindCheckoutSessionForIntent = jest.fn();
const mockGetCheckoutSessionStatus = jest.fn();

jest.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
  findCheckoutSessionForIntent: (...args: unknown[]) =>
    mockFindCheckoutSessionForIntent(...args),
  getCheckoutSessionStatus: (...args: unknown[]) =>
    mockGetCheckoutSessionStatus(...args),
}));

const mockGetUserSubscription = jest.fn();

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: (...args: unknown[]) => mockGetUserSubscription(...args),
}));

const mockGetGrantedPlanIds = jest.fn();

jest.mock("@/lib/billing/entitlements", () => ({
  getGrantedPlanIds: (...args: unknown[]) => mockGetGrantedPlanIds(...args),
}));

jest.mock("@/lib/stripe/plans", () => ({
  isPaidPlanId: (value: unknown) => value === "starter" || value === "pro",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
  getCreditPackConfig: jest.fn(async () => ({ maxPacksPerPurchase: 10 })),
  getLifetimeGrantPlanId: jest.fn(async () => "pro"),
}));

import { POST } from "@/app/api/billing/checkout/route";

interface CheckoutResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const USER_ID = "user-1";

function checkoutRequest(body: Record<string, unknown>) {
  return { json: async () => body } as never;
}

async function post(body: Record<string, unknown>): Promise<CheckoutResponse> {
  return POST(checkoutRequest(body)) as unknown as CheckoutResponse;
}

/** Releases both callers only once both have reached the same point. */
function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    await gate;
  };
}

describe("A-21: two checkouts started at once", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db = { billing_subscriptions: [] };
    pendingIntent = null;
    failNextAttach = false;
    failSubscriptionRead = false;
    failClaim = false;
    blockClaimForSubscription = false;

    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "buyer@example.com" } },
      error: null,
    });
    mockGetGrantedPlanIds.mockResolvedValue([]);
    mockFindCheckoutSessionForIntent.mockResolvedValue(null);
    mockCreateCheckoutSession.mockImplementation(async () => ({
      sessionId: `cs_${mockCreateCheckoutSession.mock.calls.length}`,
      url: "https://checkout.stripe.com/c/pay/cs_test",
    }));
    // Reads the table the Stripe webhook writes — empty until a payment
    // completes, which is the whole point.
    mockGetUserSubscription.mockImplementation(
      async () => db.billing_subscriptions?.[0] ?? null,
    );
  });

  /**
   * Guard for the `test.failing` below. `test.failing` passes on ANY failure,
   * including a barrier that deadlocks into a timeout or an auth mock that
   * 401s, so each marker needs a sibling proving the route ran. Here: the
   * barrier releases, both requests are authenticated and parsed, and both
   * reach the guard that reads `billing_subscriptions`.
   */
  it("guard: the barrier releases and both concurrent requests reach the guard", async () => {
    const bothReadFirst = createBarrier(2);
    const readsBillingSubscriptions =
      mockGetUserSubscription.getMockImplementation();
    mockGetUserSubscription.mockImplementation(async (...args) => {
      await bothReadFirst();
      return readsBillingSubscriptions?.(...args) ?? null;
    });

    const responses = await Promise.all([
      post({ intent: "subscription", planId: "pro" }),
      post({ intent: "subscription", planId: "pro" }),
    ]);

    expect(mockGetUserSubscription).toHaveBeenCalledTimes(2);
    expect(responses.every((response) => response.status !== 401)).toBe(true);
    expect(responses.every((response) => response.status !== 400)).toBe(true);
  });

  it("only one Checkout Session is created when two requests arrive together", async () => {
    const bothReadFirst = createBarrier(2);
    const readsBillingSubscriptions =
      mockGetUserSubscription.getMockImplementation();
    mockGetUserSubscription.mockImplementation(async (...args) => {
      await bothReadFirst();
      return readsBillingSubscriptions?.(...args) ?? null;
    });

    const responses = await Promise.all([
      post({ intent: "subscription", planId: "pro" }),
      post({ intent: "subscription", planId: "pro" }),
    ]);

    const statuses = responses.map((response) => response.status).sort();

    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([200, 409]);
  });

  it("guard: the first checkout succeeds and returns a session URL", async () => {
    const first = await post({ intent: "subscription", planId: "pro" });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      url: expect.stringContaining("checkout.stripe.com"),
    });
    // Nothing reached `billing_subscriptions` — which is exactly why the
    // second request below has nothing to trip over.
    expect(db.billing_subscriptions).toHaveLength(0);
  });

  it("a second subscription checkout is refused while the first is still unconfirmed", async () => {
    // Sequential, not concurrent: the first Checkout Session exists and the
    // customer is on Stripe's payment page. Nothing has reached
    // `billing_subscriptions` yet, and nothing stops them opening a second.
    const first = await post({ intent: "subscription", planId: "pro" });
    const second = await post({ intent: "subscription", planId: "pro" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      url: expect.stringContaining("checkout.stripe.com"),
    });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("recovers the same provider session when the attach write failed", async () => {
    failNextAttach = true;
    const first = await post({ intent: "subscription", planId: "pro" });
    expect(first.status).toBe(500);

    mockFindCheckoutSessionForIntent.mockResolvedValue({
      sessionId: "cs_recovered",
      url: "https://checkout.stripe.com/c/pay/cs_recovered",
      status: "open",
    });
    const retry = await post({ intent: "subscription", planId: "pro" });

    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ sessionId: "cs_recovered" });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous provider failure pending and recovers its session", async () => {
    mockCreateCheckoutSession.mockRejectedValueOnce(
      new Error("socket timeout"),
    );

    const first = await post({ intent: "subscription", planId: "pro" });
    expect(first.status).toBe(500);
    expect(pendingIntent).toMatchObject({
      id: "intent_1",
      stripe_session_id: null,
    });

    mockFindCheckoutSessionForIntent.mockResolvedValue({
      sessionId: "cs_after_timeout",
      url: "https://checkout.stripe.com/c/pay/cs_after_timeout",
      status: "open",
    });
    const retry = await post({ intent: "subscription", planId: "pro" });

    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ sessionId: "cs_after_timeout" });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("releases a provider-confirmed expired session before creating its successor", async () => {
    pendingIntent = {
      id: "intent_old",
      user_id: USER_ID,
      stripe_session_id: "cs_old",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_old",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    mockGetCheckoutSessionStatus.mockResolvedValue({ status: "expired" });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mockIntentClient.rpc).toHaveBeenCalledWith(
      "finish_subscription_checkout_intent",
      expect.objectContaining({
        p_intent_id: "intent_old",
        p_stripe_session_id: "cs_old",
      }),
    );
  });

  it("expires an unattached intent only after provider lookup finds no session", async () => {
    pendingIntent = {
      id: "intent_abandoned",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(200);
    expect(mockFindCheckoutSessionForIntent).toHaveBeenCalledWith(
      USER_ID,
      "buyer@example.com",
      "intent_abandoned",
      undefined,
    );
    expect(mockIntentClient.rpc).toHaveBeenCalledWith(
      "expire_unattached_subscription_checkout_intent",
      expect.objectContaining({ p_intent_id: "intent_abandoned" }),
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the subscription recheck cannot be read", async () => {
    failSubscriptionRead = true;

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(500);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic intent claim fails", async () => {
    failClaim = true;

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(500);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 409 when the atomic claim observes a subscription persisted in the race", async () => {
    blockClaimForSubscription = true;

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("already have a subscription"),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  /**
   * Fix-stable: once the webhook has written the row, the guard works. This is
   * the state the current check assumes always holds.
   */
  it("refuses a second checkout once the webhook has recorded the subscription", async () => {
    db.billing_subscriptions = [
      { id: "row_1", user_id: USER_ID, plan: "pro", status: "active" },
    ];

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("already have a subscription"),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  /**
   * Fix-stable, and the contrast the finding draws: the more expensive product
   * already has a server-side precondition beside the same missing one.
   */
  it("refuses a lifetime purchase the customer already holds a grant for", async () => {
    mockGetGrantedPlanIds.mockResolvedValue(["pro"]);

    const response = await post({ intent: "lifetime" });

    expect(response.status).toBe(409);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before creating anything", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(401);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });
});
