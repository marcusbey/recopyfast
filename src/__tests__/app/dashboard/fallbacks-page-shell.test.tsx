/**
 * @jest-environment jsdom
 *
 * s66b1 PR review — the dashboard segment's fallbacks keep the frame.
 *
 * Next renders `dashboard/loading.tsx` while a route is pending and
 * `dashboard/error.tsx` after a page throws, each in place of the page inside
 * `dashboard/layout.tsx`. Every page renders one `PageShell` with one h1
 * (ADR 053), so a fallback without one showed a titleless page for as long as
 * it was on screen. Each now renders through the shell: one h1, inside the
 * shell's header, and its body as a direct child section of the shell.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as Sentry from "@sentry/nextjs";
import DashboardLoading from "@/app/dashboard/loading";
import DashboardError from "@/app/dashboard/error";

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function expectOneTitleInShell(name: string): HTMLElement {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveAccessibleName(name);
  expect(headings[0].closest("[data-page-header]")).not.toBeNull();
  const shell = headings[0].closest<HTMLElement>("[data-page-shell]");
  expect(shell).not.toBeNull();
  return shell as HTMLElement;
}

describe("dashboard loading fallback", () => {
  it("renders one h1 inside the page shell", () => {
    render(<DashboardLoading />);

    expectOneTitleInShell("Loading…");
  });

  it("announces the skeleton as a direct child section of the shell", () => {
    render(<DashboardLoading />);

    const shell = expectOneTitleInShell("Loading…");
    const status = screen.getByRole("status", { name: "Loading dashboard" });
    expect(status.parentElement).toBe(shell);
  });
});

describe("dashboard error fallback", () => {
  const error = Object.assign(new Error("boom"), { digest: "digest-1" });

  it("renders one h1 inside the page shell", () => {
    render(<DashboardError error={error} reset={jest.fn()} />);

    expectOneTitleInShell("Something went wrong");
  });

  it("keeps the recovery actions and the report inside the shell", () => {
    const reset = jest.fn();
    render(<DashboardError error={error} reset={reset} />);

    const shell = expectOneTitleInShell("Something went wrong");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(shell.contains(retry)).toBe(true);
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(
      shell.contains(screen.getByRole("link", { name: "Back to Dashboard" })),
    ).toBe(true);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
