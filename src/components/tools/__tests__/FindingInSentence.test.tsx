import { render, screen } from "@testing-library/react";
import { createFinding } from "@/lib/tools/lens";
import { FindingInSentence } from "../FindingInSentence";

const HOSTILE = '<img src=x onerror=alert(1)><script>alert("x")</script>';

describe("FindingInSentence", () => {
  it("renders hostile page text as text, never as markup", () => {
    const { container } = render(
      <FindingInSentence
        finding={createFinding({
          page: "https://example.com/",
          kind: "typo",
          match: "<b>recieve</b>",
          before: HOSTILE,
          after: ' <a href="javascript:alert(1)">x</a>',
          suggestion: "<i>receive</i>",
        })}
      />,
    );

    expect(container.querySelector("img, script, b, i, a")).toBeNull();
    expect(container.textContent).toContain(HOSTILE);
    expect(container.textContent).toContain("<b>recieve</b>");
  });

  it("wraps only the match in <mark>, with where it starts and ends for screen readers", () => {
    const { container } = render(
      <FindingInSentence
        finding={createFinding({
          page: "https://example.com/",
          kind: "typo",
          match: "recieve",
          before: "We ",
          after: " orders.",
        })}
      />,
    );

    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe(
      "Start of possible typo: recieve (end of possible typo)",
    );
    expect(container.querySelector("p")?.textContent).toBe(
      "We Start of possible typo: recieve (end of possible typo) orders.",
    );
  });

  it("shows the suggestion", () => {
    render(
      <FindingInSentence
        finding={createFinding({
          page: "https://example.com/",
          kind: "repeated",
          match: "the the",
          before: "",
          after: "",
          suggestion: "the",
        })}
      />,
    );

    expect(screen.getByText("Suggestion:").textContent).toBe("Suggestion: the");
    expect(screen.getByText(/start of repeated word/i)).toBeInTheDocument();
  });
});
