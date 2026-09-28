import React from "react";
import { render, screen } from "@testing-library/react";
import Terms from "@/app/terms/page";
import Privacy from "@/app/privacy/page";

/**
 * s54 — /privacy and /terms say only what the product backs.
 *
 * Both pages were boilerplate written before the product existed. They promised
 * SOC 2 Type II, MFA "enforcement" while settings says two-factor is not
 * available, TLS 1.3 while Vercel and Fly both accept 1.2, audit logs, RBAC and
 * SIEM (PRD graveyard items with no surface), a 24/7 SOC, 99.9% uptime on a
 * one-machine WebSocket server, retention periods no job enforces, and an EU
 * representative who was our own mailbox. Signing in binds users to these
 * pages, so each of those was a promise we were breaking.
 *
 * - GRAVEYARD names features frozen in docs/prd.md. None has a customer
 *   surface, so neither page may describe one as something we run.
 * - UNBACKED holds the certifications, roles, controls, deadlines and
 *   retention periods s54 removed because nothing in the code, the config or
 *   the live infrastructure backs them. They are here so they cannot creep
 *   back as "standard" legal copy.
 * - "penetration testing" and "vulnerability" are not listed: the Terms §4
 *   prohibition ("you agree not to … penetration testing") legitimately stays.
 *
 * retired-promises.test.ts reads AST literals so that tombstone comments never
 * count. These pages are static server components, so a render gives the same
 * guarantee (JSX comments are not rendered) and reads exactly what a visitor
 * reads, attributes included, through innerHTML.
 *
 * This is a tripwire, not a proof: a paraphrase ("audit trail", "SOC2") slips
 * past it. The review reads the diff.
 */

jest.mock("@/components/layout/Header", () => ({ Header: () => null }));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => null,
}));

const PAGES = { privacy: Privacy, terms: Terms };
type PageName = keyof typeof PAGES;
const PAGE_NAMES = Object.keys(PAGES) as PageName[];

const TITLES: Record<PageName, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

const GRAVEYARD = [
  "audit log",
  "role-based",
  "rbac",
  "siem",
  "notification cent",
  "in-app notification",
  "org role",
  "organization role",
  "team role",
  "theme editor",
];

const UNBACKED = [
  // Certifications and roles nobody holds.
  "soc 2",
  "compliance",
  "certifi",
  "eu representative",
  "data protection officer",
  "security team",
  // Availability.
  "99.9",
  "redundant",
  "24/7",
  "backup systems",
  // Collection: IPs are stored raw, and only the parked A/B route derives a
  // location.
  "hashed",
  "geolocation",
  // Self-serve reach. Without a plan, the middleware sends every dashboard
  // page but Billing to checkout, so export and site deletion are not
  // reachable "anytime" (s54 review, major 1).
  "anytime",
  // Authentication and encryption.
  "tls 1.3",
  "multi-factor",
  "two-factor",
  "end-to-end encryption",
  "client-side encryption",
  "cryptographic erasure",
  "zero-trust",
  "intrusion detection",
  // Providers and cookies.
  "google cloud",
  "cookie consent",
  // Deadlines and retention.
  "within 72 hours",
  "within 24 hours",
  "within 90 days",
  "7 years",
  // Features.
  "multi-language",
];

const PROVIDERS = [
  "Vercel",
  "Supabase",
  "Fly.io",
  "Stripe",
  "OpenAI",
  "Resend",
  "Upstash",
  "Sentry",
];

function everyPageWith(phrases: string[]): [PageName, string][] {
  return PAGE_NAMES.flatMap((page) =>
    phrases.map((phrase): [PageName, string] => [page, phrase]),
  );
}

/** What a visitor reads: text and attributes, never source comments. */
function renderedHtml(page: PageName): string {
  const Page = PAGES[page];
  return render(<Page />).container.innerHTML;
}

describe("legal pages truth", () => {
  it.each(PAGE_NAMES)(
    "/%s renders its page, so an empty render cannot pass",
    (page) => {
      const Page = PAGES[page];
      render(<Page />);

      expect(
        screen.getByRole("heading", { level: 1, name: TITLES[page] }),
      ).toBeInTheDocument();
    },
  );

  it.each(everyPageWith(GRAVEYARD))(
    "/%s never names the graveyard feature %s",
    (page, phrase) => {
      expect(renderedHtml(page).toLowerCase()).not.toContain(phrase);
    },
  );

  it.each(everyPageWith(UNBACKED))(
    "/%s makes no unbacked claim: %s",
    (page, phrase) => {
      expect(renderedHtml(page).toLowerCase()).not.toContain(phrase);
    },
  );

  it.each(PROVIDERS)("/privacy lists %s as a service provider", (provider) => {
    const { container } = render(<Privacy />);

    const items = Array.from(container.querySelectorAll("li"), (li) =>
      (li.textContent ?? "").trim(),
    );
    expect(items.some((text) => text.startsWith(`${provider} — `))).toBe(true);
  });

  it("/privacy names no host it does not use", () => {
    const html = renderedHtml("privacy");

    // Case-sensitive: a lowercase "aws" is inside "laws".
    expect(html).not.toMatch(/\bAWS\b/);
    expect(html.toLowerCase()).not.toContain("google cloud");
  });

  it("/terms has no 9.2 promising what happens to data on termination", () => {
    render(<Terms />);

    expect(screen.queryByRole("heading", { name: /^9\.2\b/ })).toBeNull();
  });
});
