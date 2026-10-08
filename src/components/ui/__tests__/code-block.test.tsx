/**
 * `CodeBlock` — new in s66a (design system, Code blocks and machine strings).
 *
 * The site-registered panel showed its 300-character snippet in a `<pre>` that
 * never wrapped, with the Copy button absolutely positioned at the far end of
 * it; together with the dialog's grid bug that put the only Copy button
 * 2,000 px off-screen (s66 research, fact 1). Six hand-rolled renderings used
 * two different wrapping strategies. This is the one: it wraps by default,
 * and Copy lives in a label bar, visible without hover, because touch has
 * no hover.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { CodeBlock } from "@/components/ui/code-block";

const SNIPPET =
  '<script src="https://www.recopyfa.st/embed/recopyfast.js" data-site-id="00000000-0000-4000-8000-000000000000" data-site-token="•••"></script>';

function mockClipboard(writeText: jest.Mock) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  });
}

afterEach(() => {
  jest.useRealTimers();
});

describe("CodeBlock", () => {
  it("renders the value and its label", () => {
    render(<CodeBlock value={SNIPPET} label="HTML" />);
    expect(screen.getByText(SNIPPET)).toBeInTheDocument();
    expect(screen.getByText("HTML")).toBeInTheDocument();
  });

  it("wraps by default, so a snippet can be read in full at 320px", () => {
    const { container } = render(<CodeBlock value={SNIPPET} label="HTML" />);
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
    expect(pre.className).not.toContain("overflow-x-auto");
    expect(container.firstElementChild).toHaveClass("min-w-0");
  });

  it("scrolls inside itself, never the panel, with wrap={false}", () => {
    const { container } = render(
      <CodeBlock value={SNIPPET} label="HTML" wrap={false} />,
    );
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre).toHaveClass("whitespace-pre", "overflow-x-auto");
    expect(pre.className).not.toContain("whitespace-pre-wrap");
  });

  it("keeps Copy in the label bar, always visible", () => {
    const { container } = render(<CodeBlock value={SNIPPET} label="HTML" />);
    const button = screen.getByRole("button", { name: "Copy" });
    const bar = button.parentElement as HTMLElement;

    expect(bar).toHaveTextContent("HTML");
    expect(bar.nextElementSibling).toBe(container.querySelector("pre"));
    expect(button.className).not.toMatch(/opacity-0|group-hover/);
    expect(bar.className).not.toMatch(/opacity-0|group-hover/);
  });

  it("copies exactly the value", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CodeBlock value={SNIPPET} label="HTML" />);

    await clickCopy();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(SNIPPET);
  });

  it('reads "Copied" for 2 seconds, then "Copy" again', async () => {
    jest.useFakeTimers();
    mockClipboard(jest.fn().mockResolvedValue(undefined));
    render(<CodeBlock value={SNIPPET} label="HTML" />);

    await clickCopy();
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1_999);
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it('says "Copy failed", never "Copied", and selects the code when the write is refused', async () => {
    mockClipboard(jest.fn().mockRejectedValue(new Error("NotAllowedError")));
    render(<CodeBlock value={SNIPPET} label="HTML" />);

    await clickCopy();

    expect(
      screen.getByRole("button", { name: "Copy failed" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    // Selected, so Cmd/Ctrl+C still works.
    expect(window.getSelection()?.toString()).toBe(SNIPPET);
  });
});
