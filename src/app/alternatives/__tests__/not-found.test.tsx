import { render, screen } from "@testing-library/react";
import AlternativesNotFound from "../not-found";

jest.mock("@/components/layout/Header", () => ({
  Header: () => <header data-testid="marketing-header" />,
}));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => <footer data-testid="marketing-footer" />,
}));

describe("alternatives not-found surface", () => {
  it("keeps an unknown comparison on the marketing surface", () => {
    const { container } = render(<AlternativesNotFound />);

    expect(
      screen.getByRole("heading", { name: "Comparison not found" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("marketing-header")).toBeInTheDocument();
    expect(screen.getByTestId("marketing-footer")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "bg-gradient-to-b",
      "from-sky-50",
      "to-white",
    );
    expect(screen.getByRole("link", { name: "TinaCMS" })).toHaveAttribute(
      "href",
      "/alternatives/tinacms",
    );
  });
});
