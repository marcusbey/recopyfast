import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { QuickSetup, type QuickSetupSite } from "../QuickSetup";
import { useSiteActivation } from "@/hooks/useSiteActivation";
import {
  SiteContext,
  useSiteContext,
  type SiteContextValue,
} from "@/components/dashboard/site/SiteProvider";
import {
  buildSite as buildSiteRecord,
  buildSiteContext,
} from "@/components/dashboard/site/__tests__/site-context-fixture";

/**
 * s66c2 — the quick setup on a site's Overview. It replaces the activation
 * checklist, and this file replaces `ActivationChecklist.test.tsx`: the
 * same `useSiteActivation` data, the same dismissal, the same loading and
 * error states, now as three steps that end Live.
 *
 * Carried over from the checklist, with their names changed: loading, error
 * with retry, dismissal persistence, copying only the emitted snippet, the
 * Add editor preset (and its notice surviving completion and a refresh
 * error), and every Edit website open-tab assertion.
 */

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
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SNIPPET = '<script data-site-id="site"></script>';

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

/** The activation progress of a site whose snippet has reported in. */
const INSTALLED = {
  installed: true,
  invited: false,
  published: false,
  dismissed: false,
};

const COMPLETE = "Setup complete — Client Site is live";
const WAITING =
  "Waiting for the first page view on client.example.com. Checking every 5 seconds.";

function buildSite(overrides: Partial<QuickSetupSite> = {}): QuickSetupSite {
  return {
    id: SITE_ID,
    name: "Client Site",
    domain: "client.example.com",
    status: "awaiting-install",
    live_at: null,
    last_reported_at: null,
    ...overrides,
  };
}

const LIVE_SITE = buildSite({
  status: "live",
  live_at: "2026-10-08T09:00:00Z",
  last_reported_at: "2026-10-08T09:00:00Z",
});

/*
 * The Overview's next section heading, which the panel hands focus to once it
 * has left the page (s66c2 review M-1). Rendered beside every panel here, as
 * the Overview does.
 */
const nextHeadingRef = createRef<HTMLHeadingElement>();

function NextHeading() {
  return (
    <h2 ref={nextHeadingRef} tabIndex={-1}>
      Activity
    </h2>
  );
}

function quickSetup(site: QuickSetupSite = buildSite()) {
  return (
    <>
      <QuickSetup
        site={site}
        embedScript={SNIPPET}
        userId={USER_ID}
        focusFallbackRef={nextHeadingRef}
      />
      <NextHeading />
    </>
  );
}

function renderQuickSetup(site?: QuickSetupSite) {
  return render(quickSetup(site));
}

const stepNamed = (title: string) =>
  screen
    .getAllByRole("listitem")
    .find((item) =>
      within(item).queryByRole("heading", { name: title }),
    ) as HTMLElement;

