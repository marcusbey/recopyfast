import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Children,
  Suspense,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

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

const mockReadGrantedPlans = jest.fn();

jest.mock("@/lib/billing/effective-plan", () => ({
  readGrantedPlanIds: jest.fn(async () => []),
  readGrantedPlans: (...args: unknown[]) => mockReadGrantedPlans(...args),
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
    lifetimeGrant,
  }: {
    agencyCheckoutEnabled: boolean;
    lifetimeGrant: unknown;
  }) => (
    <>
      <div data-testid="agency-checkout-enabled">
        {String(agencyCheckoutEnabled)}
      </div>
      <div data-testid="lifetime-grant">{JSON.stringify(lifetimeGrant)}</div>
    </>
  ),
}));

import BillingPage from "../page";
import { BILLING_PAGE_COPY } from "@/components/billing/billing-page-copy";

async function renderBillingDashboardSection() {
  const page = BillingPage() as ReactElement<{
    children: ReactElement<{ children: ReactElement }>;
  }>;
  const suspense = page.props.children;
  const section = suspense.props.children;
  const Section = section.type as () => Promise<ReactElement>;

  render(await Section());
}

/**
 * What the browser paints while the grant read is pending: the page's tree
 * with every Suspense boundary replaced by its fallback. Rendering the async
 * section itself in jsdom would only exercise React's client-side refusal of
 * async components, not the page.
 */
function firstPaint(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{
    children?: ReactNode;
    fallback?: ReactNode;
  }>;
  if (element.type === Suspense) return element.props.fallback;
  if (element.props.children === undefined) return element;
  return cloneElement(
    element,
    undefined,
    Children.map(element.props.children, firstPaint),
  );
}

describe("BillingPage", () => {
  const originalAgencyCheckoutEnabled = process.env.AGENCY_CHECKOUT_ENABLED;

  beforeEach(() => {
    mockReadGrantedPlans.mockReset();
    mockReadGrantedPlans.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalAgencyCheckoutEnabled === undefined) {
      delete process.env.AGENCY_CHECKOUT_ENABLED;
    } else {
      process.env.AGENCY_CHECKOUT_ENABLED = originalAgencyCheckoutEnabled;
    }
  });

  /*
   * s66b1 review M-1 (ADR 053: never wrap PageShell). The page used to keep a
   * `min-h-screen bg-surface-1` div around its Suspense: a darker band that,
   * once the page container went, sat flush at the content's edge and forced
   * ~120px of empty scroll on short states. The layout owns the canvas; the
   * page's outermost element is the frame itself.
   */
  it("renders the frame as its outermost element, with no band around it", () => {
    const { container } = render(<>{firstPaint(BillingPage())}</>);

    const root = container.firstElementChild;
    expect(root).toHaveAttribute("data-page-shell");
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-surface-1")).toBeNull();
  });

  /*
   * s66b1 review m-4. The fallback is what the page paints until the client
   * takes over, and `BillingDashboard`'s loading state is what it paints
   * next. Its title and description were typed twice, unpinned, and its body
   * lacked the trial-status skeleton the client's loading state opens with,
   * so the body shifted down on hand-off.
   */
  it("paints the client's loading frame: the shared title, description and trial skeleton", () => {
    render(<>{firstPaint(BillingPage())}</>);

    const header = document.querySelector("[data-page-header]");
    expect(
      screen.getByRole("heading", { level: 1, name: BILLING_PAGE_COPY.title }),
    ).toBeInTheDocument();
    expect(header).toHaveTextContent(BILLING_PAGE_COPY.description);
    expect(
      screen.getByRole("status", { name: "Loading trial status" }),
    ).toBeInTheDocument();
  });

  // A server component imports this copy. From a "use client" module the
  // constants would arrive as client references, not strings, and the
  // fallback would lose its title; jsdom cannot see that, so the source can.
  it("keeps the shared copy in a module a server component can import", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/billing/billing-page-copy.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("uses the shared Agency checkout guard for the sales surface", async () => {
    process.env.AGENCY_CHECKOUT_ENABLED = "true";
    mockIsAgencyCheckoutEnabled.mockReturnValue(false);

    await renderBillingDashboardSection();

    expect(
      await screen.findByTestId("agency-checkout-enabled"),
    ).toHaveTextContent("false");
  });

  /*
   * s82 review (second pass), m3: the plan dialog called a plan included by a
   * dated grant "Included for life". The page's one grant read now carries
   * when each plan's holding ends, and hands the dated ones to the dashboard.
   */
  it("hands the dashboard each granted plan, and the end of the dated ones", async () => {
    mockReadGrantedPlans.mockResolvedValue([
      { planId: "pro", expiresAt: null },
      { planId: "agency", expiresAt: "2026-11-19T12:00:00.000Z" },
    ]);

    await renderBillingDashboardSection();

    const passed = JSON.parse(
      (await screen.findByTestId("lifetime-grant")).textContent ?? "null",
    );
    expect(passed).toEqual({
      kind: "granted",
      planIds: ["pro", "agency"],
      endsAt: { agency: "2026-11-19T12:00:00.000Z" },
    });
  });

  it("hands the dashboard no grant when the account holds none", async () => {
    mockReadGrantedPlans.mockResolvedValue([]);

    await renderBillingDashboardSection();

    const passed = JSON.parse(
      (await screen.findByTestId("lifetime-grant")).textContent ?? "null",
    );
    expect(passed).toEqual({ kind: "none" });
  });
});
