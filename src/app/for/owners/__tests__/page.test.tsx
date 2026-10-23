import { render, screen, within } from "@testing-library/react";
import ForOwnersPage, { metadata } from "@/app/for/owners/page";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/for/owners",
}));

jest.mock("@/components/landing/InteractiveHero", () => ({
  __esModule: true,
  default: () => <div data-testid="real-interactive-demo" />,
}));

jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => <footer>Footer</footer>,
}));

function mockPricing(response: Partial<Response> & { json?: () => unknown }) {
  global.fetch = jest.fn().mockResolvedValue(response) as jest.Mock;
}

const PRICING = {
  ok: true,
  json: async () => ({
    plans: [
      { id: "starter", monthlyPrice: 9, currency: "usd" },
      { id: "pro", monthlyPrice: 19, currency: "usd" },
    ],
  }),
};

beforeEach(() => {
  // Pending by default: tests that don't read the price leave it loading.
  global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
});

function pageText(): string {
  return document.body.textContent ?? "";
}

describe("/for/owners", () => {
  it("names itself to search engines", () => {
    expect(metadata.alternates?.canonical).toBe("/for/owners");
    expect(metadata.openGraph).toMatchObject({ url: "/for/owners" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("leads with the owner headline, in one h1", async () => {
    mockPricing(PRICING);
    render(<ForOwnersPage />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(
      "Change your hours, prices and specials yourself — without waiting on your web developer.",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Stop paying $75 to fix a typo.",
      }),
    ).toBeInTheDocument();
    expect(pageText()).toContain(
      "Your developer adds one line, once. After that, the words are yours",
    );
    await screen.findByText(/\$9 a month/);
  });

  it("keeps headings in order: every h3 sits under an h2", () => {
    const { container } = render(<ForOwnersPage />);
    const levels = [
      ...container.querySelectorAll("main h1, main h2, main h3"),
    ].map((heading) => Number(heading.tagName[1]));

    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("tags every CTA as a DataFast cta_click with its location and target", () => {
    render(<ForOwnersPage />);

    const tries = screen.getAllByRole("link", {
      name: "Try it on your own site",
    });
    expect(tries.map((link) => link.getAttribute("href"))).toEqual([
      "/try",
      "/try",
    ]);
    expect(
      tries.map((link) => link.getAttribute("data-fast-goal-location")),
    ).toEqual(["owners_hero", "owners_final"]);
    for (const link of tries) {
      expect(link).toHaveAttribute("data-fast-goal", "cta_click");
      expect(link).toHaveAttribute("data-fast-goal-target", "try");
    }

    const starts = screen.getAllByRole("link", { name: "Start free" });
    expect(starts.map((link) => link.getAttribute("href"))).toEqual([
      "/signup",
      "/signup",
    ]);
    for (const link of starts) {
      expect(link).toHaveAttribute("data-fast-goal-target", "signup");
    }

    expect(
      screen.getByRole("link", { name: "Send this to your developer" }),
    ).toHaveAttribute("href", "#handoff");
    const handoff = screen.getByRole("region", {
      name: "Send this to your developer.",
    });
    expect(handoff).toHaveAttribute("id", "handoff");
    for (const link of within(handoff).getAllByRole("link")) {
      expect(link).toHaveAttribute("data-fast-goal-location", "owners_handoff");
      expect(link).toHaveAttribute("data-fast-goal-target", "docs");
    }
    expect(
      within(handoff).getByRole("link", { name: /Do it yourself/ }),
    ).toHaveAttribute("href", "/docs/install/wordpress");
  });

  it("reuses the real interactive demo", () => {
    render(<ForOwnersPage />);
    expect(screen.getByTestId("real-interactive-demo")).toBeInTheDocument();
  });

  it("is explicit about what can and cannot be changed", () => {
    render(<ForOwnersPage />);

    expect(
      screen.getByRole("heading", { name: "You can change" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "You can't change" }),
    ).toBeInTheDocument();
    expect(pageText()).toContain("New pages, new sections or new images");
  });

  it("answers SEO and developer updates truthfully, without promises", () => {
    render(<ForOwnersPage />);
    const text = pageText();

    expect(text).toContain(
      "applied in the visitor's browser just after the page loads",
    );
    expect(text).toContain("We don't promise any SEO benefit.");
    expect(text).toContain("We don't warn you about that yet.");
    expect(text).not.toMatch(/edits (always )?survive/i);
    expect(text).not.toMatch(/boost your (seo|ranking)/i);
  });

  it("never says 'take control' and invents no social proof", () => {
    render(<ForOwnersPage />);
    const text = pageText();

    expect(text).not.toMatch(/take control/i);
    expect(text).not.toMatch(
      /testimonial|trusted by|customers love|\d+\+? (businesses|customers)/i,
    );
  });

  it("is honest about built-in editors and lost access", () => {
    render(<ForOwnersPage />);
    const text = pageText();

    expect(text).toContain("Squarespace, Wix and Shopify");
    expect(text).toContain("you may not need us");
    expect(text).toContain("Then we can't help yet, honestly");
  });

  it("says so, with no number, when the price cannot be read", async () => {
    mockPricing({ ok: false, status: 503 });
    render(<ForOwnersPage />);

    expect(
      await screen.findByText(/couldn't load the current price/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("owner-starter-price").textContent).not.toMatch(
      /\$\d/,
    );
  });
});
