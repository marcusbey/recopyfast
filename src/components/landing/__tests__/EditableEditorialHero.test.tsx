import { act, fireEvent, render, screen } from "@testing-library/react";
import EditableEditorialHero from "../EditableEditorialHero";

const originalAnimate = Element.prototype.animate;

function setReducedMotion(matches: boolean) {
  jest.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && matches,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe("EditableEditorialHero", () => {
  let cancelAnimation: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    setReducedMotion(false);
    cancelAnimation = jest.fn();
    Element.prototype.animate = jest.fn().mockImplementation(
      () =>
        ({
          cancel: cancelAnimation,
          finished: Promise.resolve(),
        }) as unknown as Animation,
    );
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    Element.prototype.animate = originalAnimate;
  });

  async function advanceToText(text: string, maxSteps = 30) {
    for (let step = 0; step < maxSteps; step += 1) {
      if (screen.queryByText(text)) return;
      await act(async () => {
        await jest.advanceTimersToNextTimerAsync();
      });
    }
  }

  it("renders three editable headline lines and browser-local supporting copy", () => {
    render(<EditableEditorialHero />);

    const headlineLines = screen.getAllByRole("textbox", {
      name: /headline line/i,
    });
    expect(headlineLines).toHaveLength(3);
    expect(headlineLines.map((line) => line.textContent)).toEqual([
      "You built the site.",
      "Now you’re stuck",
      "updating it.",
    ]);
    expect(
      screen.getAllByRole("textbox", { name: /supporting text line/i }),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /reset|replay/i })).toBeNull();
  });

  it("links the secondary hero action to the product walkthrough", () => {
    render(<EditableEditorialHero />);

    expect(
      screen.getByRole("link", { name: "See how it works" }),
    ).toHaveAttribute("href", "#product-tour");
  });

  it("prevents line breaks and inserts pasted text as plaintext", () => {
    render(<EditableEditorialHero />);
    const firstLine = screen.getByRole("textbox", { name: "Headline line 1" });

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    firstLine.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);

    firstLine.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(firstLine);
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(firstLine, {
      clipboardData: { getData: () => "A better\nwebsite" },
    });
    expect(firstLine).toHaveTextContent("A better website");
  });

  it("does not start the automatic edit when reduced motion is requested", () => {
    setReducedMotion(true);
    render(<EditableEditorialHero />);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("site")).toBeInTheDocument();
    expect(screen.getByText("stuck")).toBeInTheDocument();
    expect(screen.queryByText("website")).toBeNull();
  });

  it("cancels the pending automatic sequence on real interaction", () => {
    render(<EditableEditorialHero />);
    const line = screen.getByRole("textbox", { name: "Headline line 1" });

    fireEvent.pointerDown(line);
    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("site")).toBeInTheDocument();
    expect(screen.queryByText("website")).toBeNull();
  });

  it("demonstrates site to website before stuck to done", async () => {
    render(<EditableEditorialHero />);

    await advanceToText("website");
    expect(screen.getByText("website")).toBeInTheDocument();
    expect(screen.getByText("stuck")).toBeInTheDocument();

    await advanceToText("done");
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("never overwrites a visitor edit made between the two passes", async () => {
    render(<EditableEditorialHero />);
    await advanceToText("website");

    const secondLine = screen.getByRole("textbox", { name: "Headline line 2" });
    secondLine.textContent = "Now this is mine";
    fireEvent.input(secondLine);
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(secondLine).toHaveTextContent("Now this is mine");
    expect(screen.queryByText("done")).toBeNull();
  });

  it("settles a partial automatic word before a mid-typing visitor edit", async () => {
    render(<EditableEditorialHero />);
    const firstLine = screen.getByRole("textbox", { name: "Headline line 1" });

    for (let step = 0; step < 20; step += 1) {
      const site = firstLine.querySelector("span");
      if (
        site?.textContent &&
        !["site", "website"].includes(site.textContent)
      ) {
        break;
      }
      await act(async () => {
        await jest.advanceTimersToNextTimerAsync();
      });
    }

    fireEvent.pointerDown(firstLine);
    firstLine.textContent = "My visitor-written headline.";
    fireEvent.input(firstLine);
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(firstLine).toHaveTextContent("My visitor-written headline.");
  });

  it("does not normalize text until an IME composition ends", () => {
    render(<EditableEditorialHero />);
    const line = screen.getByRole("textbox", { name: "Headline line 3" });

    fireEvent.compositionStart(line);
    line.textContent = `編集中\n${"語".repeat(125)}`;
    fireEvent.input(line);
    expect(line.textContent).toContain("\n");
    expect(line.textContent?.length).toBeGreaterThan(120);

    fireEvent.compositionEnd(line);
    expect(line.textContent).not.toContain("\n");
    expect(line.textContent).toHaveLength(120);
  });

  it("stops and leaves a coherent word when the page becomes hidden", async () => {
    render(<EditableEditorialHero />);
    const firstLine = screen.getByRole("textbox", { name: "Headline line 1" });

    for (let step = 0; step < 20; step += 1) {
      const site = firstLine.querySelector("span");
      if (
        site?.textContent &&
        !["site", "website"].includes(site.textContent)
      ) {
        break;
      }
      await act(async () => {
        await jest.advanceTimersToNextTimerAsync();
      });
    }

    jest.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));

    expect(firstLine).toHaveTextContent("You built the website.");
    expect(screen.getByText("stuck")).toBeInTheDocument();
  });

  it("cancels active animation and timers when unmounted", async () => {
    Element.prototype.animate = jest.fn().mockImplementation(
      () =>
        ({
          cancel: cancelAnimation,
          finished: new Promise(() => undefined),
        }) as unknown as Animation,
    );
    const { unmount } = render(<EditableEditorialHero />);
    await act(async () => {
      await jest.advanceTimersToNextTimerAsync();
    });

    unmount();

    expect(cancelAnimation).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not persist or transmit visitor-written hero copy", () => {
    const storageSpy = jest.spyOn(Storage.prototype, "setItem");
    const fetchSpy = jest.spyOn(global, "fetch");
    render(<EditableEditorialHero />);
    const line = screen.getByRole("textbox", { name: "Headline line 3" });

    line.textContent = "This stays here.";
    fireEvent.input(line);

    expect(storageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
