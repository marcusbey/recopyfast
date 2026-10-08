import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddEditorDialog } from "../AddEditorDialog";

/**
 * s66c1 AC 6 — "Add editor" is one dialog, for every caller.
 *
 * These are the enrolment tests that lived in SiteEditorsCard.test.tsx
 * (`:117`, `:165-239`, `:374-557`). The form moved out of the card into this
 * dialog, which People & access and the activation checklist both open; the
 * checklist used to wrap the whole card in an "Invite a client" dialog, so
 * one action had two names and two identical forms.
 *
 * What changed in the move, and only this:
 * - they render `<AddEditorDialog open …>` instead of the card;
 * - the dialog holds no list, so the list fetch that preceded every POST in
 *   the card's tests (and the "No editors yet" waits on it) is gone;
 * - after a success the dialog's body is the delivery notice, so "the row is
 *   the proof" and "form cleared" became the notice, `onAdded`, and a footer
 *   that offers only "Done" (new).
 */

const SITE_ID = "site-1";
const SITE_NAME = "Client Site";

const grace = {
  id: "editor-grace",
  email: "grace@clientcompany.com",
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
const writeTextMock = jest.fn();

function callsWithMethod(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === method,
  );
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof AddEditorDialog>> = {},
) {
  const onAdded = jest.fn();
  const onOpenChange = jest.fn();
  render(
    <AddEditorDialog
      open
      onOpenChange={onOpenChange}
      siteId={SITE_ID}
      siteName={SITE_NAME}
      onAdded={onAdded}
      {...props}
    />,
  );
  return { onAdded, onOpenChange };
}

describe("AddEditorDialog", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // The component logs the underlying failure before showing a human message.
    jest.spyOn(console, "error").mockImplementation(() => {});
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says what an editor is, in the ONGOING ACCESS words", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", {
      name: "Add editor to Client Site",
    });
    expect(dialog).toHaveTextContent(
      "For someone who keeps editing this site. They sign in with a code sent to their email and keep access until you remove them.",
    );
  });

  it("focuses the invite email when the dialog opens", async () => {
    renderDialog();

    expect(await screen.findByLabelText(/editor email/i)).toHaveFocus();
  });

  it("enrols an editor and confirms the invitation email", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        editor: { id: grace.id, email: grace.email, permissions: ["view"] },
        hubUrl: "https://app.recopyfast.com/edit",
        invitationEmailSent: true,
      }),
    );
    const { onAdded } = renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    expect(
      await screen.findByText(`We emailed ${grace.email} an invitation.`),
    ).toBeInTheDocument();

    const [postUrl, postInit] = callsWithMethod("POST")[0];
    expect(postUrl).toBe("/api/editor/editors");
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      siteId: SITE_ID,
      email: grace.email,
      permissions: ["view", "edit"],
    });

    expect(
      screen.queryByRole("button", { name: /copy link/i }),
    ).not.toBeInTheDocument();
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("offers only Done once the editor is added", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        editor: { email: grace.email },
        hubUrl: "https://app.recopyfast.com/edit",
        invitationEmailSent: true,
      }),
    );
    const { onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));
    await screen.findByText(`We emailed ${grace.email} an invitation.`);

    const done = screen.getByRole("button", { name: "Done" });
    const footer = done.parentElement as HTMLElement;
    expect(within(footer).getAllByRole("button")).toEqual([done]);
    expect(screen.queryByLabelText(/editor email/i)).not.toBeInTheDocument();

    await user.click(done);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps manual hub instructions and copies the link when email delivery fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        editor: { id: grace.id, email: grace.email, permissions: ["view"] },
        hubUrl: "https://app.recopyfast.com/edit",
        invitationEmailSent: false,
      }),
    );

    renderDialog();
    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    expect(
      await screen.findByText(/No invitation email was sent/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /the editor hub/i }),
    ).toHaveAttribute("href", "https://app.recopyfast.com/edit");

    await user.click(screen.getByRole("button", { name: /copy link/i }));
    expect(await navigator.clipboard.readText()).toBe(
      "https://app.recopyfast.com/edit",
    );
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("sends the permissions the owner actually picked", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, editor: { email: grace.email }, hubUrl: "" }),
    );

    renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    await waitFor(() => expect(callsWithMethod("POST")).toHaveLength(1));
    const [, postInit] = callsWithMethod("POST")[0];
    expect(
      JSON.parse((postInit as RequestInit).body as string).permissions,
    ).toEqual(["view", "edit", "publish"]);
  });

  it("preselects Publish only when the caller requests the activation default", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, editor: { email: grace.email }, hubUrl: "" }),
    );

    renderDialog({ defaultPermissions: ["view", "edit", "publish"] });

    expect(screen.getByRole("button", { name: "Publish" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    await waitFor(() => expect(callsWithMethod("POST")).toHaveLength(1));
    const [, postInit] = callsWithMethod("POST")[0];
    expect(
      JSON.parse((postInit as RequestInit).body as string).permissions,
    ).toEqual(["view", "edit", "publish"]);
  });

  it("keeps the typed address when the invite is rejected", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Rate limit exceeded",
          message: "Too many invites. Please try again shortly.",
        },
        429,
      ),
    );

    const { onAdded } = renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many invites. Please try again shortly.",
    );
    // Retyping a rejected address is a needless punishment.
    expect(screen.getByLabelText(/editor email/i)).toHaveValue(grace.email);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("renders a seat-limit refusal as a billing matter, not a malfunction", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "seat_limit",
          message:
            "You've used all 5 seats on your Pro plan for this site. Editors and collaborators share the same allowance — remove one, or upgrade for more.",
          upgradeRequired: true,
          currentLimit: 5,
          maxLimit: 5,
        },
        403,
      ),
    );

    renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("all 5 seats on your Pro plan");
    // Which limit, and what actually resolves it. Retrying the button does not.
    expect(
      within(alert).getByRole("link", { name: /view plans/i }),
    ).toHaveAttribute("href", "/dashboard/billing");
    expect(screen.getByLabelText(/editor email/i)).toHaveValue(grace.email);
  });

  it("tells a plan with no seats at all apart from a plan that has run out", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "seat_limit",
          message:
            "Your Starter plan does not include collaborator seats. Upgrade to invite editors or collaborators to this site.",
          upgradeRequired: true,
          currentLimit: 0,
          maxLimit: 0,
        },
        403,
      ),
    );

    renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your Starter plan does not include collaborator seats",
    );
    expect(alert).not.toHaveTextContent("used all");
    expect(
      within(alert).getByRole("link", { name: /view plans/i }),
    ).toBeInTheDocument();
  });

  it("keeps an ordinary failure red and offers no upgrade path", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "server_error" }, 500),
    );

    renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: /add editor/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Something went wrong on our end/);
    expect(
      within(alert).queryByRole("link", { name: /view plans/i }),
    ).not.toBeInTheDocument();
  });

  it("refuses to submit an enrolment with no permissions", async () => {
    const user = userEvent.setup();

    renderDialog();

    await user.type(screen.getByLabelText(/editor email/i), grace.email);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: /add editor/i })).toBeDisabled();
    expect(callsWithMethod("POST")).toHaveLength(0);
  });
});
