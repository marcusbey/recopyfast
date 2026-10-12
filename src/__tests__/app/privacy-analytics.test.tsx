import React from "react";
import { render, screen, within } from "@testing-library/react";
import Privacy from "@/app/privacy/page";
import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
} from "@/lib/analytics/google-analytics/consent";
import { GA_COOKIE_EXPIRES_SECONDS } from "@/lib/analytics/google-analytics/gtag";

/**
 * s107 — /privacy says what the Google Analytics code does, and only that.
 *
 * Each sentence here is pinned to the code or to a GA admin setting recorded
 * in docs/operations/analytics.md: which pages, what is collected, the consent
 * rule for the EEA/UK/CH, the cookie names and lifetimes, the 14-month
 * retention, and the three ways to opt out. legal-pages-truth.test.tsx keeps
 * the s54 tripwires (no "cookie consent", no "geolocation", no "anytime").
 */

jest.mock("@/components/layout/Header", () => ({ Header: () => null }));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => null,
}));

const DAY = 24 * 60 * 60;

function analyticsSection(): HTMLElement {
  render(<Privacy />);
  const heading = screen.getByRole("heading", { name: "Google Analytics" });
  const section = heading.closest("[id='analytics']");
  if (!(section instanceof HTMLElement)) {
    throw new Error("the Google Analytics disclosure has no #analytics anchor");
  }
  return section;
}

describe("/privacy — Google Analytics", () => {
  it("is reachable at /privacy#analytics, where the banner links", () => {
    expect(analyticsSection()).toBeInTheDocument();
  });

  it("names the pages it runs on and the ones it never runs on", () => {
    const text = analyticsSection().textContent ?? "";

    expect(text).toMatch(/public pages/);
    expect(text).toMatch(/dashboard/);
    expect(text).toMatch(/sign-in and sign-up pages/);
    expect(text).toMatch(/ReCopyFast script on your website/);
    // s96's scan reports: no analytics (ADR 063, architect decision).
    expect(text).toMatch(/free tool.s scan\s+report/);
    expect(text).toMatch(/never the address you scanned/);
  });

  it("says what is collected, without query strings or fragments", () => {
    const text = analyticsSection().textContent ?? "";

    expect(text).toMatch(/query string/);
    expect(text).toMatch(/utm_/);
    expect(text).toMatch(/approximate location/);
  });

  it("states the consent rule for the EEA, the UK and Switzerland", () => {
    const text = analyticsSection().textContent ?? "";

    expect(text).toMatch(
      /European Economic Area, the United Kingdom and Switzerland/,
    );
    expect(text).toMatch(/does not load until you choose .Allow analytics./);
  });

  it("names the cookies, with lifetimes that match the code", () => {
    const section = analyticsSection();
    const text = section.textContent ?? "";

    expect(text).toContain("_ga");
    expect(text).toContain("_ga_<");
    expect(text).toContain(CONSENT_COOKIE_NAME);
    expect(GA_COOKIE_EXPIRES_SECONDS).toBe(395 * DAY);
    expect(text).toMatch(/13 months/);
    expect(CONSENT_COOKIE_MAX_AGE_SECONDS).toBe(180 * DAY);
    expect(text).toMatch(/6 months/);
  });

  it("states the 14-month retention and that ads features are off", () => {
    const text = analyticsSection().textContent ?? "";

    expect(text).toMatch(/14 months/);
    expect(text).toMatch(/Google signals/);
    expect(text).toMatch(/no ads/i);
  });

  it("gives three ways to opt out, including Google's add-on", () => {
    const section = analyticsSection();
    const text = section.textContent ?? "";

    expect(text).toMatch(/Decline/);
    expect(text).toMatch(/Cookie settings/);
    expect(
      within(section).getByRole("link", {
        name: /Google Analytics opt-out browser add-on/,
      }),
    ).toHaveAttribute("href", "https://tools.google.com/dlpage/gaoptout");
  });

  it("lists Google Analytics among the service providers", () => {
    const { container } = render(<Privacy />);
    const items = Array.from(container.querySelectorAll("li"), (li) =>
      (li.textContent ?? "").trim(),
    );

    expect(items.some((text) => text.startsWith("Google Analytics — "))).toBe(
      true,
    );
  });
});
