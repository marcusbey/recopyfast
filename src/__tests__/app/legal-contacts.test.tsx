import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import Terms from "@/app/terms/page";
import Privacy from "@/app/privacy/page";

/**
 * s50 — every contact address on /terms and /privacy reaches a real mailbox.
 *
 * Both pages listed addresses on recopyfast.com: security@, legal@, privacy@,
 * support@ and eu-representative@. That domain was never registered (NXDOMAIN),
 * so security and privacy reports bounced, and whoever registers it would
 * receive them. The product's domain is recopyfa.st, and the owner confirmed
 * two mailboxes there on 2026-09-28: support@ for customers, privacy@ for
 * everything legal, security and data-protection.
 *
 * The page bodies (audit logs, RBAC, the EU representative) are a separate
 * legal review; only the addresses and the dead status-page bullet change here.
 */

jest.mock("@/components/layout/Header", () => ({ Header: () => null }));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => null,
}));

afterEach(cleanup);

const SUPPORT = "support@recopyfa.st";
const PRIVACY = "privacy@recopyfa.st";

const PAGES = { terms: Terms, privacy: Privacy };

function mailtoLinks(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a[href^="mailto:"]'));
}

/** The address listed beside `element`, inside the same block. */
function addressBeside(element: HTMLElement): string | null | undefined {
  return element.parentElement
    ?.querySelector('a[href^="mailto:"]')
    ?.getAttribute("href");
}

function addressUnder(label: string) {
  return addressBeside(screen.getByRole("heading", { level: 4, name: label }));
}

describe("legal contact addresses", () => {
  it.each(["terms", "privacy"] as const)(
    "every address on /%s is support@ or privacy@recopyfa.st",
    (page) => {
      const Page = PAGES[page];
      const { container } = render(<Page />);

      const links = mailtoLinks(container);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const address = (link.getAttribute("href") ?? "").replace(
          /^mailto:/,
          "",
        );
        expect([SUPPORT, PRIVACY]).toContain(address);
        expect(link.textContent?.trim()).toBe(address);
      }
    },
  );

  it("routes customer support to support@ and everything legal to privacy@", () => {
    render(<Terms />);
    expect(addressUnder("General Support")).toBe(`mailto:${SUPPORT}`);
    for (const label of [
      "Legal Inquiries",
      "Security Issues",
      "Data Protection Officer",
    ]) {
      expect(addressUnder(label)).toBe(`mailto:${PRIVACY}`);
    }
    expect(addressBeside(screen.getByText("Security Contact:"))).toBe(
      `mailto:${PRIVACY}`,
    );
    cleanup();

    render(<Privacy />);
    expect(addressUnder("General Support")).toBe(`mailto:${SUPPORT}`);
    for (const label of [
      "Data Protection Officer",
      "Security Team",
      "EU Representative",
    ]) {
      expect(addressUnder(label)).toBe(`mailto:${PRIVACY}`);
    }
  });

  it("/terms no longer points at a status page", () => {
    const { container } = render(<Terms />);

    expect(container.textContent).not.toContain("Real-time status monitoring");
  });
});
