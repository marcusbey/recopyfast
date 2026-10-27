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

// `unknown`, not the route's type: the card must survive whatever reaches it
// through two cache layers, including payloads the route would never send.
function pricingResponse(
  availability: unknown = {
    remaining: 17,
    limit: 50,
    soldOut: false,
  },
  agencyProduct: typeof foundingProduct = foundingProduct,
) {
  return {
    plans,
    oneTimeProducts: [lifetimeProProduct, agencyProduct],
    foundingAgencyAvailability: availability,
  };
}

function mockPricing(body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function meterCells(meter: HTMLElement) {
  return Array.from(meter.querySelectorAll<HTMLElement>("[data-state]"));
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
    render(<Pricing offer={{ status: "closed" }} />);

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
    expect(screen.getByText("17 of 50 spots left at $299")).toBeInTheDocument();
  });

  it("shows the exact yearly charge rather than multiplying the rounded equivalent", async () => {
    const user = userEvent.setup();
    render(<Pricing offer={{ status: "closed" }} />);

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

    render(<Pricing offer={{ status: "closed" }} />);

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

    render(<Pricing offer={{ status: "closed" }} />);

    await screen.findByRole("heading", { name: "Founding Agency (lifetime)" });
    expect(screen.queryByText(/spots left/i)).toBeNull();
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

    render(<Pricing offer={{ status: "closed" }} />);

    await screen.findByRole("heading", { name: "Founding Agency (lifetime)" });
    expect(screen.queryByText(/spots left/i)).toBeNull();
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

    render(<Pricing offer={{ status: "closed" }} />);
    await screen.findByRole("heading", { name: "Agency" });
    await user.click(screen.getByRole("button", { name: /yearly/i }));

    expect(screen.getByText("$90 charged annually")).toBeInTheDocument();
    expect(screen.getByText("$189 charged annually")).toBeInTheDocument();
    expect(screen.getByText("$18.00 saved yearly")).toBeInTheDocument();
    expect(screen.getByText("$39.00 saved yearly")).toBeInTheDocument();
  });
});

describe("Lifetime Agency spot meter (s124)", () => {
  it("draws one cell per spot under the price, with the count and the hold line", async () => {
    render(<Pricing offer={{ status: "closed" }} />);

    const meter = await screen.findByRole("img", {
      name: "17 of 50 spots left",
    });
    const cells = meterCells(meter);
    expect(cells).toHaveLength(50);
    expect(cells.filter((cell) => cell.dataset.state === "taken")).toHaveLength(
      33,
    );
    expect(cells.filter((cell) => cell.dataset.state === "next")).toHaveLength(
      1,
    );
    expect(screen.getByText("17 of 50 spots left at $299")).toBeInTheDocument();
    expect(
      screen.getByText("An open checkout can hold a spot for a short time."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/founding spots/i)).toBeNull();
  });

  it("takes every number from the payload, not from the copy", async () => {
    mockPricing(
      pricingResponse(
        { remaining: 12, limit: 40, soldOut: false },
        { ...foundingProduct, price: 349 },
      ),
    );

    render(<Pricing offer={{ status: "closed" }} />);

    const meter = await screen.findByRole("img", {
      name: "12 of 40 spots left",
    });
    expect(meterCells(meter)).toHaveLength(40);
    expect(screen.getByText("12 of 40 spots left at $349")).toBeInTheDocument();
  });

  it("says when one spot is left", async () => {
    mockPricing(pricingResponse({ remaining: 1, limit: 50, soldOut: false }));

    render(<Pricing offer={{ status: "closed" }} />);

    const meter = await screen.findByRole("img", {
      name: "1 of 50 spots left",
    });
    expect(meterCells(meter)[49].dataset.state).toBe("next");
    expect(screen.getByText("Last spot left at $299")).toBeInTheDocument();
    expect(screen.queryByText(/1 of 50 spots left at/)).toBeNull();
  });

  it("keeps the checkout link and its analytics, with the new label", async () => {
    render(<Pricing offer={{ status: "closed" }} />);

    const cta = await screen.findByRole("link", {
      name: "Get lifetime access",
    });
    expect(cta).toHaveAttribute("href", "/dashboard/billing");
    expect(cta).toHaveAttribute("data-cta-location", "pricing_founding_agency");
    expect(cta).toHaveAttribute("data-fast-goal", "cta_click");
    expect(cta).toHaveAttribute(
      "data-fast-goal-location",
      "pricing_founding_agency",
    );
    expect(cta).toHaveAttribute("data-fast-goal-target", "checkout");
    expect(cta).toHaveAttribute("data-fast-goal-plan", "lifetime_agency");
    expect(screen.queryByText("Buy founding access")).toBeNull();
  });

  it("draws a full meter when sold out, with no checkout link", async () => {
    mockPricing(pricingResponse({ remaining: 0, limit: 50, soldOut: true }));

    render(<Pricing offer={{ status: "closed" }} />);

    const meter = await screen.findByRole("img", {
      name: "0 of 50 spots left",
    });
    expect(
      meterCells(meter).every((cell) => cell.dataset.state === "taken"),
    ).toBe(true);
    expect(meterCells(meter)).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Sold out" })).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Get lifetime access" }),
    ).toBeNull();
    expect(
      screen.queryByText("An open checkout can hold a spot for a short time."),
    ).toBeNull();
  });

  it.each([
    ["null (failed refresh served from cache)", null],
    [
      "a limit far above the cell cap",
      { remaining: 5000, limit: 5000, soldOut: false },
    ],
    ["remaining above limit", { remaining: 51, limit: 50, soldOut: false }],
    ["a negative remaining", { remaining: -1, limit: 50, soldOut: false }],
    ["a fractional remaining", { remaining: 16.5, limit: 50, soldOut: false }],
    ["a string count", { remaining: "17", limit: 50, soldOut: false }],
    [
      "soldOut that contradicts the count",
      { remaining: 17, limit: 50, soldOut: true },
    ],
    ["a non-object", "17 of 50"],
  ])(
    "treats %s as unknown: no meter, no count, no checkout",
    async (_label, availability) => {
      mockPricing(pricingResponse(availability));

      render(<Pricing offer={{ status: "closed" }} />);

      await screen.findByRole("heading", {
        name: "Founding Agency (lifetime)",
      });
      expect(screen.queryByRole("img", { name: /spots left/i })).toBeNull();
      expect(screen.queryByText(/spots left/i)).toBeNull();
      expect(screen.queryByText("Sold out")).toBeNull();
      expect(
        screen.getByText("Availability temporarily unavailable"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Availability unavailable" }),
      ).toBeDisabled();
      expect(
        screen.queryByRole("link", { name: "Get lifetime access" }),
      ).toBeNull();
    },
  );

  it("renders the meter on the editorial homepage variant too", async () => {
    render(<Pricing offer={{ status: "closed" }} variant="editorial" />);

    const meter = await screen.findByRole("img", {
      name: "17 of 50 spots left",
    });
    expect(meterCells(meter)).toHaveLength(50);
    expect(screen.getByText("17 of 50 spots left at $299")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Founding Agency (lifetime)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Get lifetime access" }),
    ).toHaveAttribute("data-cta-location", "pricing_founding_agency");
  });
});
