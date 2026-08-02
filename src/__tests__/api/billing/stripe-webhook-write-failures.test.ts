/**
 * The Stripe webhook must FAIL LOUD when a database write fails.
 *
 * supabase-js resolves on failure rather than rejecting, so `await
 * supabase.from(x).upsert(y)` with the result discarded cannot distinguish a
 * successful write from a failed one. Every handler in the route did exactly
 * that, then returned `{ received: true }` with HTTP 200. Stripe treats 2xx as
 * delivered and stops retrying — the card is charged, the row never lands, and
 * nothing alerts.
 *
 * These tests drive the real route handler with a mocked Supabase client whose
 * writes return `{ error }`, and assert the response is 5xx so Stripe redelivers.
 * They fail against the old code, which answered 200 for every one of them.
 */

import { POST } from "@/app/api/webhooks/stripe/route";
import { stripe, requireWebhookSecret } from "@/lib/stripe/config";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    private readonly payload: unknown;
    constructor(body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this.payload = body;
    }
    async json() {
      return this.payload;
    }
    static json(data: unknown, init?: { status?: number }) {
      return new MockNextResponse(data, init);
    }
  }
  return { NextRequest: class {}, NextResponse: MockNextResponse };
});

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "t=1,v1=x" })),
}));

jest.mock("@/lib/stripe/config", () => ({
  stripe: { webhooks: { constructEvent: jest.fn() } },
  requireWebhookSecret: jest.fn(() => "whsec_test"),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

const constructEvent = stripe.webhooks.constructEvent as jest.Mock;
const mockServiceClient = createServiceRoleClient as unknown as jest.Mock;

const WRITE_ERROR = {
  code: "08006",
  message: "connection failure",
  details: "server closed the connection unexpectedly",
};

/** A billing_customers row so handlers can attribute the event. */
const CUSTOMER_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
};

/**
 * Minimal PostgREST-shaped builder. Reads resolve with CUSTOMER_ROW; writes
 * (upsert/update) resolve with `{ error: WRITE_ERROR }` — the exact shape
 * supabase-js returns on a failed write.
 */
function buildClient(writeResult: { error: unknown }) {
  // Table-aware: billing_events must read empty (that is the idempotency probe
  // saying "not seen before"), while billing_customers must resolve a row or
  // the handler correctly refuses to attribute the event to anyone.
  const chain = (table: string) => {
    const row = table === "billing_customers" ? CUSTOMER_ROW : null;
    const thenable: Record<string, unknown> = {
      select: jest.fn(() => thenable),
      eq: jest.fn(() => thenable),
      single: jest.fn(async () => ({ data: row, error: null })),
      maybeSingle: jest.fn(async () => ({ data: row, error: null })),
      insert: jest.fn(async () => ({ error: null })),
      upsert: jest.fn(async () => writeResult),
      update: jest.fn(() => ({
        eq: jest.fn(async () => writeResult),
      })),
    };
    return thenable;
  };
  return { from: jest.fn((table: string) => chain(table)) };
}

function request(): Parameters<typeof POST>[0] {
  return { text: async () => "{}" } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireWebhookSecret as jest.Mock).mockReturnValue("whsec_test");
  mockServiceClient.mockReturnValue(buildClient({ error: WRITE_ERROR }));
});

const SUBSCRIPTION = {
  id: "sub_test",
  customer: "cus_test",
  status: "active",
  metadata: { user_id: "22222222-2222-2222-2222-222222222222", plan_id: "pro" },
  items: {
    data: [
      { current_period_start: 1700000000, current_period_end: 1702592000 },
    ],
  },
  cancel_at: null,
  canceled_at: null,
  trial_start: null,
  trial_end: null,
};

const INVOICE = {
  id: "in_test",
  customer: "cus_test",
  subscription: "sub_test",
  amount_paid: 1900,
  amount_due: 1900,
  currency: "usd",
  status: "paid",
  hosted_invoice_url: null,
  invoice_pdf: null,
};

describe("Stripe webhook — a failed database write must not return 2xx", () => {
  const cases: Array<[string, unknown]> = [
    ["customer.subscription.created", SUBSCRIPTION],
    ["customer.subscription.updated", SUBSCRIPTION],
    ["customer.subscription.deleted", SUBSCRIPTION],
    ["invoice.payment_succeeded", INVOICE],
    ["invoice.payment_failed", INVOICE],
    ["customer.updated", { id: "cus_test", email: "x@example.com", name: "X" }],
  ];

  it.each(cases)(
    "%s returns 5xx when the write fails",
    async (type, object) => {
      constructEvent.mockReturnValue({
        id: `evt_${type}`,
        type,
        data: { object },
      });

      const response = await POST(request());

      expect(response.status).toBeGreaterThanOrEqual(500);
      await expect(response.json()).resolves.not.toMatchObject({
        received: true,
      });
    },
  );
});

describe("Stripe webhook — successful writes still succeed", () => {
  it("returns 200 when every write succeeds", async () => {
    mockServiceClient.mockReturnValue(buildClient({ error: null }));
    constructEvent.mockReturnValue({
      id: "evt_ok",
      type: "customer.subscription.created",
      data: { object: SUBSCRIPTION },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ received: true });
  });

  it("still answers 200 on a concurrent duplicate (23505)", async () => {
    // A unique violation means another delivery already did the work. Retrying
    // would never succeed, so 200 is correct here and 500 would be wrong.
    mockServiceClient.mockReturnValue(
      buildClient({ error: { code: "23505", message: "duplicate key" } }),
    );
    constructEvent.mockReturnValue({
      id: "evt_dup",
      type: "customer.subscription.created",
      data: { object: SUBSCRIPTION },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
  });
});

describe("Stripe webhook — signing secret guard", () => {
  it("returns 500 without verifying when the secret is unset", async () => {
    (requireWebhookSecret as jest.Mock).mockImplementation(() => {
      throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    // The signature must never be checked against an empty key.
    expect(constructEvent).not.toHaveBeenCalled();
  });
});