describe("QuickSetup", () => {
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

    renderQuickSetup();

    expect(
      screen.getByRole("status", {
        name: "Loading quick setup for Client Site",
      }),
    ).toBeInTheDocument();
  });

  it("shows a retryable error instead of guessed progress", async () => {
    const user = userEvent.setup();
    mockUseSiteActivation.mockReturnValue(
      activation({ data: null, error: "Could not load activation progress" }),
    );

    renderQuickSetup();
    await user.click(
      screen.getByRole("button", {
        name: "Try quick setup again for Client Site",
      }),
    );

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Could not load setup progress for Client Site/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Install the snippet")).not.toBeInTheDocument();
  });

  it("has three steps: Site added, Install the snippet, Start editing", () => {
    renderQuickSetup();

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(
      steps.map(
        (step) => within(step).getByRole("heading", { level: 3 }).textContent,
      ),
    ).toEqual(["Site added", "Install the snippet", "Start editing"]);
    // Step 1 is always done: the site exists.
    expect(within(steps[0]).getByText("Done")).toBeInTheDocument();
    expect(
      within(steps[0]).getByText("Client Site · client.example.com"),
    ).toBeInTheDocument();
  });

  it("says which of the three steps is current", () => {
    renderQuickSetup();

    expect(
      screen.getByRole("heading", { level: 2, name: "Quick setup" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
  });

  it("expands only the current step", () => {
    const view = renderQuickSetup();

    // Awaiting install: step 2 is current and is the only one with its body.
    let current = screen.getByRole("listitem", { current: "step" });
    expect(current).toBe(stepNamed("Install the snippet"));
    expect(
      within(current).getByRole("button", { name: "Copy snippet" }),
    ).toBeInTheDocument();
    expect(within(current).getByText("</body>")).toBeInTheDocument();
    expect(
      within(current).getByRole("link", { name: "Platform instructions" }),
    ).toHaveAttribute("href", `/dashboard/sites/${SITE_ID}/install`);
    const next = stepNamed("Start editing");
    expect(
      within(next).getByText(
        "Edit the copy yourself, or add the person who will.",
      ),
    ).toBeInTheDocument();
    expect(within(next).queryByRole("button")).not.toBeInTheDocument();

    // Installed: step 3 is current, and step 2 collapses with its snippet.
    mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));
    view.rerender(quickSetup());

    current = screen.getByRole("listitem", { current: "step" });
    expect(current).toBe(stepNamed("Start editing"));
    expect(
      within(current).getByRole("button", {
        name: "Edit website: Client Site",
      }),
    ).toBeInTheDocument();
    expect(
      within(current).getByRole("button", {
        name: "Add editor to Client Site",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy snippet" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { current: "step" })).toHaveLength(
      1,
    );
  });

  // Resumable: every step's state is the server's (the site's status and
  // `/activation`). Leaving the Overview and coming back lands on the same
  // step, and nothing is kept in the browser to make that so.
  it("derives progress from its props and activation only, so a remount resumes the same step", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));

    const first = renderQuickSetup();
    expect(screen.getByRole("listitem", { current: "step" })).toBe(
      stepNamed("Start editing"),
    );
    first.unmount();

    renderQuickSetup();
    expect(screen.getByRole("listitem", { current: "step" })).toBe(
      stepNamed("Start editing"),
    );
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
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

    renderQuickSetup();

    expect(
      screen.queryByRole("heading", { name: "Quick setup" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("waits for dismissal persistence and keeps quick setup on failure", async () => {
    const user = userEvent.setup();
    dismiss.mockRejectedValueOnce(new Error("Could not save dismissal"));
    renderQuickSetup();

    await user.click(screen.getByRole("button", { name: "Hide quick setup" }));

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Could not save dismissal"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quick setup" }),
    ).toBeInTheDocument();
  });

  it("copies only the emitted snippet and reports clipboard failure inline", async () => {
    renderQuickSetup();

    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SNIPPET));
    expect(
      await screen.findByRole("button", { name: "Copy snippet" }),
    ).toHaveTextContent("Copied");

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copy snippet" }),
      ).toHaveTextContent("Copy failed"),
    );
    expect(writeText).toHaveBeenLastCalledWith(SNIPPET);
  });

  it("keeps delivery feedback visible when the invite completes setup", async () => {
    const user = userEvent.setup();
    mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));
    const view = renderQuickSetup(LIVE_SITE);
    refetch
      .mockImplementationOnce(async () => {
        mockUseSiteActivation.mockReturnValue(
          activation({ data: { ...INSTALLED, invited: true } }),
        );
        view.rerender(quickSetup(LIVE_SITE));
      })
      .mockImplementationOnce(async () => {
        mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));
        view.rerender(quickSetup(LIVE_SITE));
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
    // Live, and an editor with Publish: setup is done and the panel has left
    // the page. The dialog and its notice have not.
    expect(screen.queryByRole("heading", { name: COMPLETE })).toBeNull();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Revoke publish editor" }),
    );
    expect(screen.getByRole("heading", { name: COMPLETE })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.getByRole("listitem", { current: "step" })).toBe(
      stepNamed("Start editing"),
    );
    expect(
      screen.getByRole("region", { name: "Quick setup for Client Site" }),
    ).toHaveFocus();
  });

  /*
   * s66c2 review M-1. Live, no editor: adding one with Publish finishes setup
   * and the panel leaves the page while the dialog is open. Focus used to go
   * back to the panel's region, which is then empty and, through
   * `empty:hidden`, display:none: in Chromium focus() on it does nothing and
   * focus fell to <body>. jsdom applies no CSS, so the proof is structural:
   * focus is neither on nor inside the empty region, and it is on the page's
   * next heading, which is drawn whatever the panel does.
   */
  it("hands focus to the page's next heading when the invite finishes setup", async () => {
    const user = userEvent.setup();
    mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));
    const view = renderQuickSetup(LIVE_SITE);
    refetch.mockImplementationOnce(async () => {
      mockUseSiteActivation.mockReturnValue(
        activation({ data: { ...INSTALLED, invited: true } }),
      );
      view.rerender(quickSetup(LIVE_SITE));
    });

    await user.click(
      screen.getByRole("button", { name: "Add editor to Client Site" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Complete invitation" }),
    );
    await user.click(screen.getByRole("button", { name: /close/i }));

    const region = screen.getByRole("region", {
      name: "Quick setup for Client Site",
    });
    expect(region).toBeEmptyDOMElement();
    expect(document.activeElement).not.toBe(document.body);
    expect(region).not.toContainElement(document.activeElement as HTMLElement);
    expect(
      screen.getByRole("heading", { level: 2, name: "Activity" }),
    ).toHaveFocus();
  });

  it("keeps the invite dialog and fallback notice visible through a refresh error", async () => {
    const user = userEvent.setup();
    mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));
    const view = renderQuickSetup();
    refetch.mockImplementationOnce(async () => {
      mockUseSiteActivation.mockReturnValue(
        activation({ data: null, error: "Background refresh failed" }),
      );
      view.rerender(quickSetup());
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
      screen.getByText(/Could not load setup progress for Client Site/i),
    ).toBeInTheDocument();
  });

  describe("live install status, and done means Live", () => {
    /*
     * The Overview hands the quick setup the provider's site (ADR 052), so
     * the 5 s install poll that flips `site.status` reaches step 2 by itself.
     * This consumer reads the context the way the Overview does; the stub
     * stands in for the provider and its poll.
     */
    function FromProvider() {
      const { site, credentials } = useSiteContext();
      return (
        <>
          <QuickSetup
            site={site}
            embedScript={credentials.embedScript ?? ""}
            userId={USER_ID}
            focusFallbackRef={nextHeadingRef}
          />
          <NextHeading />
        </>
      );
    }

    function withSite(value: SiteContextValue) {
      return (
        <SiteContext.Provider value={value}>
          <FromProvider />
        </SiteContext.Provider>
      );
    }

    it("turns step 2's status row to Installed when the provider's poll sees the site live, with no activation refetch", () => {
      const awaiting = buildSiteContext({
        site: buildSiteRecord({
          status: "awaiting-install",
          live_at: null,
          last_reported_at: null,
        }),
      });
      const view = render(withSite(awaiting));

      expect(
        screen.getByText(
          "Waiting for the first page view on acme.example. Checking every 5 seconds.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Installed\./)).not.toBeInTheDocument();

      const seenAt = new Date().toISOString();
      view.rerender(
        withSite({
          ...awaiting,
          site: {
            ...awaiting.site,
            status: "live",
            live_at: seenAt,
            last_reported_at: seenAt,
          },
        }),
      );

      expect(
        screen.getByText(/^Installed\. ReCopyFast saw acme\.example .+ ago\.$/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Waiting for the first page view/),
      ).not.toBeInTheDocument();
      expect(refetch).not.toHaveBeenCalled();
    });

    it("says Live in the success tone once the site is live, with step 3 current", () => {
      renderQuickSetup(LIVE_SITE);

      const heading = screen.getByRole("heading", { level: 2, name: COMPLETE });
      expect(heading).toHaveClass("text-tone-success-text");
      expect(screen.queryByText("Step 2 of 3")).not.toBeInTheDocument();
      expect(screen.getByRole("listitem", { current: "step" })).toBe(
        stepNamed("Start editing"),
      );
      expect(
        within(stepNamed("Install the snippet")).getByText("Done"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit website: Client Site" }),
      ).toBeEnabled();
    });

    /*
     * s66c2 review m-4. A stale site has reported in before, so step 2 is
     * done and setup is complete, but the page's badge says Stale: no report
     * recently. The header said "… is live" above that badge.
     */
    it("says installed, not live, for a stale site, as its Stale badge does", () => {
      mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));

      renderQuickSetup({ ...LIVE_SITE, status: "stale" });

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Setup complete — Client Site is installed",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /is live/ })).toBeNull();
      expect(screen.getByRole("listitem", { current: "step" })).toBe(
        stepNamed("Start editing"),
      );
    });

    it("keeps waiting while the site is not live, and says so", () => {
      renderQuickSetup();

      expect(screen.getByText(WAITING)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: COMPLETE })).toBeNull();
    });

    it.each(["invited", "published"])(
      "leaves the page once the site is live and %s",
      (fact) => {
        mockUseSiteActivation.mockReturnValue(
          activation({ data: { ...INSTALLED, [fact]: true } }),
        );

        renderQuickSetup(LIVE_SITE);

        expect(screen.queryByRole("heading", { name: COMPLETE })).toBeNull();
        expect(
          screen.queryByRole("heading", { name: "Quick setup" }),
        ).toBeNull();
        expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
      },
    );

    // Step 3 alone does not finish setup: done means Live.
    it("stays on step 2 when an editor was added before the snippet was installed", () => {
      mockUseSiteActivation.mockReturnValue(
        activation({
          data: { ...INSTALLED, installed: false, invited: true },
        }),
      );

      renderQuickSetup();

      expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
      expect(screen.getByRole("listitem", { current: "step" })).toBe(
        stepNamed("Install the snippet"),
      );
      expect(
        within(stepNamed("Start editing")).getByText("Done"),
      ).toBeInTheDocument();
    });

    /*
     * Plan Task 3, as amended by the s66c2 review (m-1): Edit website and Add
     * editor appear when step 3 becomes current, once step 2 is done. Before
     * that, step 3 shows only its title and one line. The plan first said
     * "disabled until step 2 is done", a state that cannot occur: only the
     * current step is expanded, and the current step is the first
     * incomplete one. This is about the quick setup's own step, not about
     * editing being blocked: s66c1's header Edit website stays enabled while
     * the site awaits install.
     */
    it("offers no usable Edit website until step 2 is done", () => {
      const view = renderQuickSetup();

      const editWebsite = () =>
        screen.queryByRole("button", { name: "Edit website: Client Site" });
      expect(editWebsite()).toBeNull();

      view.rerender(quickSetup(LIVE_SITE));

      expect(editWebsite()).toBeEnabled();
    });

    it("hides quick setup through the dismissal endpoint", async () => {
      const user = userEvent.setup();
      const actual = jest.requireActual<
        typeof import("@/hooks/useSiteActivation")
      >("@/hooks/useSiteActivation");
      mockUseSiteActivation.mockImplementation(actual.useSiteActivation);
      const fetchMock = jest.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          ({
            ok: true,
            status: 200,
            json: async () =>
              init?.method === "POST"
                ? { dismissed: true }
                : { ...INSTALLED, installed: false },
          }) as Response,
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      renderQuickSetup();
      await user.click(
        await screen.findByRole("button", { name: "Hide quick setup" }),
      );

      await waitFor(() =>
        expect(
          screen.queryByRole("heading", { name: "Quick setup" }),
        ).not.toBeInTheDocument(),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/sites/${SITE_ID}/activation`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("Edit website", () => {
    beforeEach(() => {
      mockUseSiteActivation.mockReturnValue(activation({ data: INSTALLED }));
    });

    it("opens only the returned http(s) URL on the registered host", async () => {
      const user = userEvent.setup();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editUrl: "https://client.example.com/?rcf_edit_token=short-lived",
        }),
      }) as jest.MockedFunction<typeof fetch>;
      renderQuickSetup();

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
      // The stepper's body, as the checklist's: the step it completes is a
      // publish (design § Edit website, "Checklist and stepper").
      expect(
        JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string),
      ).toEqual({
        siteId: SITE_ID,
        permissions: ["edit", "publish"],
        durationHours: 2,
      });
    });

    it("opens the edit window before the session request resolves", async () => {
      const user = userEvent.setup();
      let resolveRequest!: (value: Response) => void;
      global.fetch = jest.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
      ) as jest.MockedFunction<typeof fetch>;
      renderQuickSetup();

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
      renderQuickSetup();

      await user.click(
        screen.getByRole("button", { name: "Edit website: Client Site" }),
      );

      expect(await screen.findByText(/valid edit link/i)).toBeInTheDocument();
      expect(popup.close).toHaveBeenCalled();
    });

    // s66c1 pre-PR fix: the refusal rendered inside the step's row, beside
    // the button. It reads with the panel's other messages, above the steps.
    it("announces a refused Edit website above the steps, not inside its step", async () => {
      const user = userEvent.setup();
      (window.open as jest.Mock).mockReturnValue(null);
      renderQuickSetup();
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
      renderQuickSetup();

      await user.click(
        screen.getByRole("button", { name: "Edit website: Client Site" }),
      );

      expect(await screen.findByText(/allow pop-ups/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit website: Client Site" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("listitem", { current: "step" })).toBe(
        stepNamed("Start editing"),
      );
    });
  });
});
