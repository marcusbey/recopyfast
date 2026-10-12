/**
 * s96 — /tools and /tools/website-spell-checker meet the SEO bar and the claims
 * ledger: canonical and og:url to themselves, WebApplication + BreadcrumbList +
 * FAQPage JSON-LD whose FAQ is the visible one, "About our scanner" on the
 * hub, and nothing the launch kit forbids.
 */

import { render, screen, within } from "@testing-library/react";
import ToolsHubPage, { metadata as hubMetadata } from "@/app/tools/page";
import TypoPage, {
  metadata as typoMetadata,
} from "@/app/tools/website-spell-checker/page";
import { TOOL_CATALOGUE } from "@/lib/tools/catalogue";
import {
  ABOUT_SCANNER,
  HUB_FAQS,
  SCANNER_ROBOTS_RULE,
  TYPO_FAQS,
} from "@/lib/tools/pages-copy";
import { SCANNER_USER_AGENT } from "@/lib/tools/scanner-identity";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

const SITE = "https://www.recopyfa.st";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = SITE;
});

type JsonLd = Record<string, unknown> & { "@type": string };

function jsonLd(container: HTMLElement): JsonLd[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  ).map((script) => JSON.parse(script.textContent ?? "{}") as JsonLd);
}

const FORBIDDEN_CLAIMS = [
  // The llms-txt suite's list…
  "a/b",
  "split test",
  "translat",
  "works everywhere",
  "any website",
  "money-back",
  "audit log",
  "role-based",
  // …and the free tools' own (launch kit §11–12).
  "free plan",
  "free forever",
  "no login",
  "instantly",
];

const PAGES = [
  {
    name: "/tools",
    path: "/tools",
    metadata: hubMetadata,
    render: () => render(<ToolsHubPage />),
    faqs: HUB_FAQS,
    crumbs: ["Home", "Free tools"],
  },
  {
    name: "/tools/website-spell-checker",
    path: "/tools/website-spell-checker",
    metadata: typoMetadata,
    render: () => render(<TypoPage />),
    faqs: TYPO_FAQS,
    crumbs: ["Home", "Free tools", "Website Typo Finder"],
  },
];

describe.each(PAGES)("$name", (page) => {
  it("names itself as canonical and og:url", () => {
    expect(page.metadata.alternates?.canonical).toBe(page.path);
    expect((page.metadata.openGraph as { url?: string }).url).toBe(page.path);
    expect(page.metadata.robots).toBeUndefined();
  });

  it("states WebApplication, BreadcrumbList and the visible FAQ as FAQPage", () => {
    const { container } = page.render();
    const blocks = jsonLd(container);

    expect(blocks.map((block) => block["@type"])).toEqual([
      "WebApplication",
      "BreadcrumbList",
      "FAQPage",
    ]);
    const app = blocks[0];
    expect(app).toMatchObject({
      url: `${SITE}${page.path}`,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
    });
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("review");

    const crumbs = (blocks[1].itemListElement as { name: string }[]).map(
      (item) => item.name,
    );
    expect(crumbs).toEqual(page.crumbs);

    const faq = (
      blocks[2].mainEntity as {
        name: string;
        acceptedAnswer: { text: string };
      }[]
    ).map((item) => ({
      question: item.name,
      answer: item.acceptedAnswer.text,
    }));
    expect(faq).toEqual(
      page.faqs.map(({ question, answer }) => ({ question, answer })),
    );
    for (const { question, answer } of page.faqs) {
      expect(screen.getByText(question)).toBeInTheDocument();
      expect(screen.getByText(answer)).toBeInTheDocument();
    }
  });

  it("makes none of the forbidden claims", () => {
    const { container } = page.render();
    const text =
      `${container.textContent} ${JSON.stringify(page.metadata)}`.toLowerCase();

    for (const claim of FORBIDDEN_CLAIMS) {
      expect([claim, text.includes(claim)]).toEqual([claim, false]);
    }
  });
});

describe("/tools", () => {
  it("lists every live tool from the catalogue", () => {
    render(<ToolsHubPage />);

    for (const tool of TOOL_CATALOGUE) {
      expect(
        screen.getByRole("heading", { level: 2, name: tool.name }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: `Open the ${tool.name}` }),
      ).toHaveAttribute("href", `/tools/${tool.slug}`);
    }
  });

  it("explains the scanner: what it fetches, who it says it is, what is stored, and the robots.txt opt-out", () => {
    render(<ToolsHubPage />);

    const about = screen
      .getByRole("heading", { name: "About our scanner" })
      .closest("section");
    expect(about).not.toBeNull();
    const section = within(about as HTMLElement);
    expect(section.getByText(ABOUT_SCANNER.fetched)).toBeInTheDocument();
    expect(section.getByText(ABOUT_SCANNER.identity)).toBeInTheDocument();
    expect(section.getByText(ABOUT_SCANNER.stored)).toBeInTheDocument();
    expect(section.getByText(ABOUT_SCANNER.optOut)).toBeInTheDocument();
    expect(about?.textContent).toContain("User-agent: RecopyFastToolsBot");
    expect(ABOUT_SCANNER.identity).toContain(SCANNER_USER_AGENT);
    expect(SCANNER_ROBOTS_RULE).toBe(
      "User-agent: RecopyFastToolsBot\nDisallow: /",
    );
    // No contact address is published until support@ works (architect decision 3).
    expect(about?.textContent).not.toMatch(/@recopyfa\.st|mailto:/);
  });

  it("says no more than 24 requests, up to 30 days and the 24 h key, as the code does", () => {
    expect(ABOUT_SCANNER.fetched).toContain("never more than 24 requests");
    // s96 review (minor 4): the row ceiling can remove a report sooner.
    expect(ABOUT_SCANNER.stored).toContain("kept for up to 30 days");
    expect(HUB_FAQS[1].answer).toContain("kept for up to 30 days");
    expect(ABOUT_SCANNER.stored).toContain("kept for at most 24 hours");
  });
});

describe("/tools/website-spell-checker", () => {
  it("has the scan form", () => {
    render(<TypoPage />);

    expect(screen.getByLabelText("Website address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for typos" }),
    ).toBeInTheDocument();
  });
});
