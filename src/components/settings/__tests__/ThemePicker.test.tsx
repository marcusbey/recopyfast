import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemePicker } from "../ThemePicker";
import { THEME_STORAGE_KEY } from "@/hooks/useTheme";

/**
 * s66b2 review, major 2. The theme options are controls, so their 1px
 * boundary is `border-input` (`--line-strong`, 3.09:1 dark, 3.27:1 light on
 * the card), with the Input's hover `border-foreground/40`: the option
 * toggle of the design system (Controls; Borders). s66b2 shipped them on
 * `border-border`, the decorative `--line` at 1.45:1, which is the strength
 * of a divider, not of something you can press. Selected keeps the accent
 * border, the accent surface and the tick, never a thicker border.
 */
describe("ThemePicker option boundaries", () => {
  beforeEach(() => {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    delete document.documentElement.dataset.theme;
  });

  const options = () =>
    within(screen.getByRole("radiogroup", { name: "Theme" })).getAllByRole(
      "radio",
    );

  it("draws every unselected option at control strength, never decorative", () => {
    render(<ThemePicker />);

    const unselected = options().filter(
      (option) => option.getAttribute("aria-checked") === "false",
    );
    expect(unselected).toHaveLength(2);
    for (const option of unselected) {
      expect(option).toHaveClass(
        "border",
        "border-input",
        "hover:border-foreground/40",
      );
      expect(option).not.toHaveClass("border-border");
      expect(option).not.toHaveClass("border-2");
    }
  });

  it("marks the selection with the accent border and surface, still 1px", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    await user.click(screen.getByRole("radio", { name: /Dark/ }));

    const selected = screen.getByRole("radio", { checked: true });
    expect(selected).toHaveAccessibleName(/Dark/);
    expect(selected).toHaveClass(
      "border",
      "border-primary",
      "bg-tone-accent-surface",
    );
    expect(selected).not.toHaveClass("border-input");
    expect(selected).not.toHaveClass("border-2");
    for (const option of options().filter((option) => option !== selected)) {
      expect(option).toHaveClass("border-input");
    }
  });
});
