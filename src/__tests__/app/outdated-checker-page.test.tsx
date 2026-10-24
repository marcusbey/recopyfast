/**
 * s99 — the Outdated Website Checker page follows the shared free-tool shell,
 * states its precision limits and keeps visible FAQ copy identical to JSON-LD.
 */

import { render, screen, within } from "@testing-library/react";
import OutdatedCheckerPage, {
  metadata,
} from "@/app/tools/outdated-website-checker/page";

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
const PATH = "/tools/outdated-website-checker";

const FAQS = [
  {
    question: "Which pages does it check?",
    answer:
      "Your homepage plus up to nine public pages on the same host, taken from the sitemap or homepage links.",
  },
  {
    question: "Does every old date mean the page is outdated?",
    answer:
      "No. A date is flagged only when nearby wording still presents it as upcoming, bookable, a deadline, a current price or a promotion. Blog dates and company history are left alone.",
  },
  {
    question: "How are month-only dates treated?",
    answer:
      "A month such as “October 2026” is not past until that month has ended in UTC.",
  },
  {
    question: "Does it read text added by JavaScript?",
    answer:
      "No. It reads the HTML the server sends. Pages or lines not present there cannot be checked.",
  },
  {
    question: "Does it check other languages?",
    answer:
      "No. A page that declares another language, or whose prose does not look English, is listed as not checked.",
  },
] as const;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = SITE;
});

function renderPage() {
  return render(<OutdatedCheckerPage />);
}

function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
    (node) => JSON.parse(node.textContent ?? "{}"),
  );
}

describe("/tools/outdated-website-checker", () => {
  it("has the exact title, intro and scan action", () => {
    renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Is your website out of date?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Check up to ten public pages for dates, prices and promotions that may have passed. Each result shows the exact line and why it was flagged.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Website address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for outdated copy" }),
    ).toBeInTheDocument();
  });

  it("states every designed check and leaves-alone boundary", () => {
    renderPage();
    const checks = screen.getByRole("heading", {
      name: "What it checks",
    }).parentElement;
    const leaves = screen.getByRole("heading", {
      name: "What it leaves alone",
    }).parentElement;

    expect(checks).not.toBeNull();
    expect(leaves).not.toBeNull();
    for (const copy of [
      /copyright years behind the current year/i,
      /past dates still described as upcoming, bookable or a deadline/i,
      /year-stamped prices, rates, menus and schedules/i,
      /coming.*opening.*launching.*past year/i,
      /past-year and clearly out-of-season promotions/i,
      /last updated.*more than two calendar years old.*information/i,
    ]) {
      expect(within(checks as HTMLElement).getByText(copy)).toBeInTheDocument();
    }
    for (const copy of [
      /blog and publication dates without future\/deadline wording/i,
      /since 2015.*founded in 2015/i,
      /numeric slash dates.*03\/04\/2025/i,
      /non-English pages/i,
      /warning means.*review this line.*page is wrong/i,
    ]) {
      expect(within(leaves as HTMLElement).getByText(copy)).toBeInTheDocument();
    }
    expect(leaves).toHaveTextContent(
      "It checks the HTML as sent by the server. JavaScript is not run.",
    );
  });

  it("uses its own canonical and Open Graph URL", () => {
    expect(metadata.alternates?.canonical).toBe(PATH);
    expect((metadata.openGraph as { url?: string }).url).toBe(PATH);
    expect(metadata.robots).toBeUndefined();
  });

  it("emits WebApplication, BreadcrumbList and the same FAQ it renders", () => {
    const { container } = renderPage();
    const blocks = jsonLd(container);

    expect(blocks.map((block) => block["@type"])).toEqual([
      "WebApplication",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(blocks[0]).toMatchObject({
      url: `${SITE}${PATH}`,
      name: "Is your website out of date?",
      isAccessibleForFree: true,
    });
    expect(
      (blocks[1].itemListElement as { name: string }[]).map(
        (item) => item.name,
      ),
    ).toEqual(["Home", "Free tools", "Is your website out of date?"]);
    const structuredFaq = (
      blocks[2].mainEntity as {
        name: string;
        acceptedAnswer: { text: string };
      }[]
    ).map((item) => ({
      question: item.name,
      answer: item.acceptedAnswer.text,
    }));
    expect(structuredFaq).toEqual(FAQS);
    for (const faq of FAQS) {
      expect(screen.getByText(faq.question)).toBeInTheDocument();
      expect(screen.getByText(faq.answer)).toBeInTheDocument();
    }
  });

  it("makes none of the launch claims the tools surface forbids", () => {
    const { container } = renderPage();
    const text =
      `${container.textContent} ${JSON.stringify(metadata)}`.toLowerCase();

    for (const claim of [
      "a/b",
      "split test",
      "translat",
      "works everywhere",
      "any website",
      "money-back",
      "audit log",
      "role-based",
      "free plan",
      "free forever",
      "no login",
      "instantly",
    ]) {
      expect([claim, text.includes(claim)]).toEqual([claim, false]);
    }
  });
});
