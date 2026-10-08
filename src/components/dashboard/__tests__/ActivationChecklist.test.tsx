import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivationChecklist } from "../ActivationChecklist";
import { useSiteActivation } from "@/hooks/useSiteActivation";

jest.mock("@/hooks/useSiteActivation", () => ({
  useSiteActivation: jest.fn(),
}));
/*
 * s66c1: the checklist's step opens the same AddEditorDialog as People &
 * access (it used to wrap the whole SiteEditorsCard in an "Invite a client"
 * dialog). The mock stands in for that dialog: open or not, the preset it was
 * given, its success callback, and a Close that hands focus back the way the
 * real dialog's `onCloseAutoFocus` does.
 */
jest.mock("../AddEditorDialog", () => ({
  AddEditorDialog: ({
    open,
    onOpenChange,
    onAdded,
    defaultPermissions,
    onCloseAutoFocus,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdded?: () => void;
    defaultPermissions?: string[];
    onCloseAutoFocus?: (event: Event) => void;
  }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const [noticeVisible, setNoticeVisible] = React.useState(false);
    if (!open) return null;
    return (
      <div
        role="dialog"
        data-default-permissions={defaultPermissions?.join(",")}
      >
        <button
          onClick={() => {
            setNoticeVisible(true);
            onAdded?.();
          }}
        >
          Complete invitation
        </button>
        <button onClick={() => onAdded?.()}>Revoke publish editor</button>
        {noticeVisible && (
          <p>No invitation email was sent. Copy the editor hub link.</p>
        )}
        <button
          onClick={() => {
            onOpenChange(false);
            onCloseAutoFocus?.(new Event("focus"));
          }}
        >
          Close
        </button>
      </div>
    );
  },
}));

const mockUseSiteActivation = useSiteActivation as jest.MockedFunction<
  typeof useSiteActivation
>;
const refetch = jest.fn();
const dismiss = jest.fn();
const writeText = jest.fn();
const popup = {
  opener: {} as Window | null,
  location: { href: "" },
  close: jest.fn(),
};
const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function activation(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      installed: false,
      invited: false,
      published: false,
      dismissed: false,
    },
    loading: false,
    error: null,
    refetch,
    dismiss,
    dismissing: false,
    dismissError: null,
    ...overrides,
  } as ReturnType<typeof useSiteActivation>;
}

function renderChecklist() {
  return render(
    <ActivationChecklist
      siteId={SITE_ID}
      siteName="Client Site"
      domain="client.example.com"
      embedScript='<script data-site-id="site"></script>'
      userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    />,
  );
}

