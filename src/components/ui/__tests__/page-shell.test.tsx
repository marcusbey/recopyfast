/**
 * @jest-environment jsdom
 *
 * s66b1 AC 1 — the page frame's contract (ADR 053).
 *
 * Before `PageShell`, every app page titled itself, and four title styles grew
 * beside a `PageHeader` nobody had to use. s66c builds its site pages on this
 * component, so what it renders is a contract, not a habit: one h1 in
 * `.text-page-title`, the slots in a fixed reading order, and the page's
 * sections as direct children of `[data-page-shell]` — the selector the layout
 * harness measures "one left edge" on.
 *
 * jsdom computes no layout, so where the actions are drawn (on the title row
 * at ≥640, below the description under it) is the harness's to prove. What
 * this file proves is the order a screen reader meets them in.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { PageShell } from "../page-shell";

afterEach(() => {
  cleanup();
});

const follows = (earlier: Node, later: Node) =>
  Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

function renderEverySlot() {
  render(
    <PageShell
      eyebrow="Overview"
      title="Welcome back, Ada"
      meta={<span>Trial · 9 days</span>}
      description={
        <>
          Every site you have connected, on{" "}
          <a href="https://example.com">example.com</a>
        </>
      }
      actions={<button type="button">Add site</button>}
      nav={<nav aria-label="Site sections">Overview · Install</nav>}
    >
      <section aria-label="Summary">Metrics</section>
      <section aria-label="Your sites">Rows</section>
    </PageShell>,
  );

  const shell = document.querySelector("[data-page-shell]");
  const header = document.querySelector("[data-page-header]");
  if (!shell || !header) throw new Error("PageShell rendered no frame.");
  return { shell, header };
}

describe("PageShell", () => {
  it("renders exactly one h1, in .text-page-title, inside header[data-page-header]", () => {
    const { header } = renderEverySlot();

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Welcome back, Ada");
    expect(headings[0]).toHaveClass("text-page-title");
    expect(header.tagName).toBe("HEADER");
    expect(header).toContainElement(headings[0]);
  });

  it("renders every slot, read as title, meta, description, actions, then nav", () => {
    const { shell, header } = renderEverySlot();

    const eyebrow = screen.getByText("Overview");
    const title = screen.getByRole("heading", { level: 1 });
    const meta = screen.getByText("Trial · 9 days");
    const description = screen.getByText(/Every site you have connected/);
    const link = screen.getByRole("link", { name: "example.com" });
    const action = screen.getByRole("button", { name: "Add site" });
    const nav = screen.getByRole("navigation", { name: "Site sections" });

    for (const slot of [eyebrow, meta, description, action]) {
      expect(header).toContainElement(slot);
    }
    // `description` is a ReactNode: s66c puts the site's domain there as a link.
    expect(description).toContainElement(link);
    // `meta` sits inline after the h1, on the title's own row.
    expect(title.parentElement).toContainElement(meta);

    expect(follows(eyebrow, title)).toBe(true);
    expect(follows(title, meta)).toBe(true);
    expect(follows(meta, description)).toBe(true);
    // After the description in DOM order, wherever they are drawn: a screen
    // reader hears what the page is before what it can do.
    expect(follows(description, action)).toBe(true);

    expect(header).not.toContainElement(nav);
    expect(follows(header, nav)).toBe(true);
    expect(nav.parentElement).toBe(shell);
  });

  it("puts the page's sections directly under [data-page-shell]", () => {
    const { shell, header } = renderEverySlot();

    expect(header.parentElement).toBe(shell);
    expect(shell.firstElementChild).toBe(header);
    expect(screen.getByRole("region", { name: "Summary" }).parentElement).toBe(
      shell,
    );
    expect(
      screen.getByRole("region", { name: "Your sites" }).parentElement,
    ).toBe(shell);
  });

  it("renders no empty wrapper for a slot that is not set", () => {
    render(<PageShell title="Content" />);

    const shell = document.querySelector("[data-page-shell]");
    expect(shell).not.toBeNull();
    // The header and nothing else: no nav wrapper, no section.
    expect(shell?.children).toHaveLength(1);
    const empty = Array.from(shell?.querySelectorAll("*") ?? []).filter(
      (element) => element.textContent === "",
    );
    expect(empty).toEqual([]);
    expect(
      screen.getByRole("heading", { level: 1, name: "Content" }),
    ).toBeInTheDocument();
  });
});
