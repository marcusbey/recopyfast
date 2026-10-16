import { render, screen } from "@testing-library/react";
import EditorialHomePage from "../EditorialHomePage";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

jest.mock("@/hooks/useFoundingOffer", () => ({
  useFoundingOffer: () => ({ data: null, loading: false, error: null }),
  toFoundingOfferView: () => ({ status: "closed" }),
}));

jest.mock("../InteractiveHero", () => ({
  __esModule: true,
  default: () => <div data-testid="real-interactive-demo" />,
}));

jest.mock("@/components/sections/Pricing", () => ({
  __esModule: true,
  default: () => <section id="pricing" data-testid="pricing" />,
}));

describe("EditorialHomePage", () => {
  it("places the real interactive demo immediately after the editable hero", () => {
    render(<EditorialHomePage />);

    const hero = screen.getByTestId("editorial-hero");
    const demo = screen.getByTestId("real-demo-section");
    expect(hero.nextElementSibling).toBe(demo);
    expect(demo).toContainElement(screen.getByTestId("real-interactive-demo"));
  });

  it("preserves the existing feature and pricing anchor destinations", () => {
    const { container } = render(<EditorialHomePage />);
    expect(container.querySelector("#features")).not.toBeNull();
    expect(screen.getByTestId("pricing")).toHaveAttribute("id", "pricing");
  });
});
