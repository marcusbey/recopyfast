import { render, screen } from "@testing-library/react";
import { CostResultCard } from "../CostResultCard";
import {
  DEFAULT_INPUTS,
  calculateCost,
} from "@/lib/tools/maintenance-cost/calculate";
import { buildCardText } from "@/lib/tools/maintenance-cost/embed-snippet";

describe("CostResultCard", () => {
  const result = calculateCost(DEFAULT_INPUTS);

  it("renders the four card lines as plain text", () => {
    render(<CostResultCard result={result} />);

    const text = buildCardText(result);
    expect(screen.getByText(text.eyebrow)).toBeInTheDocument();
    expect(screen.getByText(text.figure)).toBeInTheDocument();
    expect(screen.getByText(text.inputs)).toBeInTheDocument();
    expect(screen.getByText(text.cta)).toBeInTheDocument();
  });

  it("is a preview only: no link, button or form control", () => {
    render(<CostResultCard result={result} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("follows the result it is given", () => {
    render(
      <CostResultCard
        result={calculateCost({ ...DEFAULT_INPUTS, currency: "GBP" })}
      />,
    );

    expect(screen.getByText("£4,800 a year")).toBeInTheDocument();
  });
});
