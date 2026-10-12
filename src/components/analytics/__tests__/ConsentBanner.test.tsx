/**
 * s107 — the banner on its own: who may dismiss it.
 *
 * Independent review F6/M21: through the runtime, an Escape that wrongly
 * dismissed the first-visit banner changed nothing visible (the runtime keeps
 * it up while consent is needed and no choice is stored), so no test there can
 * catch it. Here the banner's own contract is pinned: with no choice in
 * effect, nothing dismisses it but an answer.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";
import type { ConsentChoice } from "@/lib/analytics/google-analytics/consent";

function renderBanner(currentChoice: ConsentChoice | null) {
  const onChoose = jest.fn();
  const onDismiss = jest.fn();
  render(
    <ConsentBanner
      currentChoice={currentChoice}
      shouldTakeFocus={false}
      onChoose={onChoose}
      onDismiss={onDismiss}
    />,
  );
  return { onChoose, onDismiss };
}

describe("ConsentBanner", () => {
  it("with no choice in effect: no close button, and Escape from inside it does not dismiss", async () => {
    const user = userEvent.setup();
    const { onChoose, onDismiss } = renderBanner(null);

    expect(
      screen.queryByRole("button", { name: "Close cookie settings" }),
    ).toBeNull();
    screen.getByRole("button", { name: "Decline" }).focus();
    await user.keyboard("{Escape}");

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it.each(["granted", "denied"] as const)(
    "with %s in effect: Escape from inside it and the close button dismiss, choosing nothing",
    async (choice) => {
      const user = userEvent.setup();
      const { onChoose, onDismiss } = renderBanner(choice);

      screen.getByRole("button", { name: "Allow analytics" }).focus();
      await user.keyboard("{Escape}");
      await user.click(
        screen.getByRole("button", { name: "Close cookie settings" }),
      );

      expect(onDismiss).toHaveBeenCalledTimes(2);
      expect(onChoose).not.toHaveBeenCalled();
    },
  );

  it.each([
    [null, /May we use Google Analytics/, "false", "false"],
    ["granted", /Google Analytics is on/, "true", "false"],
    ["denied", /Google Analytics is off/, "false", "true"],
  ] as const)(
    "with %s in effect: says so, and presses the matching answer",
    (choice, description, allowPressed, declinePressed) => {
      renderBanner(choice);

      expect(
        screen.getByRole("region", { name: "Analytics cookies" }),
      ).toHaveAccessibleDescription(description);
      expect(
        screen.getByRole("button", { name: "Allow analytics" }),
      ).toHaveAttribute("aria-pressed", allowPressed);
      expect(screen.getByRole("button", { name: "Decline" })).toHaveAttribute(
        "aria-pressed",
        declinePressed,
      );
    },
  );
});
