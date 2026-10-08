import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitePeoplePage from "../page";
import {
  buildSite,
  buildSiteContext,
  renderWithSite,
} from "@/components/dashboard/site/__tests__/site-context-fixture";

/**
 * s66c1 AC 6 — People & access offers exactly two ways to give someone access,
 * and says when to use each.
 *
 * The owner, 2026-10-07: "invite a client, and editors are confusing. which
 * one to use and when?" There were two mechanisms under three labels with
 * field-for-field identical forms. Now there are two buttons, each under the
 * one line that says what it is for, and the two lists they add to.
 */

jest.mock("next/navigation", () => ({
  usePathname: () =>
    "/dashboard/sites/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/people",
}));

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ADD_EDITOR_EXPLAINER =
  "For someone who keeps editing this site. They sign in with a code sent to their email and keep access until you remove them.";
const SHARE_EXPLAINER =
  "For a one-off review of unpublished changes. View only unless you allow more, and the link stops working after the time you choose.";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = jest.fn();

function respondToLists() {
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/editor/editors") && method === "POST") {
        return jsonResponse({
          ok: true,
          editor: { email: "grace@example.com" },
          hubUrl: "https://app.example/edit",
          invitationEmailSent: true,
        });
      }
      if (url.startsWith("/api/editor/editors")) {
        return jsonResponse({ ok: true, editors: [] });
      }
      if (url === "/api/staging/access" && method === "POST") {
        return jsonResponse({ success: true, emailDelivered: true });
      }
      if (url.startsWith("/api/staging/access")) {
        return jsonResponse({ success: true, accessList: [] });
      }
      return jsonResponse({});
    },
  );
}

const listCalls = (prefix: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).startsWith(prefix) &&
      ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
  ).length;

const accessSection = () =>
  screen.getByRole("region", { name: "Give someone access" });

describe("the People & access page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    respondToLists();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("offers exactly two actions: Add editor and Share preview link", () => {
    renderWithSite(<SitePeoplePage />);

    const actions = within(accessSection()).getAllByRole("button");
    expect(actions.map((action) => action.textContent)).toEqual([
      "Add editor",
      "Share preview link",
    ]);
  });

  it("says when to use each, in the owner-approved words", () => {
    renderWithSite(<SitePeoplePage />);

    const section = accessSection();
    expect(within(section).getByText(ADD_EDITOR_EXPLAINER)).toBeInTheDocument();
    expect(within(section).getByText(SHARE_EXPLAINER)).toBeInTheDocument();
    expect(within(section).getByText("Ongoing access")).toBeInTheDocument();
    expect(within(section).getByText("One-off review")).toBeInTheDocument();
  });

  /**
   * s66c1 review m1. Both explainers on the page is not the owner's answer:
   * "which one to use and when" is answered only if each line sits with its
   * own button. Swapping them would put the expiring-link sentence over Add
   * editor, and every assertion above would still pass.
   */
  it("pairs each explainer with its own button, one option each", () => {
    renderWithSite(<SitePeoplePage />);

    const buttonsIn = (option: HTMLElement) =>
      within(option)
        .getAllByRole("button")
        .map((button) => button.textContent);

    const ongoing = within(accessSection()).getByRole("group", {
      name: "Ongoing access",
    });
    expect(within(ongoing).getByText(ADD_EDITOR_EXPLAINER)).toBeInTheDocument();
    expect(
      within(ongoing).queryByText(SHARE_EXPLAINER),
    ).not.toBeInTheDocument();
    expect(buttonsIn(ongoing)).toEqual(["Add editor"]);

    const oneOff = within(accessSection()).getByRole("group", {
      name: "One-off review",
    });
    expect(within(oneOff).getByText(SHARE_EXPLAINER)).toBeInTheDocument();
    expect(
      within(oneOff).queryByText(ADD_EDITOR_EXPLAINER),
    ).not.toBeInTheDocument();
    expect(buttonsIn(oneOff)).toEqual(["Share preview link"]);
  });

  it("lists editors and preview links, each under a heading with its count", async () => {
    renderWithSite(<SitePeoplePage />);

    expect(
      await screen.findByRole("heading", { name: "Editors · 0" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Preview links · 0" }),
    ).toBeInTheDocument();
    expect(listCalls(`/api/editor/editors?siteId=${SITE_ID}`)).toBe(1);
    expect(listCalls(`/api/staging/access?siteId=${SITE_ID}`)).toBe(1);
  });

  it("disables both for a member who is not an admin, and says why", () => {
    renderWithSite(
      <SitePeoplePage />,
      buildSiteContext({
        site: buildSite({ siteToken: undefined, embedScript: undefined }),
      }),
    );

    const section = accessSection();
    for (const action of within(section).getAllByRole("button")) {
      expect(action).toBeDisabled();
    }
    expect(
      within(section).getByText("Only this site's admins can give access."),
    ).toBeInTheDocument();
  });

  it("refetches the editors once Add editor succeeds", async () => {
    const user = userEvent.setup();
    renderWithSite(<SitePeoplePage />);
    await screen.findByRole("heading", { name: "Editors · 0" });

    await user.click(
      within(accessSection()).getByRole("button", { name: "Add editor" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/editor email/i),
      "grace@example.com",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /add editor/i }),
    );

    expect(
      await within(dialog).findByText(
        "We emailed grace@example.com an invitation.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(listCalls(`/api/editor/editors?siteId=${SITE_ID}`)).toBe(2),
    );
  });

  it("refetches the preview links once Share preview link succeeds", async () => {
    const user = userEvent.setup();
    renderWithSite(<SitePeoplePage />);
    await screen.findByRole("heading", { name: "Preview links · 0" });

    await user.click(
      within(accessSection()).getByRole("button", {
        name: "Share preview link",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Email address"),
      "reviewer@example.com",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create link" }),
    );

    expect(
      await within(dialog).findByText("Invite sent successfully!"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(listCalls(`/api/staging/access?siteId=${SITE_ID}`)).toBe(2),
    );
  });
});
