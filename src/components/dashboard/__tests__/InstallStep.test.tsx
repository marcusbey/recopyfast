import { render, screen, within } from "@testing-library/react";
import { InstallStep } from "../InstallStep";

/**
 * s66c2 Task 1 — the square numbered marker of the site-registered panel,
 * extracted so the quick setup's stepper can reuse it (design § Site
 * Overview; design-system gap 14: there is no stepper primitive, and this
 * stays dashboard-local with its two consumers).
 *
 * The registration panel draws its three steps with no state: they are
 * instructions, not progress. The quick setup draws the same marker in three
 * states, and only there.
 */

function renderStep(
  state: React.ComponentProps<typeof InstallStep>["state"],
  number = 2,
) {
  render(
    <ol>
      <InstallStep number={number} title="Install the snippet" state={state}>
        <p>Step body</p>
      </InstallStep>
    </ol>,
  );
  return screen.getByRole("listitem");
}

describe("InstallStep", () => {
  it("draws a done step as a tick in the success tone, not its number", () => {
    const step = renderStep("done");

    expect(within(step).queryByText("2")).not.toBeInTheDocument();
    const marker = step.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(marker.querySelector("svg")).not.toBeNull();
    expect(marker).toHaveClass(
      "border-tone-success-border",
      "bg-tone-success-surface",
      "text-tone-success-text",
    );
    // The tick is decorative: the state is said in words as well.
    expect(within(step).getByText("Done")).toHaveClass("sr-only");
    expect(step).not.toHaveAttribute("aria-current");
  });

  it("draws the current step as its number with the accent border", () => {
    const step = renderStep("current");

    const marker = within(step).getByText("2");
    expect(marker).toHaveClass("border-primary", "text-foreground");
    expect(marker.querySelector("svg")).toBeNull();
    expect(step).toHaveAttribute("aria-current", "step");
    expect(
      screen.getByRole("heading", { name: "Install the snippet" }),
    ).toBeInTheDocument();
  });

  it("draws a next step as its number, muted", () => {
    const step = renderStep("next", 3);

    const marker = within(step).getByText("3");
    expect(marker).toHaveClass("border-border", "text-muted-foreground");
    expect(marker).not.toHaveClass("border-primary");
    expect(step).not.toHaveAttribute("aria-current");
    expect(within(step).queryByText("Done")).not.toBeInTheDocument();
  });

  // The registration panel's look, unchanged by the extraction.
  it("keeps the registration panel's plain marker when it has no state", () => {
    const step = renderStep(undefined, 1);

    const marker = within(step).getByText("1");
    expect(marker).toHaveClass(
      "rounded-container",
      "border-border",
      "bg-surface-1",
      "text-foreground",
    );
    expect(marker).not.toHaveClass("border-primary", "text-muted-foreground");
    expect(step).not.toHaveAttribute("aria-current");
    expect(within(step).getByText("Step body")).toBeInTheDocument();
  });
});