describe("ActivationChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSiteActivation.mockReturnValue(activation());
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    popup.opener = {} as Window;
    popup.location.href = "";
    popup.close.mockReset();
    jest.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => jest.restoreAllMocks());

  it("renders a shaped loading state", () => {
    mockUseSiteActivation.mockReturnValue(
      activation({ data: null, loading: true }),
    );

    renderChecklist();

    expect(
      screen.getByRole("status", { name: /loading activation/i }),
    ).toBeInTheDocument();
  });

  it("shows a retryable error instead of guessed progress", async () => {
    const user = userEvent.setup();
    mockUseSiteActivation.mockReturnValue(
      activation({ data: null, error: "Could not load activation progress" }),
    );

    renderChecklist();
    await user.click(
      screen.getByRole("button", {
        name: "Try activation again for Client Site",
      }),
    );

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Could not load activation progress for Client Site/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Install detected")).not.toBeInTheDocument();
  });

  it("shows exactly one action for each incomplete step", () => {
    renderChecklist();

    expect(screen.getByText("Install detected")).toBeInTheDocument();
    expect(screen.getAllByText("Add editor")).toHaveLength(2);
    expect(screen.getByText("An edit published")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy snippet for Client Site" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add editor to Client Site" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit website: Client Site" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Get Client Site publishing" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not yet")).toHaveLength(3);
  });

  it.each([
    ["installed", "Copy snippet for Client Site"],
    ["invited", "Add editor to Client Site"],
    ["published", "Edit website: Client Site"],
  ])("removes the %s action after real progress completes", (fact, action) => {
    mockUseSiteActivation.mockReturnValue(
      activation({
        data: {
          installed: false,
          invited: false,
          published: false,
          dismissed: false,
          [fact]: true,
        },
      }),
    );

    renderChecklist();

    expect(
      screen.queryByRole("button", { name: action }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Complete")).toHaveLength(1);
  });

  it("replaces the checklist with a single Live state when complete", () => {
    mockUseSiteActivation.mockReturnValue(
      activation({
        data: {
          installed: true,
          invited: true,
          published: true,
          dismissed: true,
        },
      }),
    );

    renderChecklist();

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Activation for Client Site" }),
    ).toHaveTextContent(
      "Site installed, an active invited editor has Publish permission, and an edit has been published.",
    );
    expect(screen.queryByText("Install detected")).not.toBeInTheDocument();
  });

  it("stays hidden after server-confirmed dismissal", () => {
    mockUseSiteActivation.mockReturnValue(
      activation({
        data: {
          installed: false,
          invited: false,
          published: false,
          dismissed: true,
        },
      }),
    );

    renderChecklist();

    expect(
      screen.queryByText("Get your client publishing"),
    ).not.toBeInTheDocument();
  });

  it("waits for dismissal persistence and keeps the checklist on failure", async () => {
    const user = userEvent.setup();
    dismiss.mockRejectedValueOnce(new Error("Could not save dismissal"));
    renderChecklist();

    await user.click(
      screen.getByRole("button", {
        name: "Dismiss activation checklist for Client Site",
      }),
    );

    expect(
      await screen.findByText("Could not save dismissal"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Get Client Site publishing" }),
    ).toBeInTheDocument();
  });

  it("copies only the emitted snippet and reports clipboard failure inline", async () => {
    renderChecklist();

    fireEvent.click(
      screen.getByRole("button", { name: "Copy snippet for Client Site" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '<script data-site-id="site"></script>',
      ),
    );
    expect(await screen.findByText("Snippet copied")).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy snippet for Client Site" }),
    );
    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });

  it("keeps delivery feedback visible when the invite completes activation", async () => {
    const user = userEvent.setup();
    mockUseSiteActivation.mockReturnValue(
      activation({
        data: {
          installed: true,
          invited: false,
          published: true,
          dismissed: false,
        },
      }),
    );
    const view = renderChecklist();
    refetch
      .mockImplementationOnce(async () => {
        mockUseSiteActivation.mockReturnValue(
          activation({
            data: {
              installed: true,
              invited: true,
              published: true,
              dismissed: false,
            },
          }),
        );
        view.rerender(
          <ActivationChecklist
            siteId={SITE_ID}
            siteName="Client Site"
            domain="client.example.com"
            embedScript='<script data-site-id="site"></script>'
            userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          />,
        );
      })
      .mockImplementationOnce(async () => {
        mockUseSiteActivation.mockReturnValue(
          activation({
            data: {
              installed: true,
              invited: false,
              published: true,
              dismissed: false,
            },
          }),
        );
        view.rerender(
          <ActivationChecklist
            siteId={SITE_ID}
            siteName="Client Site"
            domain="client.example.com"
            embedScript='<script data-site-id="site"></script>'
            userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          />,
        );
      });

    await user.click(
      screen.getByRole("button", { name: "Add editor to Client Site" }),
    );
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "data-default-permissions",
      "view,edit,publish",
    );
    await user.click(
      screen.getByRole("button", { name: "Complete invitation" }),
    );

    expect(refetch).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/No invitation email was sent/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Revoke publish editor" }),
    );
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(
      screen.getByRole("heading", { name: "Get Client Site publishing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Activation for Client Site" }),
    ).toHaveFocus();
  });

  it("keeps the invite dialog and fallback notice visible through a refresh error", async () => {
    const user = userEvent.setup();
    const view = renderChecklist();
    refetch.mockImplementationOnce(async () => {
      mockUseSiteActivation.mockReturnValue(
        activation({ data: null, error: "Background refresh failed" }),
      );
      view.rerender(
        <ActivationChecklist
          siteId={SITE_ID}
          siteName="Client Site"
          domain="client.example.com"
          embedScript='<script data-site-id="site"></script>'
          userId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        />,
      );
    });

    await user.click(
      screen.getByRole("button", { name: "Add editor to Client Site" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Complete invitation" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/No invitation email was sent/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Could not load activation progress for Client Site/i),
    ).toBeInTheDocument();
  });

  it("opens only the returned http(s) URL on the registered host", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        editUrl: "https://client.example.com/?rcf_edit_token=short-lived",
      }),
    }) as jest.MockedFunction<typeof fetch>;
    renderChecklist();

    await user.click(
      screen.getByRole("button", { name: "Edit website: Client Site" }),
    );

    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() =>
      expect(popup.location.href).toBe(
        "https://client.example.com/?rcf_edit_token=short-lived",
      ),
    );
    expect(popup.opener).toBeNull();
  });

  it("opens the edit window before the session request resolves", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: Response) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    ) as jest.MockedFunction<typeof fetch>;
    renderChecklist();

    await user.click(
      screen.getByRole("button", { name: "Edit website: Client Site" }),
    );

    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.location.href).toBe("");

    resolveRequest({
      ok: true,
      json: async () => ({ editUrl: "https://client.example.com/edit" }),
    } as Response);
    await waitFor(() =>
      expect(popup.location.href).toBe("https://client.example.com/edit"),
    );
  });

  it.each([
    "javascript:alert(1)",
    "https://attacker.example/?rcf_edit_token=stolen",
  ])("rejects an unsafe edit URL: %s", async (editUrl) => {
    const user = userEvent.setup();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ editUrl }),
    }) as jest.MockedFunction<typeof fetch>;
    renderChecklist();

    await user.click(
      screen.getByRole("button", { name: "Edit website: Client Site" }),
    );

    expect(await screen.findByText(/valid edit link/i)).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  });

  // Pre-PR fix: the refusal rendered inside the step's row, beside "Not yet"
  // and the button. It now reads with the checklist's other messages, above
  // the steps.
  it("announces a refused Edit website above the steps, not inside its step", async () => {
    const user = userEvent.setup();
    (window.open as jest.Mock).mockReturnValue(null);
    renderChecklist();
    const button = screen.getByRole("button", {
      name: "Edit website: Client Site",
    });

    await user.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Allow pop-ups for ReCopyFast, then try again.",
    );
    expect(button.closest("li")).not.toContainElement(alert);
    expect(
      alert.compareDocumentPosition(screen.getByRole("list")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button).toBeEnabled();
  });

  it("surfaces popup blocking and does not claim the step is complete", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ editUrl: "https://client.example.com/edit" }),
    }) as jest.MockedFunction<typeof fetch>;
    (window.open as jest.Mock).mockReturnValue(null);
    renderChecklist();

    await user.click(
      screen.getByRole("button", { name: "Edit website: Client Site" }),
    );

    expect(await screen.findByText(/allow pop-ups/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit website: Client Site" }),
    ).toBeInTheDocument();
  });
});
