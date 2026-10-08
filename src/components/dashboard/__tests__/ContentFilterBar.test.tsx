/**
 * @jest-environment jsdom
 *
 * s66b design §4 (Content): the filter row wraps, search takes what is left,
 * and the site and status selects sit at their content width from 640px up
 * and full width below it (s66b1 review m-7).
 *
 * Below 640 they kept their content width: on a phone the two selects sat
 * side by side under the search, each as wide as its longest option, with a
 * ragged right edge that lined up with nothing. jsdom computes no layout, so
 * the classes are what can be pinned here; the layout harness measures the
 * page they sit on.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { ContentFilterBar } from "../ContentFilterBar";

afterEach(() => {
  cleanup();
});

function renderFilterBar(): void {
  render(
    <ContentFilterBar
      searchQuery=""
      onSearchChange={() => {}}
      selectedSiteId={null}
      onSiteChange={() => {}}
      selectedStatus="all"
      onStatusChange={() => {}}
      sites={[{ id: "site-a", name: "Acme", domain: "acme.example" }]}
    />,
  );
}

/** The select's cell in the wrapping row: the row's direct child holding it. */
function filterCell(label: string): HTMLElement {
  const select = screen.getByLabelText(label);
  let cell: HTMLElement | null = select;
  while (
    cell?.parentElement &&
    !cell.parentElement.classList.contains("flex-wrap")
  ) {
    cell = cell.parentElement;
  }
  if (!cell?.parentElement) throw new Error(`No filter row around "${label}".`);
  return cell;
}

describe("ContentFilterBar", () => {
  it.each(["Filter by site", "Filter by status"])(
    "draws %s full width below 640 and at its content width above",
    (label) => {
      renderFilterBar();

      const cell = filterCell(label);
      expect(cell).toHaveClass("w-full", "sm:w-auto");
    },
  );

  it("lets the search take what is left, never below 12rem", () => {
    renderFilterBar();

    expect(filterCell("Search content")).toHaveClass("flex-1", "min-w-[12rem]");
  });
});
