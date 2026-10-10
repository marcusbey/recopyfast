import { render } from "@testing-library/react";

/**
 * s88 — the homepage carries one SoftwareApplication JSON-LD whose offers are
 * the catalogue's.
 *
 * The page is a server wrapper around a client body; the body is mocked here
 * because what is under test is the markup the server writes for crawlers.
 */

jest.mock("@/components/landing/HomePage", () => ({
  __esModule: true,
  default: () => <main data-testid="landing-body" />,
}));

jest.mock("@/lib/stripe/plans", () => ({
  getPlanCatalogue: jest.fn(),
  isAgencyCheckoutEnabled: jest.fn(() => true),
}));

import Home, { revalidate } from "@/app/page";
import { getPlanCatalogue } from "@/lib/stripe/plans";
import { resolveSiteUrl } from "@/lib/seo/site-url";

const mockedCatalogue = jest.mocked(getPlanCatalogue);

function ldScripts(container: HTMLElement): unknown[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  ).map((script) => JSON.parse(script.textContent ?? ""));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("homepage structured data", () => {
  it("renders the landing body and exactly one SoftwareApplication", async () => {
    mockedCatalogue.mockResolvedValue({
      subscriptions: [
        { id: "starter", name: "Starter", price: 9 },
        { id: "pro", name: "Pro", price: 19 },
      ],
      oneTimeProducts: [],
    } as never);

    const { container, getByTestId } = render(await Home());

    expect(getByTestId("landing-body")).toBeInTheDocument();
    const scripts = ldScripts(container);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ReCopyFast",
      url: resolveSiteUrl(),
    });
    expect(
      (scripts[0] as { offers: { name: string; price: number }[] }).offers.map(
        (offer) => [offer.name, offer.price],
      ),
    ).toEqual([
      ["Starter", 9],
      ["Pro", 19],
    ]);
  });

  it("states no price at all when the catalogue cannot be read", async () => {
    mockedCatalogue.mockRejectedValue(new Error("fetch failed"));

    const { container } = render(await Home());

    const scripts = ldScripts(container);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toHaveProperty("offers");
  });

  it("refreshes with the pricing feed, every five minutes", () => {
    expect(revalidate).toBe(300);
  });
});
