/**
 * `ShareLinkCard` — s66a, design § 2.
 *
 * At 375 px the Share preview link dialog grew a horizontal scrollbar and
 * clipped its content. The cause was this card: its row could not shrink
 * inside the dialog's grid track (s66 research, fact 1). It is fixed twice:
 * by DialogBody's `min-w-0` children, and here, where a long label truncates
 * and the meta and permission rows wrap instead of pushing.
 */

import { render, screen } from "@testing-library/react";
import { ShareLinkCard, type ShareLink } from "../ShareLinkCard";

const LONG_LABEL =
  "Client review: homepage hero, pricing table and footer copy";

const link: ShareLink = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "invite",
  email: "reviewer.pending@example.com",
  emailVerified: false,
  permissions: ["view", "edit", "publish", "admin"],
  label: LONG_LABEL,
  expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
  isActive: true,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
};

function renderCard() {
  return render(
    <ShareLinkCard link={link} onCopy={jest.fn()} onRevoke={jest.fn()} />,
  );
}

describe("ShareLinkCard", () => {
  it("truncates the label inside a column that can shrink", () => {
    renderCard();
    const label = screen.getByText(LONG_LABEL);
    expect(label).toHaveClass("truncate");
    expect(label.parentElement).toHaveClass("min-w-0");
  });

  it("wraps the meta row and the permission row instead of pushing", () => {
    renderCard();
    expect(screen.getByText(/^Expires /).parentElement).toHaveClass(
      "flex-wrap",
    );
    expect(screen.getByText("Admin").parentElement).toHaveClass("flex-wrap");
  });

  it("puts the icon in a square tile, not a circle", () => {
    const { container } = renderCard();
    const tile = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(tile.querySelector("svg")).not.toBeNull();
    expect(tile.className).not.toContain("rounded-full");
    expect(tile).toHaveClass("rounded-container");
  });

  it("keeps the Copy and Revoke names", () => {
    renderCard();
    expect(
      screen.getByRole("button", { name: "Copy share link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revoke this share" }),
    ).toBeInTheDocument();
  });
});
