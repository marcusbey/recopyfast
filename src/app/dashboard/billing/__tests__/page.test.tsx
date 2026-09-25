import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const mockIsAgencyCheckoutEnabled = jest.fn();

jest.mock("@/lib/stripe/plans", () => ({
  isAgencyCheckoutEnabled: () => mockIsAgencyCheckoutEnabled(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
  })),
}));

jest.mock("@/lib/billing/effective-plan", () => ({
  readGrantedPlanIds: jest.fn(async () => []),
}));

jest.mock("@/lib/billing/founding-agency", () => ({
  getFoundingAgencyAvailability: jest.fn(async () => ({
    remaining: 4,
    limit: 50,
    soldOut: false,
  })),
}));

jest.mock("@/components/billing/BillingDashboard", () => ({
  BillingDashboard: ({
    agencyCheckoutEnabled,
  }: {
    agencyCheckoutEnabled: boolean;
  }) => (
    <div data-testid="agency-checkout-enabled">
      {String(agencyCheckoutEnabled)}
    </div>
  ),
}));

import BillingPage from "../page";

async function renderBillingDashboardSection() {
  const page = BillingPage() as ReactElement<{
    children: ReactElement<{ children: ReactElement }>;
  }>;
  const suspense = page.props.children;
  const section = suspense.props.children;
  const Section = section.type as () => Promise<ReactElement>;

  render(await Section());
}

describe("BillingPage", () => {
  const originalAgencyCheckoutEnabled = process.env.AGENCY_CHECKOUT_ENABLED;

  afterEach(() => {
    if (originalAgencyCheckoutEnabled === undefined) {
      delete process.env.AGENCY_CHECKOUT_ENABLED;
    } else {
      process.env.AGENCY_CHECKOUT_ENABLED = originalAgencyCheckoutEnabled;
    }
  });

  it("uses the shared Agency checkout guard for the sales surface", async () => {
    process.env.AGENCY_CHECKOUT_ENABLED = "true";
    mockIsAgencyCheckoutEnabled.mockReturnValue(false);

    await renderBillingDashboardSection();

    expect(
      await screen.findByTestId("agency-checkout-enabled"),
    ).toHaveTextContent("false");
  });
});
