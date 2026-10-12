import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentMethodsCard } from "../PaymentMethodsCard";
import type { PaymentMethod } from "@/types/billing";

/**
 * s82 review, finding 7: `/api/billing/payment-methods` is rate limited (s82),
 * and `enforceRateLimit` answers a 429 as `{ error: "Rate limit exceeded",
 * message: <the route's sentence> }`. The card printed `error`, so the
 * sentence written for the customer never showed. A 429 now reads the way
 * checkout's does (useCheckout): a sentence, then "Try again at HH:MM." from
 * the limiter's reset header.
 */

jest.mock("../useCheckout", () => ({
  useCheckout: () => ({
    startCheckout: jest.fn(),
    isRedirecting: false,
    error: null,
    clearError: jest.fn(),
  }),
}));

const SECOND_CARD: PaymentMethod = {
  id: "pm_second",
  customer_id: "cust-row-1",
  stripe_payment_method_id: "pm_second",
  type: "card",
  brand: "visa",
  last4: "4242",
  exp_month: 4,
  exp_year: 2030,
  is_default: false,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

const RESET_EPOCH = 4_092_738_420;
const RESET_TIME = new Intl.DateTimeFormat("en-CA", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(RESET_EPOCH * 1000));

function answer(status: number, body: unknown, headers: HeadersInit = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderCard() {
  render(
    <PaymentMethodsCard paymentMethods={[SECOND_CARD]} onUpdate={jest.fn()} />,
  );
}

describe("the payment-methods card, rate limited", () => {
  it("shows the limiter's sentence and when to try again, never 'Rate limit exceeded'", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      answer(
        429,
        {
          error: "Rate limit exceeded",
          message: "Too many payment method requests.",
        },
        { "X-RateLimit-Reset": String(RESET_EPOCH) },
      ),
    );
    renderCard();

    await user.click(screen.getByRole("button", { name: "Set default" }));

    expect(
      await screen.findByText(
        `Too many payment method requests. Try again at ${RESET_TIME}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Rate limit exceeded/)).toBeNull();
  });

  it("says the same when removing a card is limited", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      answer(
        429,
        {
          error: "Rate limit exceeded",
          message: "Too many payment method requests.",
        },
        { "X-RateLimit-Reset": String(RESET_EPOCH) },
      ),
    );
    renderCard();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove card" }));

    expect(
      await screen.findByText(
        `Too many payment method requests. Try again at ${RESET_TIME}.`,
      ),
    ).toBeInTheDocument();
  });

  it("keeps every other refusal's own error (unchanged)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      answer(404, { error: "Payment method not found" }),
    );
    renderCard();

    await user.click(screen.getByRole("button", { name: "Set default" }));

    expect(
      await screen.findByText("Payment method not found"),
    ).toBeInTheDocument();
  });
});
