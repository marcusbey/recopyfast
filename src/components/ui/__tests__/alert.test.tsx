/** `Alert` — square from s66a (ADR 050: containers use the 0 radius). */

import { render, screen } from "@testing-library/react";
import { Alert, AlertDescription } from "@/components/ui/alert";

describe("Alert", () => {
  it.each(["default", "info", "success", "warning", "destructive"] as const)(
    "is a square container in the %s variant",
    (variant) => {
      render(
        <Alert variant={variant}>
          <AlertDescription>Saved.</AlertDescription>
        </Alert>,
      );

      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("rounded-container", "border");
      expect(alert.className).not.toMatch(/rounded-(sm|md|lg|xl)/);
    },
  );
});
