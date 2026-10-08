/**
 * @jest-environment jsdom
 */
import { useState } from "react";
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
 * s66c1: the dialog is create-only — the active links moved onto People &
 * access (PreviewLinksList) — so it no longer fetches on open, and a test
 * waits for its form instead of a list request. Any request now is a create.
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
  await screen.findByLabelText("Email address");
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

    // s66c1 AC 6: a preview link is view-only unless the owner allows more.
    expect(permission("View")).toBeChecked();
    expect(permission("Edit")).not.toBeChecked();
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
    await user.click(permission("Edit"));
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

/**
 * s66a, design § 2. The dialog overflowed at 375 px and its "Expires in"
 * select drew the browser chevron against the border (the owner's second
 * screenshot). The layout is proved in a real browser by
 * e2e/app-layout.spec.ts; these pin the copy and the classes that carry it.
 */
describe("ShareSiteDialog (s66a)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveLinksFetch();
  });

  it("is titled in sentence case, and creates with Create link", async () => {
    await renderDialog();
    expect(
      screen.getByRole("heading", { name: "Share preview link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create link" }),
    ).toBeInTheDocument();
  });

  it("draws the permission toggles with a 1px border", async () => {
    await renderDialog();
    for (const option of within(permissionsGroup()).getAllByRole("checkbox")) {
      expect(option.className).not.toContain("border-2");
      expect(option).toHaveClass("rounded-control");
    }
  });

  it("marks a granted toggle with the accent border", async () => {
    await renderDialog();
    expect(permission("View")).toHaveClass("border-primary");
    expect(permission("Publish")).not.toHaveClass("border-primary");
  });

  it("reports feedback through Alert", async () => {
    const user = await renderDialog();
    await user.click(screen.getByRole("button", { name: "Create link" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email is required for email invites");
    expect(alert).toHaveClass("rounded-container");
  });
});

/**
 * s66c1 AC 6 — one of the two ways to give someone access, and it says which.
 */
describe("ShareSiteDialog (s66c1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveLinksFetch();
  });

  it("describes itself in the ONE-OFF REVIEW words", async () => {
    await renderDialog();

    expect(
      screen.getByText(
        "For a one-off review of unpublished changes. View only unless you allow more, and the link stops working after the time you choose.",
      ),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the grant chosen, then resets it to view only", async () => {
    const onCreated = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, emailDelivered: true }),
    });
    const user = userEvent.setup();
    render(
      <ShareSiteDialog
        open
        onOpenChange={jest.fn()}
        site={mockSite}
        onCreated={onCreated}
      />,
    );

    await user.type(
      await screen.findByLabelText("Email address"),
      "reviewer@example.com",
    );
    await user.click(permission("Edit"));
    await user.click(screen.getByRole("button", { name: "Create link" }));

    expect(
      await screen.findByText("Invite sent successfully!"),
    ).toBeInTheDocument();
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(
      JSON.parse((init as RequestInit).body as string).permissions,
    ).toEqual(["view", "edit"]);
    expect(permission("View")).toBeChecked();
    expect(permission("Edit")).not.toBeChecked();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("links a sent invite to the site's preview links when asked to", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, emailDelivered: true }),
    });
    const user = userEvent.setup();
    render(
      <ShareSiteDialog
        open
        onOpenChange={jest.fn()}
        site={mockSite}
        manageHref="/dashboard/sites/site-1/people"
      />,
    );

    await user.type(
      await screen.findByLabelText("Email address"),
      "reviewer@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Create link" }));

    expect(
      await screen.findByRole("link", { name: "See preview links" }),
    ).toHaveAttribute("href", "/dashboard/sites/site-1/people");
  });
});

/**
 * s66c1 review m4. People & access keeps this dialog mounted and only flips
 * `open`, so whatever the last opening left behind (a refusal, a success
 * banner, a half-typed address) used to be waiting in the next one. Each
 * opening starts on an empty form with no message, as AddEditorDialog does.
 */
describe("ShareSiteDialog reopened", () => {
  function ReopenableDialog() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open share dialog
        </button>
        <ShareSiteDialog open={open} onOpenChange={setOpen} site={mockSite} />
      </>
    );
  }

  const closeAndReopen = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Open share dialog" }));
    return screen.findByRole("dialog");
  };

  const expectEmptyForm = (dialog: HTMLElement) => {
    expect(within(dialog).getByLabelText("Email address")).toHaveValue("");
    expect(within(dialog).getByLabelText("Label (optional)")).toHaveValue("");
    expect(within(dialog).getByLabelText("Expires in")).toHaveValue("7");
    expect(permission("View")).toBeChecked();
    expect(permission("Edit")).not.toBeChecked();
    expect(permission("Publish")).not.toBeChecked();
    expect(permission("Admin")).not.toBeChecked();
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows no error from the last opening, on an empty form", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This address was removed as an editor." }),
    });
    const user = userEvent.setup();
    render(<ReopenableDialog />);

    await user.type(
      await screen.findByLabelText("Email address"),
      "reviewer@example.com",
    );
    await user.selectOptions(screen.getByLabelText("Expires in"), "30");
    await user.click(screen.getByRole("button", { name: "Create link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This address was removed as an editor.",
    );

    const dialog = await closeAndReopen(user);

    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("This address was removed as an editor."),
    ).not.toBeInTheDocument();
    expectEmptyForm(dialog);
  });

  it("shows no success banner from the last opening, on an empty form", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, emailDelivered: true }),
    });
    const user = userEvent.setup();
    render(<ReopenableDialog />);

    await user.type(
      await screen.findByLabelText("Email address"),
      "reviewer@example.com",
    );
    await user.selectOptions(screen.getByLabelText("Expires in"), "30");
    await user.click(screen.getByRole("button", { name: "Create link" }));
    expect(
      await screen.findByText("Invite sent successfully!"),
    ).toBeInTheDocument();

    const dialog = await closeAndReopen(user);

    expect(
      within(dialog).queryByText("Invite sent successfully!"),
    ).not.toBeInTheDocument();
    expectEmptyForm(dialog);
  });
});
