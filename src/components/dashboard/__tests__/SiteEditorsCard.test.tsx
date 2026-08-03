import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteEditorsCard } from "../SiteEditorsCard";

/**
 * These tests drive the card the way a site owner does, because the defect this
 * component fixes was never that the endpoint was wrong — it was that nothing
 * called it. A test asserting a button exists would reproduce exactly that.
 */

const SITE_ID = "site-1";
const SITE_NAME = "Client Site";

interface EditorFixture {
  id: string;
  email: string;
  permissions: string[];
  createdAt: string;
  revokedAt: string | null;
  activeDevices: number;
}

const ada: EditorFixture = {
  id: "editor-ada",
  email: "ada@clientcompany.com",
  permissions: ["view", "edit"],
  createdAt: "2026-07-01T00:00:00.000Z",
  revokedAt: null,
  activeDevices: 2,
};

const grace: EditorFixture = {
  id: "editor-grace",
  email: "grace@clientcompany.com",
  permissions: ["view", "edit"],
  createdAt: "2026-07-20T00:00:00.000Z",
  revokedAt: null,
  activeDevices: 0,
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function callsWithMethod(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === method,
  );
}

function renderCard() {
  return render(<SiteEditorsCard siteId={SITE_ID} siteName={SITE_NAME} />);
}

