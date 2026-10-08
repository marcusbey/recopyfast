import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewLinksList } from "../PreviewLinksList";

/**
 * s66c1 AC 6 — a site's preview links, listed on People & access.
 *
 * They lived inside the Share dialog, under the form, so the only way to see
 * who could review a site was to start creating another link. The list moved
 * onto the page with its two calls (`GET` and `DELETE /api/staging/access`),
 * and the dialog is create-only.
 */

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const day = 24 * 60 * 60 * 1000;

const pending = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "invite",
  email: "reviewer.pending@example.com",
  emailVerified: false,
  permissions: ["view"],
  label: "Homepage review",
  expiresAt: new Date(Date.now() + 6 * day).toISOString(),
  isActive: true,
  lastUsedAt: null,
  createdAt: new Date(Date.now() - day).toISOString(),
};

const verified = {
  ...pending,
  id: "22222222-2222-4222-8222-222222222222",
  email: "reviewer.done@example.com",
  emailVerified: true,
  label: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = jest.fn();
const writeText = jest.fn();

function renderList() {
  return render(<PreviewLinksList siteId={SITE_ID} />);
}

describe("PreviewLinksList", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("lists the site's links from GET /api/staging/access, with a count", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, accessList: [pending, verified] }),
    );

    renderList();

    expect(await screen.findByText("Homepage review")).toBeInTheDocument();
    expect(screen.getByText(verified.email)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staging/access?siteId=${SITE_ID}`,
    );
    expect(
      screen.getByRole("heading", { name: "Preview links · 2" }),
    ).toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, accessList: [] }),
    );

    renderList();

    expect(
      await screen.findByText(
        "No preview links. Share one when you want a review before you publish.",
      ),
    ).toBeInTheDocument();
  });

  it("tells a member who is not an admin they cannot manage links", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Admin permission required" }, 403),
    );

    renderList();

    expect(
      await screen.findByText("You cannot manage preview links on this site."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  // A failed fetch is never an empty list (AGENTS.md § React): "no preview
  // links" would tell the owner nobody can review the site.
  it("shows a failure as an error with Try again, never as empty", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: "Internal server error" }, 500),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, accessList: [pending] }),
      );

    renderList();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Internal server error");
    expect(screen.queryByText(/No preview links/)).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Homepage review")).toBeInTheDocument();
  });

  it("revokes a link with DELETE and drops its row", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ success: true, accessList: [pending, verified] }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    renderList();
    await screen.findByText("Homepage review");

    await user.click(
      screen.getAllByRole("button", { name: "Revoke this share" })[0],
    );

    await waitFor(() =>
      expect(screen.queryByText("Homepage review")).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/staging/access?accessId=${pending.id}`,
      { method: "DELETE" },
    );
    expect(screen.getByText(verified.email)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Preview links · 1" }),
    ).toBeInTheDocument();
  });

  // The dialog's old revoke swallowed a refusal into the console: the row
  // stayed, and nothing said the link still worked.
  it("says so when a revoke fails, and keeps the row", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ success: true, accessList: [pending] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "Failed to revoke access" }, 500),
      );

    renderList();
    await screen.findByText("Homepage review");

    await user.click(screen.getByRole("button", { name: "Revoke this share" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to revoke access",
    );
    expect(screen.getByText("Homepage review")).toBeInTheDocument();
  });

  /**
   * PR #72 review (D2). `GET /api/staging/access` leaves each link's secret
   * token out, deliberately: a list response is not where secrets go. The
   * copy action fell back to the row id (`rcf_token=<id>`), so every link
   * copied from this list opened a preview that refused it. The old Share
   * dialog's list had the same fallback on main. A link is copied when it is
   * created, from the creation response; the list says so and offers no
   * copy of its own.
   */
  it("offers no copy that would build a link from a row id, and says where to copy one", async () => {
    const user = userEvent.setup();
    const clipboardWrite = jest.spyOn(navigator.clipboard, "writeText");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, accessList: [pending, verified] }),
    );

    renderList();
    await screen.findByText("Homepage review");

    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();
    for (const button of within(screen.getByRole("list")).getAllByRole(
      "button",
    )) {
      if (button.getAttribute("aria-label") === "Revoke this share") continue;
      await user.click(button);
    }
    for (const [written] of clipboardWrite.mock.calls) {
      expect(String(written)).not.toContain(pending.id);
      expect(String(written)).not.toContain(verified.id);
    }
    expect(
      screen.getByText(
        "Copy a link when you create it: this list cannot show it again. Lost one? Revoke it and share a new one.",
      ),
    ).toBeInTheDocument();
  });
});
