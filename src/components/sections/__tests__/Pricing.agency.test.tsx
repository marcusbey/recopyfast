import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Pricing from "../Pricing";

const plans = [
  {
    id: "starter",
    name: "Starter",
    description: "For one site",
    monthlyPrice: 9,
    yearlyPrice: 7.5,
    yearlyTotal: 90,
    features: ["1 website"],
    highlight: false,
    badge: null,
    cta: "Get started",
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing teams",
    monthlyPrice: 19,
    yearlyPrice: 15.75,
    yearlyTotal: 189,
    features: ["5 websites"],
    highlight: true,
    badge: "Most popular",
    cta: "Get started",
  },
  {
    id: "agency",
    name: "Agency",
    description: "For client work",
    monthlyPrice: 49,
    yearlyPrice: 40.83,
    yearlyTotal: 490,
    features: ["10 client websites", "Unlimited invited editors"],
    highlight: false,
    badge: null,
    cta: "Get started",
  },
];

const foundingProduct = {
  id: "lifetime_agency",
  name: "Founding Agency (lifetime)",
  description: "One payment for permanent Agency access",
  price: 299,
  features: ["Everything in Agency", "Priority support + onboarding call"],
  grantsPlanId: "agency",
};

const lifetimeProProduct = {
  id: "lifetime_pro",
  name: "Lifetime Pro",
  description: "One payment for permanent Pro access",
  price: 199,
  features: ["Everything in Pro", "Up to 5 websites"],
  grantsPlanId: "pro",
};

function pricingResponse(
  availability: { remaining: number; limit: 50; soldOut: boolean } | null = {
    remaining: 17,
    limit: 50,
    soldOut: false,
  },
) {
  return {
    plans,
    oneTimeProducts: [lifetimeProProduct, foundingProduct],
    foundingAgencyAvailability: availability,
  };
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => pricingResponse(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Agency pricing", () => {
  it("keeps Lifetime Pro and adds the founding offer below the subscriptions", async () => {
    render(<Pricing />);

    expect(
      await screen.findByRole("heading", { name: "Agency" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$49")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Founding Agency (lifetime)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$299")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Lifetime Pro" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();
    expect(
      screen.getByText("17 of 50 founding spots left"),
    ).toBeInTheDocument();
  });

  it("shows the exact yearly charge rather than multiplying the rounded equivalent", async () => {
    const user = userEvent.setup();
    render(<Pricing />);

    await screen.findByRole("heading", { name: "Agency" });
    await user.click(screen.getByRole("button", { name: /yearly/i }));

    expect(screen.getByText("$40.83")).toBeInTheDocument();
    expect(screen.getByText("$490 charged annually")).toBeInTheDocument();
    expect(screen.queryByText("$489.96 charged annually")).toBeNull();
  });

  it("renders a disabled sold-out action at zero", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () =>
        pricingResponse({ remaining: 0, limit: 50, soldOut: true }),
    });

    render(<Pricing />);

    expect(await screen.findAllByText("Sold out")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sold out" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /buy lifetime pro/i }),
    ).toBeInTheDocument();
  });

  it("does not invent remaining spots when availability could not be read", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => pricingResponse(null),
    });

    render(<Pricing />);

    await screen.findByRole("heading", { name: "Founding Agency (lifetime)" });
    expect(screen.queryByText(/founding spots left/i)).toBeNull();
    expect(
      screen.getByText("Availability temporarily unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Availability unavailable" }),
    ).toBeDisabled();
  });

  it("treats an older cached payload with no availability field as unknown", async () => {
    const response = pricingResponse();
    const legacyResponse = {
      plans: response.plans,
      oneTimeProducts: response.oneTimeProducts,
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => legacyResponse,
    });

    render(<Pricing />);

    await screen.findByRole("heading", { name: "Founding Agency (lifetime)" });
    expect(screen.queryByText(/founding spots left/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Availability unavailable" }),
    ).toBeDisabled();
  });

  it("derives legacy annual totals when an older payload has no yearlyTotal", async () => {
    const response = pricingResponse();
    const legacyPlans = response.plans.map((plan) => {
      const legacyPlan: Record<string, unknown> = { ...plan };
      delete legacyPlan.yearlyTotal;
      return legacyPlan;
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ ...response, plans: legacyPlans }),
    });
    const user = userEvent.setup();

    render(<Pricing />);
    await screen.findByRole("heading", { name: "Agency" });
    await user.click(screen.getByRole("button", { name: /yearly/i }));

    expect(screen.getByText("$90 charged annually")).toBeInTheDocument();
    expect(screen.getByText("$189 charged annually")).toBeInTheDocument();
    expect(screen.getByText("$18.00 saved yearly")).toBeInTheDocument();
    expect(screen.getByText("$39.00 saved yearly")).toBeInTheDocument();
  });
});
