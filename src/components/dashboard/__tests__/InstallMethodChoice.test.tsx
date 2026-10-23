import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallMethodChoice } from "../InstallMethodChoice";
import { trackGoal } from "@/lib/analytics/datafast-client";
import { buildEmbedScript } from "@/lib/sites/embed-script";
import { CREDENTIAL_PATTERNS } from "@/lib/sites/developer-handoff-message";

jest.mock("@/lib/analytics/datafast-client", () => ({
  trackGoal: jest.fn(),
}));

const mockedTrackGoal = jest.mocked(trackGoal);

const SITE_ID = "6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c";
const SCRIPT = buildEmbedScript({
  siteId: SITE_ID,
  siteToken: `${SITE_ID}.1761100000.${"ab".repeat(32)}`,
  appUrl: "https://www.recopyfa.st",
  wsUrl: "wss://recopyfast-ws.fly.dev",
});

function renderChoice(embedScript = SCRIPT) {
  return render(
    <InstallMethodChoice
      embedScript={embedScript}
      siteDomain="www.bellavista.example"
      location="dashboard_site"
    >
      <p>Do-it-yourself steps</p>
    </InstallMethodChoice>,
  );
}

beforeEach(() => {
  mockedTrackGoal.mockClear();
});

describe("InstallMethodChoice", () => {
  it("asks who will add the line, as a labelled radio group defaulting to self", () => {
    renderChoice();

    const group = screen.getByRole("group", {
      name: "Who will add the line to your site?",
    });
    expect(
      within(group).getByRole("radio", { name: /I'll do it myself/ }),
    ).toBeChecked();
    expect(
      within(group).getByRole("radio", { name: /My developer will/ }),
    ).not.toBeChecked();
    expect(screen.getByText("Do-it-yourself steps")).toBeInTheDocument();
    expect(screen.queryByTestId("developer-handoff-message")).toBeNull();
    expect(mockedTrackGoal).not.toHaveBeenCalled();
  });

  it("swaps the steps for a ready-to-send message and records the choice", async () => {
    const user = userEvent.setup();
    renderChoice();

    await user.click(screen.getByRole("radio", { name: /My developer will/ }));

    expect(screen.queryByText("Do-it-yourself steps")).toBeNull();
    const message = screen.getByTestId("developer-handoff-message");
    expect(message).toHaveTextContent(
      "Could you add one line to www.bellavista.example? (ReCopyFast)",
    );
    expect(message).toHaveTextContent(SCRIPT);
    expect(mockedTrackGoal).toHaveBeenCalledWith("install_method_selected", {
      method: "developer",
      location: "dashboard_site",
    });

    await user.click(screen.getByRole("radio", { name: /I'll do it myself/ }));
    expect(screen.getByText("Do-it-yourself steps")).toBeInTheDocument();
    expect(mockedTrackGoal).toHaveBeenLastCalledWith(
      "install_method_selected",
      { method: "self", location: "dashboard_site" },
    );
  });

  it("is keyboard operable", async () => {
    const user = userEvent.setup();
    renderChoice();

    await user.tab();
    expect(
      screen.getByRole("radio", { name: /I'll do it myself/ }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("radio", { name: /My developer will/ }),
    ).toBeChecked();
    expect(screen.getByTestId("developer-handoff-message")).toBeInTheDocument();
  });

  it("copies the full message and records the copy", async () => {
    const user = userEvent.setup();
    // After setup: userEvent installs its own clipboard stub.
    const writeText = jest
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderChoice();
    await user.click(screen.getByRole("radio", { name: /My developer will/ }));

    await user.click(screen.getByRole("button", { name: "Copy message" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.startsWith("Subject: Could you add one line")).toBe(true);
    expect(copied).toContain(SCRIPT);
    for (const pattern of CREDENTIAL_PATTERNS) {
      expect([pattern.source, pattern.test(copied)]).toEqual([
        pattern.source,
        false,
      ]);
    }
    expect(mockedTrackGoal).toHaveBeenCalledWith("developer_message_copied", {
      location: "dashboard_site",
    });
  });

  it("opens the owner's own email app with an encoded draft", async () => {
    const user = userEvent.setup();
    renderChoice();
    await user.click(screen.getByRole("radio", { name: /My developer will/ }));

    const link = screen.getByRole("link", { name: "Open in my email app" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(href.length).toBeLessThanOrEqual(2000);
    // No recipient: the owner chooses who to send it to.
    expect(href.startsWith("mailto:?")).toBe(true);
    expect(
      screen.getByText(/Email links have a length limit/),
    ).toBeInTheDocument();

    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(mockedTrackGoal).toHaveBeenCalledWith("developer_message_emailed", {
      location: "dashboard_site",
      body: "short",
    });
  });

  it("refuses to build a message around a snippet it did not generate", async () => {
    const user = userEvent.setup();
    renderChoice('<script src="test.js"></script>');
    await user.click(screen.getByRole("radio", { name: /My developer will/ }));

    expect(
      screen.getByText("We couldn't prepare the message"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open in my email app" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });
});