describe("SiteEditorsCard", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // The component logs the underlying failure before showing a human message.
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists the site's editors with their permissions and live device count", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, editors: [ada, grace] }),
    );

    renderCard();

    expect(await screen.findByText(ada.email)).toBeInTheDocument();
    expect(screen.getByText(grace.email)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/editor/editors?siteId=${SITE_ID}`,
    );

    // The device count is what a removal destroys, so it has to be visible
    // before anyone reaches for the remove button.
    expect(screen.getByText(/2 devices signed in/)).toBeInTheDocument();
    expect(screen.getByText(/No devices signed in/)).toBeInTheDocument();

    // Scoped to the list: the invite form below carries the same four labels.
    const list = screen.getByRole("list");
    expect(within(list).getAllByText("View")).toHaveLength(2);
    expect(within(list).getAllByText("Edit")).toHaveLength(2);
  });

  it("shows an empty state when nobody has been enrolled", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, editors: [] }));

    renderCard();

    expect(await screen.findByText("No editors yet")).toBeInTheDocument();
    expect(
      screen.getByText(/They open the editor hub and request a sign-in code/),
    ).toBeInTheDocument();
  });

  it("surfaces a failed load and retries it on demand", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [ada] }));

    renderCard();

    expect(
      await screen.findByText("Could not load editors"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText(ada.email)).toBeInTheDocument();
    expect(
      screen.queryByText("Could not load editors"),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("translates a server error code into something a person can act on", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "server_error" }, 500),
    );

    renderCard();

    expect(
      await screen.findByText(/Something went wrong on our end/),
    ).toBeInTheDocument();
  });

  it("enrols an editor, shows them in the list, and says no email was sent", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          editor: { id: grace.id, email: grace.email, permissions: ["view"] },
          hubUrl: "https://app.recopyfast.com/edit",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [grace] }));

    renderCard();
    await screen.findByText("No editors yet");

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    // The row is the proof the enrolment happened, not the toast.
    expect(await screen.findByText(grace.email)).toBeInTheDocument();

    const [postUrl, postInit] = callsWithMethod("POST")[0];
    expect(postUrl).toBe("/api/editor/editors");
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      siteId: SITE_ID,
      email: grace.email,
      permissions: ["view", "edit"],
    });

    // The whole point of the defect: enrolment sends nothing, and an owner who
    // believes otherwise waits for an email that will never arrive.
    expect(screen.getByText(/No invitation email is sent/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /the editor hub/i }),
    ).toHaveAttribute("href", "https://app.recopyfast.com/edit");

    // Form cleared, ready for the next address.
    expect(screen.getByLabelText(/editor email/i)).toHaveValue("");
  });

  it("sends the permissions the owner actually picked", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, editor: { email: grace.email }, hubUrl: "" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [grace] }));

    renderCard();
    await screen.findByText("No editors yet");

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    await waitFor(() => expect(callsWithMethod("POST")).toHaveLength(1));
    const [, postInit] = callsWithMethod("POST")[0];
    expect(
      JSON.parse((postInit as RequestInit).body as string).permissions,
    ).toEqual(["view", "edit", "publish"]);
  });

  it("keeps the typed address when the invite is rejected", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Rate limit exceeded",
            message: "Too many invites. Please try again shortly.",
          },
          429,
        ),
      );

    renderCard();
    await screen.findByText("No editors yet");

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many invites. Please try again shortly.",
    );
    // Retyping a rejected address is a needless punishment.
    expect(screen.getByLabelText(/editor email/i)).toHaveValue(grace.email);
    expect(screen.getByText("No editors yet")).toBeInTheDocument();
  });

  it("refuses to submit an enrolment with no permissions", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, editors: [] }));

    renderCard();
    await screen.findByText("No editors yet");

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: /add editor/i })).toBeDisabled();
    expect(callsWithMethod("POST")).toHaveLength(0);
  });

  it("warns how many devices a removal signs out before removing anyone", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [ada] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, grantsRevoked: 2 }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          editors: [
            {
              ...ada,
              revokedAt: "2026-08-01T00:00:00.000Z",
              activeDevices: 0,
            },
          ],
        }),
      );

    renderCard();
    await screen.findByText(ada.email);

    await user.click(
      screen.getByRole("button", { name: `Remove ${ada.email}` }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        /2 signed-in devices will be signed out in the same step/,
      ),
    ).toBeInTheDocument();

    // Opening the confirmation must not have destroyed anything yet.
    expect(callsWithMethod("DELETE")).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: /remove editor/i }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const [deleteUrl] = callsWithMethod("DELETE")[0];
    expect(deleteUrl).toBe(
      `/api/editor/editors?siteEditorId=${encodeURIComponent(ada.id)}`,
    );

    expect(
      await screen.findByText(/2 device sessions signed out/),
    ).toBeInTheDocument();
    // The row moves out of the live list rather than vanishing: the API keeps
    // revoked rows for audit and re-adding the address restores it.
    expect(screen.getByText("Previously removed")).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("No editors yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Remove ${ada.email}` }),
    ).not.toBeInTheDocument();
  });

  it("says so plainly when the removed editor had no devices signed in", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [grace] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, grantsRevoked: 0 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [] }));

    renderCard();
    await screen.findByText(grace.email);

    await user.click(
      screen.getByRole("button", { name: `Remove ${grace.email}` }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/They have no signed-in devices right now/),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /remove editor/i }),
    );

    expect(
      await screen.findByText(/They had no signed-in devices/),
    ).toBeInTheDocument();
  });

  it("removes nobody when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, editors: [ada] }));

    renderCard();
    await screen.findByText(ada.email);

    await user.click(
      screen.getByRole("button", { name: `Remove ${ada.email}` }),
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    expect(callsWithMethod("DELETE")).toHaveLength(0);
    expect(screen.getByText(ada.email)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Remove ${ada.email}` }),
    ).toBeInTheDocument();
  });

  it("reports a failed removal inside the confirmation and keeps the editor", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, editors: [ada] }))
      .mockResolvedValueOnce(jsonResponse({ error: "server_error" }, 500));

    renderCard();
    await screen.findByText(ada.email);

    await user.click(
      screen.getByRole("button", { name: `Remove ${ada.email}` }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /remove editor/i }),
    );

    expect(
      await within(dialog).findByText(/Something went wrong on our end/),
    ).toBeInTheDocument();
    // Still open, still there — a failed destructive action must not look like
    // a successful one.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(ada.email)).toBeInTheDocument();
  });

  it("explains that a non-admin cannot manage editors, and offers no form", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: "forbidden", message: "Admin permission required." },
        403,
      ),
    );

    renderCard();

    expect(
      await screen.findByText("You cannot manage editors on this site"),
    ).toBeInTheDocument();
    expect(screen.getByText("Admin permission required.")).toBeInTheDocument();

    // A form that cannot succeed should not be offered at all.
    expect(screen.queryByLabelText(/editor email/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add editor/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });
});
