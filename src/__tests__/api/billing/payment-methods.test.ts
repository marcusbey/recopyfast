/**
 * /api/billing/payment-methods — what a caller can learn, and how fast.
 *
 * s82 (s69 L5). Two leaks and no limiter:
 *   - an unknown payment-method id made `stripe.paymentMethods.retrieve` throw
 *     "No such PaymentMethod: 'pm_…'", answered as a 500 carrying that text,
 *     while another customer's id answered 404 "Payment method not found" — so
 *     the answer told the caller which ids exist;
 *   - every other failure returned Stripe's own sentence.
 * Both are answered as "not found" now, everything else generically, and the
 * route is rate limited per IP before authorisation (AGENTS.md).
 *
 * Stripe is a mock; nothing is called for real.
 */

const mockGetUser = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

const mockRetrieve = jest.fn();
const mockDetach = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    paymentMethods: {
      retrieve: (...args: unknown[]) => mockRetrieve(...args),
      detach: (...args: unknown[]) => mockDetach(...args),
    },
  },
}));

jest.mock("@/lib/stripe/payment-methods", () => ({
  listPaymentMethods: jest.fn(),
  setDefaultPaymentMethod: jest.fn(),
}));

jest.mock("@/lib/stripe/customer", () => ({
  getCustomerByUserId: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

import { NextRequest, NextResponse } from "next/server";
import { GET, POST, DELETE } from "@/app/api/billing/payment-methods/route";
import {
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "@/lib/stripe/payment-methods";
import { getCustomerByUserId } from "@/lib/stripe/customer";
import { enforceRateLimit } from "@/lib/api/rate-limit";

const mockList = listPaymentMethods as jest.Mock;
const mockSetDefault = setDefaultPaymentMethod as jest.Mock;
const mockGetCustomer = getCustomerByUserId as jest.Mock;
const mockLimit = enforceRateLimit as jest.Mock;

const CUSTOMER = { id: "cust-row-1", stripe_customer_id: "cus_own" };
const OWN_CARD = { id: "pm_own", customer: "cus_own" };
const SECOND_CARD = { id: "pm_second", customer: "cus_own" };

/** Stripe's answer to an id that does not exist (StripeInvalidRequestError). */
function noSuchPaymentMethod(id: string) {
  return Object.assign(new Error(`No such PaymentMethod: '${id}'`), {
    type: "StripeInvalidRequestError",
    code: "resource_missing",
    statusCode: 404,
  });
}

const URL_BASE = "http://localhost:3000/api/billing/payment-methods";

const postRequest = (body: unknown) =>
  new NextRequest(URL_BASE, { method: "POST", body: JSON.stringify(body) });

const deleteRequest = (id: string) =>
  new NextRequest(`${URL_BASE}?paymentMethodId=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  mockLimit.mockResolvedValue(null);
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  mockGetCustomer.mockResolvedValue(CUSTOMER);
  mockRetrieve.mockImplementation(async (id: string) => {
    if (id === OWN_CARD.id) return OWN_CARD;
    if (id === SECOND_CARD.id) return SECOND_CARD;
    if (id === "pm_foreign") return { id, customer: "cus_someone_else" };
    throw noSuchPaymentMethod(id);
  });
  mockList.mockResolvedValue([
    { id: OWN_CARD.id, is_default: true },
    { id: SECOND_CARD.id, is_default: false },
  ]);
  mockSetDefault.mockResolvedValue(undefined);
  mockDetach.mockResolvedValue({ id: SECOND_CARD.id });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an unknown and a foreign payment method get the same answer", () => {
  it.each(["pm_unknown", "pm_foreign"])(
    "POST %s: 404 Payment method not found, Stripe's text never sent",
    async (id) => {
      const response = await POST(postRequest({ paymentMethodId: id }));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Payment method not found" });
      expect(mockSetDefault).not.toHaveBeenCalled();
    },
  );

  it.each(["pm_unknown", "pm_foreign"])(
    "DELETE %s: 404 Payment method not found, nothing detached",
    async (id) => {
      const response = await DELETE(deleteRequest(id));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Payment method not found" });
      expect(mockDetach).not.toHaveBeenCalled();
    },
  );
});

describe("any other failure is answered generically and logged", () => {
  it("POST: a Stripe failure while setting the default", async () => {
    const stripeError = Object.assign(
      new Error("Your card was declined. Request req_live_abc123"),
      { type: "StripeCardError" },
    );
    mockSetDefault.mockRejectedValue(stripeError);

    const response = await POST(postRequest({ paymentMethodId: OWN_CARD.id }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to update payment method" });
    expect(JSON.stringify(body)).not.toContain("req_live_abc123");
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), stripeError);
  });

  it("DELETE: a Stripe failure while detaching", async () => {
    const stripeError = new Error(
      "The payment method you provided has already been detached: pm_second",
    );
    mockDetach.mockRejectedValue(stripeError);

    const response = await DELETE(deleteRequest(SECOND_CARD.id));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to remove payment method" });
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), stripeError);
  });

  it("a Stripe failure other than resource_missing on retrieve is not a 404", async () => {
    // Only "that id does not exist" is folded into "not found"; an outage must
    // not read as "you have no such card".
    mockRetrieve.mockRejectedValue(
      Object.assign(
        new Error("An error occurred with our connection to Stripe"),
        {
          type: "StripeConnectionError",
        },
      ),
    );

    const response = await POST(postRequest({ paymentMethodId: OWN_CARD.id }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to update payment method",
    });
  });
});

describe("rate limited per IP, before authorisation", () => {
  const LIMITER = expect.objectContaining({
    limit: "API_GENERAL",
    endpoint: "billing/payment-methods:ip",
    identifierType: "ip",
    onStoreFailure: "allow",
    // s82 review, finding 7: the sentence the card shows on a 429.
    message: "Too many payment method requests.",
  });

  it.each([
    ["GET", () => GET(new NextRequest(URL_BASE))],
    ["POST", () => POST(postRequest({ paymentMethodId: OWN_CARD.id }))],
    ["DELETE", () => DELETE(deleteRequest(SECOND_CARD.id))],
  ] as const)(
    "%s: a 429 never reaches authorisation or Stripe",
    async (_m, call) => {
      mockLimit.mockResolvedValue(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

      const response = await call();

      expect(response.status).toBe(429);
      expect(mockLimit).toHaveBeenCalledWith(expect.any(NextRequest), LIMITER);
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(mockRetrieve).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    },
  );
});

describe("unchanged behaviour", () => {
  it("GET lists the caller's cards", async () => {
    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      paymentMethods: [
        { id: OWN_CARD.id, is_default: true },
        { id: SECOND_CARD.id, is_default: false },
      ],
    });
  });

  it("GET without a billing customer lists nothing", async () => {
    mockGetCustomer.mockResolvedValue(null);

    const response = await GET(new NextRequest(URL_BASE));

    await expect(response.json()).resolves.toEqual({ paymentMethods: [] });
  });

  it("POST makes the caller's own card the default", async () => {
    const response = await POST(
      postRequest({ paymentMethodId: SECOND_CARD.id }),
    );

    expect(response.status).toBe(200);
    expect(mockSetDefault).toHaveBeenCalledWith("cus_own", SECOND_CARD.id);
  });

  it("POST without an id is a 400", async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
  });

  it("POST unauthenticated is a 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(postRequest({ paymentMethodId: OWN_CARD.id }));

    expect(response.status).toBe(401);
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("DELETE removes the caller's own non-default card", async () => {
    const response = await DELETE(deleteRequest(SECOND_CARD.id));

    expect(response.status).toBe(200);
    expect(mockDetach).toHaveBeenCalledWith(SECOND_CARD.id);
  });

  it("DELETE refuses the default card while another exists", async () => {
    const response = await DELETE(deleteRequest(OWN_CARD.id));

    expect(response.status).toBe(400);
    expect(mockDetach).not.toHaveBeenCalled();
  });
});
