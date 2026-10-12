/**
 * s107 — `try_started`: the /try sample preview became active.
 *
 * Sent from our own page only, when the sample's runtime reports itself
 * active. The bookmarklet path runs on third-party pages, where no analytics
 * of ours ever loads, so it sends nothing.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockTrack = jest.fn();
jest.mock("@/lib/analytics/google-analytics/gtag", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import { TryExperience } from "@/components/try/TryExperience";

type PreviewWindow = Window & {
  __rcfTryPreview?: { exit: () => void; resume: () => void };
};

function pendingRuntime(): HTMLScriptElement {
  const script = document.querySelector<HTMLScriptElement>(
    'script[src="/try/rcf-try.js"]',
  );
  if (!script) throw new Error("the sample runtime was not requested");
  return script;
}

beforeEach(() => {
  mockTrack.mockClear();
  delete (window as PreviewWindow).__rcfTryPreview;
});

describe("TryExperience analytics", () => {
  it("sends try_started once the sample preview is active", async () => {
    const user = userEvent.setup();
    render(<TryExperience />);

    await user.click(screen.getByRole("button", { name: "Edit this sample" }));
    expect(mockTrack).not.toHaveBeenCalled();

    (window as PreviewWindow).__rcfTryPreview = {
      exit: jest.fn(),
      resume: jest.fn(),
    };
    act(() => {
      pendingRuntime().onload?.(new Event("load"));
    });

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("try_started", {});
  });

  it("sends nothing when the preview fails to start", async () => {
    const user = userEvent.setup();
    render(<TryExperience />);

    await user.click(screen.getByRole("button", { name: "Edit this sample" }));
    act(() => {
      pendingRuntime().onerror?.(new Event("error"));
    });

    expect(mockTrack).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "The preview could not load. Reload this page and try again.",
      ),
    ).toBeInTheDocument();
  });
});
