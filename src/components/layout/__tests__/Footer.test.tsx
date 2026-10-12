import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Footer from "../Footer";
import { OPEN_COOKIE_SETTINGS_EVENT } from "@/lib/analytics/google-analytics/gtag";

describe("Footer", () => {
  it("links the public installation guide", () => {
    render(<Footer />);

    expect(
      screen.getByRole("link", { name: "Installation guide" }),
    ).toHaveAttribute("href", "/docs/install");
  });

  /**
   * s107 — "Cookie settings" reopens the analytics consent banner from every
   * marketing page. It exists only when Google Analytics is configured: with
   * no analytics there is nothing to set.
   */
  describe("Cookie settings", () => {
    const saved = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

    afterEach(() => {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
      else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = saved;
    });

    it("is a button in the Legal column that reopens the banner", async () => {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
      const user = userEvent.setup();
      const opened = jest.fn();
      window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, opened);
      render(<Footer />);

      const button = screen.getByRole("button", { name: "Cookie settings" });
      expect(button.closest("ul")?.textContent).toContain("Privacy Policy");
      await user.click(button);

      expect(opened).toHaveBeenCalledTimes(1);
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, opened);
    });

    it("is absent when Google Analytics is not configured", () => {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
      render(<Footer />);

      expect(
        screen.queryByRole("button", { name: "Cookie settings" }),
      ).toBeNull();
    });
  });
});
