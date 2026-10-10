/**
 * @jest-environment node
 */

/**
 * s75: an anonymous caller is refused, with 401, before any billing work.
 *
 * The root `e2e-billing-tests.spec.ts` claimed these 401s; it sat outside
 * Playwright's testDir and never ran, and s75 deleted it. Until this file no
 * test pinned them: `payment-methods` GET/POST/DELETE, `subscription`
 * PUT/DELETE and `subscription/reactivate` POST. (`subscription` GET is pinned
 * by src/__tests__/security/auth-guards.test.ts; the route has no POST.)
 *
 * Each handler gets a request it would act on if signed in, so a missing
 * guard reaches billing work instead of failing on bad input. The signed-in
 * sibling of each case proves the 401 comes from the session check, not from
 * a mock that broke the route.
 *
 * s82: `payment-methods` is rate limited per IP before the session check, so
 * its handlers read the request — GET included — and the limiter is mocked to
 * let every call through: this file pins the session check, the limiter is
 * pinned by payment-methods.test.ts.
 */

import { NextRequest } from "next/server";

const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  reactivateSubscription: jest.fn(),
}));

jest.mock("@/lib/stripe/customer", () => ({
  getCustomerByUserId: jest.fn(),
}));

jest.mock("@/lib/stripe/payment-methods", () => ({
  listPaymentMethods: jest.fn(),
  setDefaultPaymentMethod: jest.fn(),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    paymentMethods: { retrieve: jest.fn(), detach: jest.fn() },
  },
}));

import * as paymentMethodsRoute from "@/app/api/billing/payment-methods/route";
import * as subscriptionRoute from "@/app/api/billing/subscription/route";
import * as reactivateRoute from "@/app/api/billing/subscription/reactivate/route";
import { stripe } from "@/lib/stripe/config";
import { getCustomerByUserId } from "@/lib/stripe/customer";
import {
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "@/lib/stripe/payment-methods";
import {
  cancelSubscription,
  getUserSubscription,
  reactivateSubscription,
  updateSubscription,
} from "@/lib/stripe/subscription";

const ORIGIN = "http://localhost:3000";

function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Every call that reads or changes billing state, in Stripe or our tables. */
const BILLING_WORK = [
  getUserSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,
  getCustomerByUserId,
  listPaymentMethods,
  setDefaultPaymentMethod,
  stripe.paymentMethods.retrieve,
  stripe.paymentMethods.detach,
] as jest.Mock[];

interface Case {
  /** The handler's first billing call when a user is signed in. */
  work: jest.Mock;
  call: () => Promise<Response>;
}

const CASES: Record<string, Case> = {
  "GET /api/billing/payment-methods": {
    work: getCustomerByUserId as jest.Mock,
    call: () =>
      paymentMethodsRoute.GET(request("GET", "/api/billing/payment-methods")),
  },
  "POST /api/billing/payment-methods": {
    work: getCustomerByUserId as jest.Mock,
    call: () =>
      paymentMethodsRoute.POST(
        request("POST", "/api/billing/payment-methods", {
          paymentMethodId: "pm_test_123",
          setAsDefault: true,
        }),
      ),
  },
  "DELETE /api/billing/payment-methods": {
    work: getCustomerByUserId as jest.Mock,
    call: () =>
      paymentMethodsRoute.DELETE(
        request(
          "DELETE",
          "/api/billing/payment-methods?paymentMethodId=pm_test_123",
        ),
      ),
  },
  "PUT /api/billing/subscription": {
    work: updateSubscription as jest.Mock,
    call: () =>
      subscriptionRoute.PUT(
        request("PUT", "/api/billing/subscription", {
          planId: "starter",
          billingPeriod: "monthly",
        }),
      ),
  },
  "DELETE /api/billing/subscription": {
    work: cancelSubscription as jest.Mock,
    call: () =>
      subscriptionRoute.DELETE(
        request("DELETE", "/api/billing/subscription?immediate=true"),
      ),
  },
  "POST /api/billing/subscription/reactivate": {
    work: reactivateSubscription as jest.Mock,
    call: () => reactivateRoute.POST(),
  },
};

const ENTRIES = Object.entries(CASES);

describe("billing routes refuse an anonymous caller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(ENTRIES)(
    "%s answers 401 and does no billing work",
    async (_route, { call }) => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Auth session missing!", status: 400 },
      });

      const response = await call();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized",
      });
      expect(BILLING_WORK.filter((work) => work.mock.calls.length > 0)).toEqual(
        [],
      );
    },
  );

  it.each(ENTRIES)(
    "%s does reach billing work for a signed-in caller (the 401 is the session check)",
    async (_route, { call, work }) => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-1", email: "owner@example.com" } },
        error: null,
      });

      const response = await call();

      expect(response.status).not.toBe(401);
      expect(work.mock.calls.map((args) => args[0])).toEqual(["user-1"]);
    },
  );
});
