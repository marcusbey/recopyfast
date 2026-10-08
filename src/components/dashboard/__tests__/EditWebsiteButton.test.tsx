import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditWebsiteButton from "../EditWebsiteButton";

/**
 * s66c1 AC 4 — "Edit website" on the design system.
 *
 * The owner's screenshot (2026-10-08) showed the card's pill-shaped button
 * inside an "Edit Website" dialog that said one sentence and offered the same
 * button again. The button was a raw <button> with its own `rounded-lg`
 * classes, opened the tab only after `await` (so pop-up blockers caught it),
 * and announced success by injecting an emerald `innerHTML` toast into
 * <body>. It is now the `Button` primitive over `useEditSession`, and the new
 * tab is the only feedback a success needs.
 */

const site = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  domain: "acme.example",
  name: "Acme marketing site",
};

const popup = {
  opener: {} as Window | null,
  location: { href: "" },
  close: jest.fn(),
};

describe("EditWebsiteButton", () => {
  beforeEach(() => {
    popup.opener = {} as Window;
    popup.location.href = "";
    popup.close.mockReset();
    jest.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ editUrl: "https://acme.example/?rcf_edit_token=t" }),
    }) as jest.MockedFunction<typeof fetch>;
  });

  afterEach(() => jest.restoreAllMocks());

  it("is the Button primitive, square, labelled Edit website", () => {
    render(
      <EditWebsiteButton site={site} userPermissions={["edit", "admin"]} />,
    );

    const button = screen.getByRole("button", { name: "Edit website" });
    expect(button).toHaveClass("rounded-control");
    expect(button.className).not.toMatch(/\brounded-(lg|md|full|xl)\b/);
    // The raw button's own focus treatment; the primitive uses focus-visible.
    expect(button.className).not.toMatch(/(^|\s)focus:ring/);
  });

  it("shows a spinner while the session starts, and keeps its label", async () => {
    let resolveRequest!: (value: Response) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    ) as jest.MockedFunction<typeof fetch>;
    const user = userEvent.setup();
    render(
      <EditWebsiteButton site={site} userPermissions={["edit", "admin"]} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit website" }));

    const pending = screen.getByRole("button", { name: "Edit website" });
    expect(pending).toBeDisabled();
    expect(pending.querySelector("svg.animate-spin")).not.toBeNull();

    resolveRequest({
      ok: true,
      json: async () => ({ editUrl: "https://acme.example/edit" }),
    } as Response);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit website" }),
      ).toBeEnabled(),
    );
  });

  it("starts an owner session: edit and admin, for two hours", async () => {
    const user = userEvent.setup();
    render(
      <EditWebsiteButton site={site} userPermissions={["edit", "admin"]} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit website" }));

    await waitFor(() =>
      expect(popup.location.href).toBe(
        "https://acme.example/?rcf_edit_token=t",
      ),
    );
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/edit-sessions/create");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      siteId: site.id,
      permissions: ["edit", "admin"],
      durationHours: 2,
    });
  });

  it("injects nothing into the page on success: the new tab is the feedback", async () => {
    const user = userEvent.setup();
    render(
      <EditWebsiteButton site={site} userPermissions={["edit", "admin"]} />,
    );
    const bodyChildren = document.body.childElementCount;

    await user.click(screen.getByRole("button", { name: "Edit website" }));

    await waitFor(() =>
      expect(popup.location.href).toBe(
        "https://acme.example/?rcf_edit_token=t",
      ),
    );
    expect(document.body.childElementCount).toBe(bodyChildren);
    expect(screen.queryByText(/session created/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a failure inline, as an alert under the control", async () => {
    (window.open as jest.Mock).mockReturnValue(null);
    const user = userEvent.setup();
    render(
      <EditWebsiteButton site={site} userPermissions={["edit", "admin"]} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit website" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Allow pop-ups for ReCopyFast, then try again.",
    );
  });

  it("offers nothing to a view-only member", () => {
    render(<EditWebsiteButton site={site} userPermissions={["view"]} />);

    expect(screen.getByRole("button", { name: "Edit website" })).toBeDisabled();
  });
});
