/**
 * `IconTile` — the square container an icon sits in (s66a). It replaces the
 * circles around icons, which are not a radius exception (ADR 050).
 */

import { render } from "@testing-library/react";
import { IconTile } from "@/components/ui/icon-tile";

describe("IconTile", () => {
  it.each(["sm", "default", "lg"] as const)("is square at size %s", (size) => {
    const { container } = render(
      <IconTile size={size}>
        <svg />
      </IconTile>,
    );

    const tile = container.firstElementChild as HTMLElement;
    expect(tile).toHaveClass("rounded-container");
    expect(tile.className).not.toMatch(/rounded-(sm|md|lg|xl|full)/);
    expect(tile).toHaveAttribute("aria-hidden", "true");
  });
});
