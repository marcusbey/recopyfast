import React from "react";
import { render, screen } from "@testing-library/react";
import SpotMeter from "../SpotMeter";

function cells(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-state]"));
}

function countState(container: HTMLElement, state: string) {
  return cells(container).filter((cell) => cell.dataset.state === state).length;
}

describe("SpotMeter", () => {
  it("is one image named by its label, its cells hidden from assistive tech", () => {
    const { container } = render(
      <SpotMeter limit={50} remaining={17} label="17 of 50 spots left" />,
    );

    const meter = screen.getByRole("img", { name: "17 of 50 spots left" });
    expect(meter).toBeInTheDocument();
    expect(cells(container)).toHaveLength(50);
    expect(
      cells(container).every(
        (cell) =>
          cell.getAttribute("aria-hidden") === "true" && meter.contains(cell),
      ),
    ).toBe(true);
  });

  it("draws the taken spots, then the next one, then the rest", () => {
    const { container } = render(
      <SpotMeter limit={50} remaining={17} label="17 of 50 spots left" />,
    );

    expect(countState(container, "taken")).toBe(33);
    expect(countState(container, "next")).toBe(1);
    expect(countState(container, "left")).toBe(16);
    expect(cells(container)[33].dataset.state).toBe("next");
  });

  it("draws a full meter when sold out", () => {
    const { container } = render(
      <SpotMeter limit={50} remaining={0} label="0 of 50 spots left" />,
    );

    expect(countState(container, "taken")).toBe(50);
    expect(countState(container, "next")).toBe(0);
  });

  it("styles each state from the marketing palette", () => {
    const { container } = render(
      <SpotMeter limit={3} remaining={2} label="2 of 3 spots left" />,
    );

    const [taken, next, left] = cells(container);
    expect(taken).toHaveClass("bg-slate-500/45");
    expect(next).toHaveClass("bg-teal-700");
    expect(left).toHaveClass("bg-teal-700/20");
    for (const cell of [taken, next, left]) {
      expect(cell).toHaveClass("h-[18px]", "rounded-[1px]");
    }
  });

  // The meter sits in the lifetime card's right column (`min-w-56`, about
  // 224px at md and up), so a long meter is narrow at every breakpoint, not
  // only on phones.
  it("always wraps a long meter to 25 columns", () => {
    const { rerender } = render(
      <SpotMeter limit={50} remaining={50} label="50 of 50 spots left" />,
    );
    const meter = screen.getByRole("img");
    expect(meter).toHaveClass(
      "grid",
      "gap-0.5",
      "grid-cols-[repeat(25,minmax(0,1fr))]",
    );
    expect(meter.className).not.toContain("--spot-meter-columns");
    expect(meter.className).not.toMatch(/(^|\s)\w+:grid-cols-/);

    rerender(<SpotMeter limit={10} remaining={4} label="4 of 10 spots left" />);
    const short = screen.getByRole("img");
    expect(short).toHaveClass(
      "grid-cols-[repeat(var(--spot-meter-columns),minmax(0,1fr))]",
    );
    expect(short).not.toHaveClass("grid-cols-[repeat(25,minmax(0,1fr))]");
    expect(short.style.getPropertyValue("--spot-meter-columns")).toBe("10");
  });
});
