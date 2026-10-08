/**
 * `DropdownMenu` — opaque and square from s66a.
 *
 * `bg-popover` had no theme token before s66a, so every menu was transparent:
 * the Sites sort menu printed its items over the site cards (s66 research,
 * fact 4b). The token lives in globals.css (pinned by globals-css.test.ts);
 * this pins that the menu asks for it, at the container radius, floating.
 */

import { render, screen } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function renderOpenMenu() {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Sort</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Sort by name</DropdownMenuItem>
        <DropdownMenuItem>Sort by date added</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe("DropdownMenu", () => {
  it("is an opaque, square, floating surface", () => {
    renderOpenMenu();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass(
      "bg-popover",
      "text-popover-foreground",
      "rounded-container",
      "border",
      "shadow-md",
    );
    expect(menu.className).not.toMatch(/rounded-(sm|md|lg|xl)/);
  });

  it("draws items at the control radius", () => {
    renderOpenMenu();
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveClass("rounded-control");
      expect(item.className).not.toMatch(/rounded-(sm|md|lg|xl)/);
    }
  });
});
