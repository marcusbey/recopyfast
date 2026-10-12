import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FALLBACK_ERROR, isReportPathFor, ToolScanForm } from "../ToolScanForm";

const REPORT =
  "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c";

const assign = jest.fn();
const fetchMock = jest.fn();

beforeEach(() => {
  assign.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

async function submit(url = "example.com") {
  const user = userEvent.setup();
  render(
    <ToolScanForm
      tool="website-spell-checker"
      submitLabel="Check for typos"
      navigate={assign}
    />,
  );
  await user.type(screen.getByLabelText("Website address"), url);
  await user.click(screen.getByRole("button", { name: "Check for typos" }));
}

describe("ToolScanForm", () => {
  it("has a labelled URL input and says the query string is left out", () => {
    render(
      <ToolScanForm
        tool="website-spell-checker"
        submitLabel="Check for typos"
      />,
    );

    const input = screen.getByLabelText("Website address");
    expect(input).toHaveAttribute("type", "url");
    expect(input).toHaveAccessibleDescription(
      /anything after a \? or # in the address is left out/i,
    );
  });

  it("posts the tool and the address as JSON", async () => {
    respond(200, { reportId: "x", reportUrl: REPORT, cached: false });

    await submit("example.com/?ref=1");

    expect(fetchMock).toHaveBeenCalledWith("/api/tools/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "website-spell-checker",
        url: "example.com/?ref=1",
      }),
    });
  });

  it("shows a pending state with a polite status while the scan runs", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((done) => (resolve = done)));

    await submit();

    expect(screen.getByRole("status")).toHaveTextContent(
      /scanning your pages/i,
    );
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
    await act(async () => {
      resolve({
        ok: true,
        status: 200,
        json: async () => ({ reportUrl: REPORT }),
      });
    });
  });

  it("enters the report as a new document", async () => {
    respond(200, { reportId: "x", reportUrl: REPORT, cached: true });

    await submit();

    await waitFor(() => expect(assign).toHaveBeenCalledWith(REPORT));
  });

  it.each([
    "https://evil.example/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c",
    "//evil.example/x",
    "/tools/csp-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c",
    "/tools/website-spell-checker/r/not-a-uuid",
    "javascript:alert(1)",
  ])("never follows %s", async (reportUrl) => {
    respond(200, { reportUrl });

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(FALLBACK_ERROR);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    [
      400,
      { error: "Enter a website address, like example.com." },
      "Enter a website address, like example.com.",
    ],
    [
      403,
      { error: "Scans can only be started from this site." },
      "Scans can only be started from this site.",
    ],
    [
      415,
      { error: "Send the scan request as JSON." },
      "Send the scan request as JSON.",
    ],
    [
      422,
      {
        error:
          "We couldn't find that website. Check the address and try again.",
        reason: "dns",
      },
      "We couldn't find that website. Check the address and try again.",
    ],
    [
      429,
      {
        error: "Rate limit exceeded",
        message: "You've used today's free scans. Try again tomorrow.",
      },
      "You've used today's free scans. Try again tomorrow.",
    ],
    [
      503,
      { error: "Scans are unavailable right now. Please try again shortly." },
      "Scans are unavailable right now. Please try again shortly.",
    ],
    [500, null, FALLBACK_ERROR],
  ])(
    "a %i shows the server's message in a destructive alert",
    async (status, body, message) => {
      respond(status, body);

      await submit();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(message);
      expect(alert.className).toMatch(/tone-danger/);
      expect(assign).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Check for typos" }),
      ).toBeEnabled();
    },
  );

  it("a network failure is an error, not a silent nothing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(FALLBACK_ERROR);
  });
});

it("by default enters the report with window.location.assign, a new document", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/tools/ToolScanForm.tsx"),
    "utf8",
  );

  expect(source).toMatch(
    /function enterDocument\(url: string\): void \{\s*window\.location\.assign\(url\);/,
  );
  expect(source).toContain("navigate = enterDocument");
  expect(source).not.toMatch(/useRouter|router\.push|from "next\/link"/);
});

describe("isReportPathFor", () => {
  it("accepts only this tool's same-origin report path", () => {
    expect(isReportPathFor("website-spell-checker", REPORT)).toBe(true);
    expect(isReportPathFor("csp-checker", REPORT)).toBe(false);
    expect(isReportPathFor("website-spell-checker", 42)).toBe(false);
  });
});
