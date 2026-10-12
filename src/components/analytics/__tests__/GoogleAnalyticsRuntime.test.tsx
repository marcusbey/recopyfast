/**
 * s107 — the Google Analytics runtime and its consent banner.
 *
 * What a visitor sees and what leaves the page, per situation:
 * - GA not configured, or a page off the allowlist: nothing, not even the
 *   init script;
 * - no consent needed (the hint from the init script): gtag.js is requested,
 *   no banner;
 * - consent needed and no stored choice: the banner, and nothing requested
 *   from Google until "Allow analytics";
 * - "Cookie settings" reopens it, moves focus into it, and Escape gives focus
 *   back.
 *
 * `next/script` is replaced by an element that records what would load, and
 * the gtag runtime by spies: the runtime's own behaviour is pinned in
 * `src/lib/analytics/google-analytics/__tests__/gtag.test.ts`.
 */

import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

const readyCallbacks = new Map<string, () => void>();
jest.mock("next/script", () => ({
  __esModule: true,
  default: ({
    id,
    src,
    onReady,
  }: {
    id: string;
    src: string;
    onReady?: () => void;
  }) => {
    if (onReady) readyCallbacks.set(id, onReady);
    return <script data-testid={id} data-src={src} />;
  },
}));

jest.mock("@/lib/analytics/google-analytics/gtag", () => {
  const actual = jest.requireActual("@/lib/analytics/google-analytics/gtag");
  return {
    ...actual,
    startGoogleAnalytics: jest.fn(),
    setAnalyticsActive: jest.fn(),
    trackPageView: jest.fn(),
    track: jest.fn(),
    applyConsentChoice: jest.fn(),
  };
});

import * as runtime from "@/lib/analytics/google-analytics/gtag";
import { GoogleAnalyticsRuntime } from "@/components/analytics/GoogleAnalyticsRuntime";

const ID = "G-TEST123456";

/** The shell (GoogleAnalytics.test.tsx) decides id and route; this is what it mounts. */
function GoogleAnalytics() {
  return <GoogleAnalyticsRuntime measurementId={ID} />;
}
const mocked = runtime as jest.Mocked<typeof runtime>;
const savedId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function setCookie(value: string): void {
  document.cookie = `rcf_analytics_consent=${value}; Path=/`;
}

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

/** What the init script leaves behind, then its onReady. */
function initScriptRuns({ consentRequired }: { consentRequired: boolean }) {
  (window as unknown as Record<string, unknown>).__rcfAnalytics = {
    consentRequired,
  };
  const ready = readyCallbacks.get("rcf-ga-init");
  if (!ready) throw new Error("the init script was never rendered");
  act(() => ready());
}

function banner() {
  return screen.queryByRole("region", { name: "Analytics cookies" });
}

beforeEach(() => {
  jest.clearAllMocks();
  readyCallbacks.clear();
  mockPathname = "/";
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
  delete (window as unknown as Record<string, unknown>).__rcfAnalytics;
  clearCookies();
});

