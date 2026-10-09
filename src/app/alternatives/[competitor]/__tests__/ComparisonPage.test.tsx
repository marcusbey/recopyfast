import { render, screen, within } from "@testing-library/react";
import { ALTERNATIVES } from "@/content/alternatives";
import { ComparisonPage } from "../ComparisonPage";

jest.mock("@/components/layout/Header", () => ({
  Header: () => <header data-testid="marketing-header" />,
}));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => <footer data-testid="marketing-footer" />,
}));

const TINA = ALTERNATIVES[0];

describe("alternative comparison page", () => {
  it("renders the complete honest comparison from one typed entry", () => {
    render(
      <ComparisonPage
        entry={TINA}
        pageUrl="https://www.recopyfa.st/alternatives/tinacms"
        recopyFastPrice="$19/month"
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "TinaCMS alternative for an existing website",
      }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "ReCopyFast and TinaCMS comparison",
    });
    for (const row of [
      "Setup",
      "Where content lives",
      "Editing without a developer",
      "Client edits without an account",
      "Starting price",
    ]) {
      expect(within(table).getByText(row)).toBeInTheDocument();
    }
    expect(screen.getByText("Where TinaCMS wins")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(9);
    for (const item of TINA.faq) {
      expect(screen.getByText(item.question)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: "TinaCMS pricing" }),
    ).toHaveAttribute("href", "https://tina.io/pricing");
  });

  it("renders FAQ JSON-LD from the exact visible FAQ array", () => {
    const { container } = render(
      <ComparisonPage
        entry={TINA}
        pageUrl="https://www.recopyfa.st/alternatives/tinacms"
        recopyFastPrice={null}
      />,
    );

    const scripts = [
      ...container.querySelectorAll('script[type="application/ld+json"]'),
    ].map((script) => JSON.parse(script.textContent || "{}"));
    const faq = scripts.find((script) => script["@type"] === "FAQPage");

    expect(scripts.map((script) => script["@type"])).toEqual([
      "SoftwareApplication",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(faq.mainEntity.map((item: { name: string }) => item.name)).toEqual(
      TINA.faq.map((item) => item.question),
    );
    expect(
      screen.getByRole("link", { name: "See current pricing" }),
    ).toHaveAttribute("href", "/#pricing");
  });
});
