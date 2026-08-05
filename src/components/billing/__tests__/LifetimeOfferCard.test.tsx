import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LifetimeOfferCard,
  resolveLifetimeOffer,
  type LifetimeGrantStatus,
} from "../LifetimeOfferCard";
import type { OneTimeProduct, PlanCatalogue } from "@/lib/stripe/plan-types";

const LIFETIME_PRO: OneTimeProduct = {
  id: "lifetime_pro",
  name: "Lifetime Pro",
  description: "Pay once, keep every Pro feature forever",
  price: 199,
  features: ["Everything in Pro", "One payment, no renewal"],
  grantsPlanId: "pro",
  sortOrder: 40,
};

const CREDITS: OneTimeProduct = {
  id: "credits",
  name: "AI credits",
  description: "Pay-per-use AI",
  price: 10,
  features: ["1,000 AI credits"],
  grantsPlanId: null,
  sortOrder: 30,
};

function catalogueWith(
  oneTimeProducts: readonly OneTimeProduct[],
): PlanCatalogue {
  return {
    subscriptions: [],
    oneTimeProducts,
    creditPack: {
      creditsPerPack: 1000,
      maxPacksPerPurchase: 100,
      pricePerPack: 10,
    },
  };
}

const CATALOGUE = catalogueWith([CREDITS, LIFETIME_PRO]);

describe("resolveLifetimeOffer — who may be sold a permanent grant", () => {
  it("offers the catalogue's lifetime product to an account with no grant", () => {
    const grant: LifetimeGrantStatus = { kind: "none" };

    expect(resolveLifetimeOffer(CATALOGUE, grant)).toEqual(LIFETIME_PRO);
  });

  it("withholds it from someone whose grant already confers that plan", () => {
    // The whole point of the guard: this account paid $199 once already, and
    // nothing else in the client payload can tell it apart from a Pro monthly
    // subscriber.
    const grant: LifetimeGrantStatus = { kind: "granted", planIds: ["pro"] };

    expect(resolveLifetimeOffer(CATALOGUE, grant)).toBeNull();
  });

  it("withholds it when the grant could not be read", () => {
    const grant: LifetimeGrantStatus = { kind: "unknown" };

    expect(resolveLifetimeOffer(CATALOGUE, grant)).toBeNull();
  });

  it("still offers it when the grant is for some other plan", () => {
    // A comped Starter grant is not the Pro this product sells.
    const grant: LifetimeGrantStatus = {
      kind: "granted",
      planIds: ["starter"],
    };

    expect(resolveLifetimeOffer(CATALOGUE, grant)).toEqual(LIFETIME_PRO);
  });

  it("withholds it when ANY live grant confers the plan, not just the newest", () => {
    // A lifetime Pro buyer who later received a comped Starter grant. Reading
    // only the most recent row reports "starter", which does not match what
    // this product confers — so the offer would reappear and charge $199 for
    // something they already own.
    const grant: LifetimeGrantStatus = {
      kind: "granted",
      planIds: ["starter", "pro"],
    };

    expect(resolveLifetimeOffer(CATALOGUE, grant)).toBeNull();
  });

  it("offers nothing when the catalogue has no lifetime row", () => {
    expect(
      resolveLifetimeOffer(catalogueWith([CREDITS]), { kind: "none" }),
    ).toBe(null);
  });

  it("offers nothing when the lifetime row grants no plan", () => {
    // createCheckoutSession throws on exactly this condition rather than taking
    // money for an empty promise, so the button must not be drawn either.
    const catalogue = catalogueWith([{ ...LIFETIME_PRO, grantsPlanId: null }]);

    expect(resolveLifetimeOffer(catalogue, { kind: "none" })).toBeNull();
  });
});

describe("LifetimeOfferCard", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://checkout.stripe.com/c/pay/cs_test_lifetime",
      }),
    });
    // jsdom cannot navigate, and the hook finishes by handing the browser to
    // Stripe with `window.location.assign`. jsdom reports that as an
    // unimplemented navigation through console.error; the navigation itself is
    // the intended outcome, so the notice is silenced rather than treated as a
    // failure.
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the name, price and description from the catalogue", () => {
    render(
      <LifetimeOfferCard product={LIFETIME_PRO} hasLiveSubscription={false} />,
    );

    expect(screen.getByText("Lifetime Pro")).toBeInTheDocument();
    expect(
      screen.getByText("Pay once, keep every Pro feature forever"),
    ).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();
    expect(screen.getByText("Everything in Pro")).toBeInTheDocument();
  });

  it("prices the button from the product rather than a compiled-in number", () => {
    render(
      <LifetimeOfferCard
        product={{ ...LIFETIME_PRO, price: 249 }}
        hasLiveSubscription={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Buy once — $249" }),
    ).toBeInTheDocument();
  });

  it("starts a lifetime Checkout Session when the button is pressed", async () => {
    const user = userEvent.setup();
    render(
      <LifetimeOfferCard product={LIFETIME_PRO} hasLiveSubscription={false} />,
    );

    await user.click(screen.getByRole("button", { name: /buy once/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "lifetime" }),
      });
    });
  });

  it("surfaces a checkout failure instead of pretending it worked", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Lifetime Pro is not on sale" }),
    });
    render(
      <LifetimeOfferCard product={LIFETIME_PRO} hasLiveSubscription={false} />,
    );

    await user.click(screen.getByRole("button", { name: /buy once/i }));

    expect(
      await screen.findByText("Lifetime Pro is not on sale"),
    ).toBeInTheDocument();
  });

  it("says nothing about subscriptions when there is none to keep paying for", () => {
    render(
      <LifetimeOfferCard product={LIFETIME_PRO} hasLiveSubscription={false} />,
    );

    expect(screen.queryByText(/does not cancel/i)).not.toBeInTheDocument();
  });

  it("tells a subscriber their renewal stops by itself", () => {
    // This asserted "does not cancel your current subscription. Cancel it
    // yourself" — true when written, false once the webhook started setting
    // cancel_at_period_end on a lifetime purchase. A customer acting on it
    // would cancel early and lose the period they had already paid for.
    render(
      <LifetimeOfferCard product={LIFETIME_PRO} hasLiveSubscription={true} />,
    );

    expect(screen.getByText(/stop renewing/i)).toBeInTheDocument();
    // The old instruction's distinguishing threat, which is no longer true.
    expect(
      screen.queryByText(/keep paying every month/i),
    ).not.toBeInTheDocument();
  });
});
