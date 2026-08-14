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

const mockCreateCheckoutSession = jest.fn();

jest.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
  getCheckoutSessionStatus: jest.fn(),
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

    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "buyer@example.com" } },
      error: null,
    });
    mockGetGrantedPlanIds.mockResolvedValue([]);
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
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
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
