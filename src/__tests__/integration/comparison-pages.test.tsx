import { render, screen, within } from "@testing-library/react";
import CompareIndexPage, {
  metadata as indexMetadata,
} from "@/app/compare/page";
import WebflowEditorPage, {
  metadata as webflowMetadata,
} from "@/app/compare/webflow-editor/page";
import DudaPage, { metadata as dudaMetadata } from "@/app/compare/duda/page";
import TinaCmsPage, {
  metadata as tinaMetadata,
} from "@/app/compare/tinacms/page";
import CloudCannonPage, {
  metadata as cloudCannonMetadata,
} from "@/app/compare/cloudcannon/page";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

const routes = [
  {
    slug: "webflow-editor",
    name: "Webflow",
    Page: WebflowEditorPage,
    metadata: webflowMetadata,
    shortAnswer: /choose Webflow when you need to design or rebuild/i,
    competitorFit: /visual site building, CMS, and hosting/i,
  },
  {
    slug: "duda",
    name: "Duda",
    Page: DudaPage,
    metadata: dudaMetadata,
    shortAnswer: /choose Duda when your agency wants one visual builder/i,
    competitorFit: /build and manage client sites in one visual platform/i,
  },
  {
    slug: "tinacms",
    name: "TinaCMS",
    Page: TinaCmsPage,
    metadata: tinaMetadata,
    shortAnswer: /choose TinaCMS when Git-backed structured content/i,
    competitorFit: /content in Git with developer-defined schemas/i,
  },
  {
    slug: "cloudcannon",
    name: "CloudCannon",
    Page: CloudCannonPage,
    metadata: cloudCannonMetadata,
    shortAnswer: /choose CloudCannon when a Git-based visual CMS/i,
    competitorFit: /Git and static-site workflow/i,
  },
] as const;

function expectMetadata(
  metadata: (typeof routes)[number]["metadata"],
  slug: string,
) {
  const canonical = `/compare/${slug}`;

  expect(metadata.alternates).toMatchObject({ canonical });
  expect(metadata.openGraph).toMatchObject({
    url: canonical,
    type: "website",
    images: ["/opengraph-image"],
  });
  expect(metadata.twitter).toMatchObject({
    card: "summary_large_image",
    images: ["/twitter-image"],
  });
}

function expectFaqJsonLdMatchesVisibleFaq() {
  const script = document.querySelector('script[type="application/ld+json"]');
  expect(script).not.toBeNull();

  const schema = JSON.parse(script?.textContent ?? "null") as {
    "@context": string;
    "@type": string;
    mainEntity: Array<{
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }>;
  };

  expect(schema).toMatchObject({
    "@context": "https://schema.org",
    "@type": "FAQPage",
  });
  expect(schema.mainEntity.length).toBeGreaterThanOrEqual(3);

  for (const item of schema.mainEntity) {
    expect(item["@type"]).toBe("Question");
    expect(item.acceptedAnswer["@type"]).toBe("Answer");
    expect(screen.getByText(item.name)).toBeInTheDocument();
    expect(screen.getByText(item.acceptedAnswer.text)).toBeInTheDocument();
  }
}

describe("comparison marketing pages", () => {
  it("renders a comparison index with every supported alternative", () => {
    render(<CompareIndexPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /compare website editing tools/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/start with the workflow you need to preserve/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: /website editing options/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /when to choose a platform/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /when to choose ReCopyFast/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/product information checked as of 2026-09/i),
    ).toBeInTheDocument();

    for (const route of routes) {
      expect(
        screen.getByRole("link", { name: new RegExp(route.name, "i") }),
      ).toHaveAttribute("href", `/compare/${route.slug}`);
    }

    expect(
      screen.getByRole("link", { name: /start with recopyfast/i }),
    ).toHaveAttribute("href", "/signup");
    expect(
      screen.getByRole("link", { name: /try it on a site/i }),
    ).toHaveAttribute("href", "/try");
    expect(indexMetadata.alternates).toMatchObject({ canonical: "/compare" });
    expect(indexMetadata.openGraph).toMatchObject({ url: "/compare" });
    expect(indexMetadata.title).toBe("Compare website editing tools");
    expectFaqJsonLdMatchesVisibleFaq();
  });

  it.each(routes)(
    "renders the dated, fair $name comparison with valid matching FAQ schema",
    ({ slug, name, Page, metadata, shortAnswer, competitorFit }) => {
      render(<Page />);

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: new RegExp(`ReCopyFast vs ${name}`, "i"),
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(shortAnswer)).toBeInTheDocument();
      expect(
        screen.getByText(/product information checked as of 2026-09/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: new RegExp(`When to choose ${name}`, "i"),
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(competitorFit)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: /when to choose ReCopyFast/i,
        }),
      ).toBeInTheDocument();

      const table = screen.getByRole("table", {
        name: new RegExp(`ReCopyFast and ${name}`, "i"),
      });
      expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
      expect(
        within(table).getAllByRole("rowheader").length,
      ).toBeGreaterThanOrEqual(4);

      expect(
        screen.getAllByText(/\$49\/month for 10 sites/i).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getAllByText(/\$299 lifetime/i).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText(
          /requires permission to add a script and a compatible Content Security Policy/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /current ReCopyFast pricing/i }),
      ).toHaveAttribute("href", "/#pricing");
      expect(
        screen.getByRole("link", { name: /start with ReCopyFast/i }),
      ).toHaveAttribute("href", "/signup");
      expect(
        screen.getByRole("link", { name: /try ReCopyFast/i }),
      ).toHaveAttribute("href", "/try");

      const related = screen.getByRole("navigation", {
        name: /related comparisons/i,
      });
      for (const sibling of routes) {
        expect(
          within(related).getByRole("link", {
            name: new RegExp(sibling.name, "i"),
          }),
        ).toHaveAttribute("href", `/compare/${sibling.slug}`);
      }

      const officialSources = screen.getByRole("list", {
        name: /official sources/i,
      });
      const externalLinks = within(officialSources).getAllByRole("link");
      expect(externalLinks.length).toBeGreaterThanOrEqual(2);
      for (const link of externalLinks) {
        expect(link).toHaveAttribute(
          "href",
          expect.stringMatching(/^https:\/\//),
        );
      }

      expectFaqJsonLdMatchesVisibleFaq();
      expectMetadata(metadata, slug);
    },
  );

  it("documents the current Webflow content-editor account flow and legacy Editor retirement", () => {
    render(<WebflowEditorPage />);

    expect(
      screen.getByText(/legacy Webflow Editor retired on August 4, 2026/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /accept an invitation and sign in to or create a Webflow account/i,
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("credits CloudCannon client sharing as a no-account option", () => {
    render(<CloudCannonPage />);

    expect(
      screen.getByText(
        /Client Sharing can let clients edit without a CloudCannon account/i,
      ),
    ).toBeInTheDocument();
  });

  it("publishes unique canonical and social titles for every comparison route", () => {
    const metadata = routes.map((route) => route.metadata);
    const titles = metadata.map((item) => item.openGraph?.title);
    const canonicals = metadata.map((item) => item.alternates?.canonical);

    expect(new Set(titles).size).toBe(routes.length);
    expect(new Set(canonicals).size).toBe(routes.length);
  });
});
