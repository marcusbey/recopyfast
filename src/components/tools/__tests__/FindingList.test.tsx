import { render, screen } from "@testing-library/react";
import { createFinding, type Finding } from "@/lib/tools/lens";
import type { ToolReport } from "@/lib/tools/report/report-schema";
import { EXTERNAL_LINK_REL, FindingList } from "../FindingList";

function report(overrides: Partial<ToolReport> = {}): ToolReport {
  return {
    v: 1,
    tool: "website-spell-checker",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scannedAt: "2026-10-11T12:00:00.000Z",
    summary: {
      headline: "2 possible typos on 2 pages of 2",
      verdict: "warn",
      facts: [],
    },
    findings: [],
    pages: [],
    truncated: false,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ...createFinding({
      page: "https://example.com/",
      kind: "typo",
      match: "recieve",
      before: "We ",
      after: " orders.",
      suggestion: "receive",
    }),
    ...overrides,
  };
}

describe("FindingList", () => {
  it("groups findings by page, each page linked with the exact rel", () => {
    render(
      <FindingList
        report={report({
          findings: [
            finding(),
            finding({ match: "seperate" }),
            finding({ page: "https://example.com/menu", match: "teh" }),
          ],
        })}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/",
      "https://example.com/menu",
    ]);
    for (const link of links) {
      expect(link.getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
      expect(link.getAttribute("target")).toBe("_blank");
    }
    expect(EXTERNAL_LINK_REL).toBe("nofollow ugc noopener noreferrer");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("never links a page that is not http(s)", () => {
    render(
      <FindingList
        report={report({
          findings: [finding({ page: "javascript:alert(1)" })],
        })}
      />,
    );

    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("renders code in a CodeBlock", () => {
    render(
      <FindingList
        report={report({
          findings: [
            finding({ code: "script-src 'self' https://www.recopyfa.st" }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: /copy these lines/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("script-src 'self' https://www.recopyfa.st"),
    ).toBeInTheDocument();
  });

  it("shows an image as a 'View image' link and never as an <img>", () => {
    const { container } = render(
      <FindingList
        report={report({
          findings: [finding({ imageSrc: "https://cdn.example/a.png" })],
        })}
      />,
    );

    const view = screen.getByRole("link", { name: "View image" });
    expect(view.getAttribute("href")).toBe("https://cdn.example/a.png");
    expect(view.getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws zero findings as a success state, never an empty list", () => {
    render(
      <FindingList
        report={report({
          summary: {
            headline: "No likely typos on the 3 pages we checked",
            verdict: "pass",
            facts: [],
          },
        })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No likely typos on the 3 pages we checked",
    );
    expect(screen.getByRole("alert").className).toMatch(/tone-success/);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("draws a skipped report (not English, no text) as an info state", () => {
    render(
      <FindingList
        report={report({
          summary: {
            headline:
              "This page shows almost no text in its HTML — it may build its text with JavaScript, which this check doesn't run.",
            verdict: "skipped",
            facts: [],
          },
        })}
      />,
    );

    expect(screen.getByRole("alert").className).toMatch(/tone-info/);
    expect(screen.getByRole("alert")).toHaveTextContent(/almost no text/);
  });
});