afterAll(() => {
  if (savedId === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = savedId;
});

describe("off the allowlist (a second line behind the shell)", () => {
  it.each([
    "/dashboard",
    "/settings",
    "/login",
    "/signup",
    "/auth/error",
    "/edit",
  ])("renders nothing on %s", (pathname) => {
    mockPathname = pathname;

    const { container } = render(<GoogleAnalytics />);

    expect(container).toBeEmptyDOMElement();
    expect(readyCallbacks.size).toBe(0);
    expect(mocked.trackPageView).not.toHaveBeenCalled();
  });
});

describe("a visitor whose country needs no consent", () => {
  it("loads the init script first, then gtag.js, and sends the page view", () => {
    render(<GoogleAnalytics />);

    expect(screen.getByTestId("rcf-ga-init")).toHaveAttribute(
      "data-src",
      "/analytics/gtag-init.js",
    );
    expect(screen.queryByTestId("rcf-ga-gtag")).toBeNull();

    initScriptRuns({ consentRequired: false });

    expect(screen.getByTestId("rcf-ga-gtag")).toHaveAttribute(
      "data-src",
      `https://www.googletagmanager.com/gtag/js?id=${ID}`,
    );
    expect(mocked.startGoogleAnalytics).toHaveBeenCalledWith(ID, {
      choice: null,
    });
    expect(mocked.setAnalyticsActive).toHaveBeenLastCalledWith(ID, true);
    expect(mocked.trackPageView).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });

  it("sends nothing if they declined before", () => {
    setCookie("denied");
    render(<GoogleAnalytics />);

    initScriptRuns({ consentRequired: false });

    expect(screen.queryByTestId("rcf-ga-gtag")).toBeNull();
    expect(mocked.trackPageView).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("stops sending when unmounted (the shell leaves the allowlist)", () => {
    const { unmount } = render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: false });

    unmount();

    expect(mocked.setAnalyticsActive).toHaveBeenLastCalledWith(ID, false);
  });

  it("stops on a client navigation off the allowlist, and resumes on return", () => {
    const { rerender } = render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: false });

    mockPathname = "/settings";
    rerender(<GoogleAnalytics />);
    expect(mocked.setAnalyticsActive).toHaveBeenLastCalledWith(ID, false);

    mockPathname = "/blog";
    rerender(<GoogleAnalytics />);
    expect(mocked.setAnalyticsActive).toHaveBeenLastCalledWith(ID, true);
    expect(mocked.trackPageView).toHaveBeenCalledTimes(2);
  });

  it("tracks a click on a signup link as a lead", async () => {
    const user = userEvent.setup();
    render(
      <>
        {/* A native anchor, as on every marketing CTA (ADR 059). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/signup" data-cta-location="hero">
          Start your free trial
        </a>
        <GoogleAnalytics />
      </>,
    );
    initScriptRuns({ consentRequired: false });

    const link = screen.getByRole("link", { name: "Start your free trial" });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);

    expect(mocked.track).toHaveBeenCalledWith("generate_lead", {
      cta_location: "hero",
    });
  });
});

describe("a visitor whose country needs consent", () => {
  it("sees the banner and nothing is requested from Google", () => {
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    expect(banner()).toBeInTheDocument();
    expect(screen.queryByTestId("rcf-ga-gtag")).toBeNull();
    expect(mocked.startGoogleAnalytics).not.toHaveBeenCalled();
    expect(mocked.trackPageView).not.toHaveBeenCalled();
  });

  it("the banner is a named, described landmark with two equal answers", () => {
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    const region = banner();
    expect(region).toHaveAccessibleDescription(
      /Google Analytics to count visits/,
    );
    const buttons = within(region as HTMLElement).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Allow analytics",
      "Decline",
    ]);
    expect(buttons[0].className).toBe(buttons[1].className);
    expect(
      within(region as HTMLElement).getByRole("link", {
        name: "How we use analytics",
      }),
    ).toHaveAttribute("href", "/privacy#analytics");
    // Inserted inside a polite live region, so it is announced.
    expect(region?.closest("[aria-live='polite']")).not.toBeNull();
  });

  it("does not take focus on first display, and Escape does not dismiss it", async () => {
    const user = userEvent.setup();
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    expect(document.body).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(banner()).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close cookie settings" }),
    ).toBeNull();
  });

  it("Allow analytics, by keyboard: stores the choice, loads gtag.js, closes", async () => {
    const user = userEvent.setup();
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    await user.tab();
    expect(
      screen.getByRole("link", { name: "How we use analytics" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Allow analytics" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(mocked.applyConsentChoice).toHaveBeenCalledWith(ID, "granted");
    expect(mocked.startGoogleAnalytics).toHaveBeenCalledWith(ID, {
      choice: "granted",
    });
    expect(screen.getByTestId("rcf-ga-gtag")).toBeInTheDocument();
    expect(mocked.trackPageView).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });

  it("Decline: stores the choice, loads nothing, closes", async () => {
    const user = userEvent.setup();
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    await user.click(screen.getByRole("button", { name: "Decline" }));

    expect(mocked.applyConsentChoice).toHaveBeenCalledWith(ID, "denied");
    expect(screen.queryByTestId("rcf-ga-gtag")).toBeNull();
    expect(mocked.trackPageView).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("a stored choice means no banner on the next visit", () => {
    setCookie("granted");
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    expect(banner()).toBeNull();
    expect(screen.getByTestId("rcf-ga-gtag")).toBeInTheDocument();
  });
});

describe("Cookie settings", () => {
  it("reopens the banner, moves focus into it, and Escape returns focus", async () => {
    const user = userEvent.setup();
    setCookie("granted");
    render(
      <>
        <button type="button" onClick={() => runtime.openCookieSettings()}>
          Cookie settings
        </button>
        <GoogleAnalytics />
      </>,
    );
    initScriptRuns({ consentRequired: false });
    const trigger = screen.getByRole("button", { name: "Cookie settings" });

    await user.click(trigger);

    expect(banner()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allow analytics" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Allow analytics" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Decline" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.keyboard("{Escape}");

    expect(banner()).toBeNull();
    expect(trigger).toHaveFocus();
    expect(mocked.applyConsentChoice).not.toHaveBeenCalled();
  });

  it("the close button dismisses without changing the choice", async () => {
    const user = userEvent.setup();
    setCookie("denied");
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });
    act(() => runtime.openCookieSettings());

    await user.click(
      screen.getByRole("button", { name: "Close cookie settings" }),
    );

    expect(banner()).toBeNull();
    expect(mocked.applyConsentChoice).not.toHaveBeenCalled();
  });

  it("lets a visitor who declined change their mind", async () => {
    const user = userEvent.setup();
    setCookie("denied");
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: false });
    expect(screen.queryByTestId("rcf-ga-gtag")).toBeNull();

    act(() => runtime.openCookieSettings());
    await user.click(screen.getByRole("button", { name: "Allow analytics" }));

    expect(mocked.applyConsentChoice).toHaveBeenCalledWith(ID, "granted");
    expect(screen.getByTestId("rcf-ga-gtag")).toBeInTheDocument();
  });
});

describe("reserved space", () => {
  it("puts an aria-hidden spacer of the banner's height in the document flow", () => {
    render(<GoogleAnalytics />);
    initScriptRuns({ consentRequired: true });

    const panel = screen.getByTestId("consent-banner");
    const spacer = panel.previousElementSibling as HTMLElement;
    expect(spacer).toHaveAttribute("aria-hidden", "true");
    expect(panel.className).toMatch(/\bfixed\b/);
    expect(panel.className).toMatch(/\bbottom-0\b/);
  });
});
