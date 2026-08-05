/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareSiteDialog } from "../ShareSiteDialog";
import type { Site } from "@/types";
import "@testing-library/jest-dom";

global.fetch = jest.fn();

const mockSite: Site = {
  id: "site-1",
  domain: "example.com",
  name: "Example Site",
  api_key: "test-api-key",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

/**
 * The dialog fetches its active-share list on open and shows a spinner until it
 * settles; leaving that in flight makes every later query race the state update.
 */
const mockActiveLinksFetch = () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, accessList: [] }),
  });
};

const renderDialog = async () => {
  const user = userEvent.setup();
  render(<ShareSiteDialog open onOpenChange={jest.fn()} site={mockSite} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  return user;
};

const permissionsGroup = () =>
  screen.getByRole("group", { name: "Permissions" });

const permission = (name: string) =>
  within(permissionsGroup()).getByRole("checkbox", { name });

/**
 * WCAG 1.4.1 — selection must not be signalled by colour alone. A granted
 * option renders a tick alongside its permission icon, so it carries one more
 * glyph than a withheld one. Counting them proves the non-chromatic signal
 * exists without asserting on the colour classes themselves.
 */
const glyphCount = (option: HTMLElement) =>
  option.querySelectorAll("svg").length;

describe("ShareSiteDialog permission toggles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveLinksFetch();
  });

  it("exposes the permissions as a named group of checkboxes", async () => {
    await renderDialog();

    const options = within(permissionsGroup()).getAllByRole("checkbox");

    expect(options.map((option) => option.textContent)).toEqual([
      "View",
      "Edit",
      "Publish",
      "Admin",
    ]);
  });

  it("announces which permissions are granted, not just colours them", async () => {
    await renderDialog();

    // view + edit is the default grant the dialog submits.
    expect(permission("View")).toBeChecked();
    expect(permission("Edit")).toBeChecked();
    expect(permission("Publish")).not.toBeChecked();
    expect(permission("Admin")).not.toBeChecked();

    expect(glyphCount(permission("View"))).toBeGreaterThan(
      glyphCount(permission("Publish")),
    );
  });

  it("updates aria-checked when an option is clicked", async () => {
    const user = await renderDialog();

    await user.click(permission("Publish"));
    expect(permission("Publish")).toBeChecked();

    await user.click(permission("View"));
    expect(permission("View")).not.toBeChecked();
  });

  it("is operable from the keyboard alone", async () => {
    const user = await renderDialog();

    // Each option keeps its place in the tab order — a checkbox group needs no
    // roving tabindex — and Space is the activation key ARIA specifies for it.
    permission("Admin").focus();
    await user.keyboard(" ");
    expect(permission("Admin")).toBeChecked();

    await user.keyboard(" ");
    expect(permission("Admin")).not.toBeChecked();
  });

  it("keeps every granted permission checked at once", async () => {
    const user = await renderDialog();

    // Radio semantics would have cleared View and Edit here; the group has to
    // stay multi-select because that is what the invite request sends.
    await user.click(permission("Publish"));
    await user.click(permission("Admin"));

    expect(permission("View")).toBeChecked();
    expect(permission("Edit")).toBeChecked();
    expect(permission("Publish")).toBeChecked();
    expect(permission("Admin")).toBeChecked();
  });

  it("labels the expiry control and exposes its current value", async () => {
    await renderDialog();

    // A native <select> already reports name, role and value, so this group of
    // F-15 needs no custom widget — this pins that it stays a real select.
    const expiry = screen.getByLabelText("Expires in");
    expect(expiry).toHaveValue("7");
    expect(
      within(expiry).getByRole("option", { name: "7 days" }),
    ).toBeInTheDocument();
  });
});
