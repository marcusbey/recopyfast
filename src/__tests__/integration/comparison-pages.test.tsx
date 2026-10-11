import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import type { Metadata } from "next";
import CompareIndexPage, {
  metadata as indexMetadata,
} from "@/app/compare/page";
import ComparisonRoute, {
  revalidate as comparisonRevalidate,
} from "@/app/compare/[competitor]/page";
import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
  type ComparisonSlug,
} from "@/lib/compare/comparisons";
import {
  loadComparisonPricing,
  type ComparisonPricing,
} from "@/lib/compare/comparison-pricing";
import { loadCatalogueOffers } from "@/lib/seo/catalogue-offers";
import type { MonthlyOffer } from "@/lib/seo/json-ld";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/site-identity";

jest.mock("@/lib/compare/comparison-pricing", () => ({
  loadComparisonPricing: jest.fn(),
}));

jest.mock("@/lib/seo/catalogue-offers", () => ({
  loadCatalogueOffers: jest.fn(),
}));

const mockLoadComparisonPricing = jest.mocked(loadComparisonPricing);
const mockLoadCatalogueOffers = jest.mocked(loadCatalogueOffers);

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
    factsCheckedAsOf: "2026-09",
    shortAnswer: /choose Webflow when you need to design or rebuild/i,
    competitorFit: /visual site building, CMS, and hosting/i,
    deliveryDisclosure:
      "Choose Webflow when published edits must be served in the page's HTML. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.",
  },
  {
    slug: "duda",
    name: "Duda",
    factsCheckedAsOf: "2026-09",
    shortAnswer: /choose Duda when your agency wants one visual builder/i,
    competitorFit: /build and manage client sites in one visual platform/i,
    deliveryDisclosure:
      "Choose Duda when published edits must be served in the page's HTML. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.",
  },
  {
    slug: "tinacms",
    name: "TinaCMS",
    factsCheckedAsOf: "2026-09",
    shortAnswer: /choose TinaCMS when Git-backed structured content/i,
    competitorFit: /content in Git with developer-defined schemas/i,
    deliveryDisclosure:
      "Choose TinaCMS when its Git commits feed a site build and deployment that serves updated HTML. TinaCMS is headless, so delivery depends on that site setup. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.",
  },
  {
    slug: "cloudcannon",
    name: "CloudCannon",
    factsCheckedAsOf: "2026-09",
    shortAnswer: /choose CloudCannon when a Git-based visual CMS/i,
    competitorFit: /Git and static-site workflow/i,
    deliveryDisclosure:
      "Choose CloudCannon when published edits must be served in the page's HTML. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.",
  },
  {
    slug: "contentful",
    name: "Contentful",
    factsCheckedAsOf: "2026-10",
    shortAnswer: /choose Contentful when reusable structured content/i,
    competitorFit: /modeled content that can be reused/i,
    deliveryDisclosure:
      "Choose Contentful when published content should enter the frontend through a structured API. Whether it reaches visitors in served HTML depends on that frontend's rendering and deployment; ReCopyFast applies published edits in the browser after load.",
  },
  {
    slug: "storyblok",
    name: "Storyblok",
    factsCheckedAsOf: "2026-10",
    shortAnswer: /choose Storyblok when a headless content platform/i,
    competitorFit: /structured stories and reusable content blocks/i,
    deliveryDisclosure:
      "Choose Storyblok when its API content feeds a frontend that can render published updates into served HTML. ReCopyFast applies published edits in the visitor's browser after the page loads.",
  },
  {
    slug: "decap-cms",
    name: "Decap CMS",
    factsCheckedAsOf: "2026-10",
    shortAnswer: /choose Decap CMS when repository files/i,
    competitorFit: /content should stay as files in a Git repository/i,
    deliveryDisclosure:
      "Choose Decap CMS when commits feed a build that serves updated HTML. Decap CMS does not deliver the frontend itself; ReCopyFast applies published edits in the visitor's browser after page load.",
  },
] as const;

const expectedCompetitorRows = {
  "webflow-editor": {
    "Best at": "Visual design, site building, CMS, and hosting together.",
    Installation: "Build or run the site in Webflow.",
    "Client access":
      "Current content editors accept an invitation and sign in to or create a Webflow account.",
    Publishing:
      "Content editors can save drafts and publish to staging or production when Webflow permissions allow it.",
    "How published edits reach visitors":
      "Webflow publishes edits so they are served in the page's HTML, an advantage when JavaScript is unavailable or a crawler does not render it.",
    "Pricing model":
      "Site plans and Workspace or seat plans depend on the Webflow setup.",
  },
  duda: {
    "Best at": "Building and managing agency sites in a visual platform.",
    Installation: "Sites are built and managed through Duda.",
    "Client access":
      "On Team plans and higher, client accounts are unlimited; agencies assign them to sites with per-site permissions.",
    Publishing:
      "The visual editor supports preview plus Publish or Republish, subject to permissions.",
    "How published edits reach visitors":
      "Duda publishes edits so they are served in the page's HTML, an advantage when JavaScript is unavailable or a crawler does not render it.",
    "Pricing model":
      "Team plans and higher include unlimited client accounts. Platform subscriptions include site allowances, with additional published sites priced separately.",
  },
  tinacms: {
    "Best at": "Structured, Git-backed content in a developer-managed setup.",
    Installation:
      "Developers configure TinaCMS, its schema, content files, and visual editing integration.",
    "Editor access":
      "Editors are invited to the project; GitHub access and workflow depend on the setup and plan.",
    Publishing:
      "In TinaCloud production, saves commit directly to Git, or through Editorial Workflow when it is enabled.",
    "How published edits reach visitors":
      "In TinaCloud production, saves commit directly to Git, or through Editorial Workflow when it is enabled. Whether edits appear in served HTML depends on the site's build and deployment; statically built or server-rendered sites can serve the updated content after that workflow completes.",
    "Pricing model":
      "TinaCloud plans vary by project, user allowance, and workflow features.",
  },
  cloudcannon: {
    "Best at": "Visual editing for Git-backed and static-site workflows.",
    Installation:
      "Connect a repository and configure the site and editing experience.",
    "Client access":
      "Client Sharing can allow password-based access without a CloudCannon account; full users are also supported.",
    Publishing:
      "Repository syncing and publishing between site copies depend on the configured workflow.",
    "How published edits reach visitors":
      "CloudCannon syncs published content through the repository and build workflow so edits are served in the page's HTML, an advantage when JavaScript is unavailable or a crawler does not render it.",
    "Pricing model":
      "Plans bundle user allowances; extra users or site shares may vary by plan, and Standard lists unlimited sites.",
  },
  contentful: {
    "Best at":
      "Modeling reusable structured content for websites, apps, and other channels.",
    Installation:
      "Model content, integrate the delivery APIs or SDKs, and configure preview for the consuming frontend.",
    "Editor access":
      "Editors are invited organization users with role-based access. Custom permissions and advanced environment controls depend on the plan.",
    Publishing:
      "Publishing makes entries available through the Content Delivery API. Roles control who edits or publishes; workflow features depend on the plan.",
    "How published edits reach visitors":
      "Contentful delivers published content as JSON and media through its APIs. The site's rendering or build workflow determines whether visitors receive that content in served HTML.",
    "Pricing model":
      "Platform plans vary by spaces, users, roles, locales, API calls, bandwidth, and governance features.",
  },
  storyblok: {
    "Best at":
      "Component-based headless content with a visual preview and broader editorial platform.",
    Installation:
      "Integrate the Content Delivery API and SDK, map frontend components, and connect the Storyblok Bridge for visual editing.",
    "Editor access":
      "Users join a space with roles controlling content, blocks, assets, languages, and publishing. Custom roles and workflows are available on supporting plans.",
    Publishing:
      "Stories move between draft, published, and changed states; workflows and scheduled publishing vary by plan and configuration.",
    "How published edits reach visitors":
      "Storyblok delivers JSON through its content API. The frontend's rendering or build workflow determines when that content becomes visitor-facing HTML.",
    "Pricing model":
      "Plans vary by spaces, seats, traffic, API requests, locales, workflow features, and governance needs.",
  },
  "decap-cms": {
    "Best at":
      "Open-source editorial UI over Git-backed content and review workflows.",
    Installation:
      "Add the admin app, configure collections and media, choose a Git backend, and provide authentication plus a build and deploy path.",
    "Editor access":
      "Editors authenticate through the configured backend; standard Git backends, Git Gateway, Open Authoring, and hosted Turbo have different account requirements.",
    Publishing:
      "By default a save commits to the publication branch; editorial workflow uses branches and pull or merge requests for drafts, review, and approval.",
    "How published edits reach visitors":
      "Decap CMS updates repository content but does not deliver the website. The configured build and deployment determine when those files become visitor-facing HTML.",
    "Pricing model":
      "The core CMS is free and open source; Git hosting, authentication, site hosting, builds, and optional hosted services are separate.",
  },
} as const;

const indexPlatformDisclosure =
  "Choose a full platform when you need its wider system: visual layout and hosting from Webflow or Duda, structured API content from Contentful or Storyblok, or Git-backed workflows from TinaCMS, CloudCannon, or Decap CMS. Whether a headless or Git-backed edit appears in served HTML depends on the site's rendering, build, and deployment. ReCopyFast applies published edits in the visitor's browser after the page loads, so no-JavaScript visitors and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.";

const indexRecopyFastDisclosure =
  "Choose ReCopyFast when the site already exists, should stay on its current stack, and clients need an account-free email-code path to draft and publish copy. Its published edits are applied in the visitor's browser after load; visitors without JavaScript and crawlers that do not render it see the original HTML, so keep SEO-critical copy in the site's source too.";

const integrationBoundaryDisclosure =
  "ReCopyFast can be added across different site stacks because its integration is a script, but installation requires permission to add a script and a compatible Content Security Policy (CSP). It edits existing authored copy; it does not build pages or migrate a site. Published edits are applied in the visitor's browser after the page loads. Visitors without JavaScript, and crawlers that do not render JavaScript, see the original HTML copy, so put SEO-critical copy in the site's source as well.";

function expectMetadata(metadata: Metadata, slug: string) {
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

async function renderComparisonRoute(slug: ComparisonSlug) {
  return render(
    await ComparisonRoute({ params: Promise.resolve({ competitor: slug }) }),
  );
}

const availablePricing: ComparisonPricing = {
  status: "available",
  agency: { monthlyPrice: 73, websites: 14 },
  founding: {
    price: 411,
    monthlyCredits: 250,
    availability: { remaining: 9, limit: 50, soldOut: false },
  },
};

const catalogueOffers: MonthlyOffer[] = [
  {
    name: "Starter",
    price: 9,
    currency: "USD",
    url: "http://localhost:3000/#pricing",
  },
  {
    name: "Pro",
    price: 19,
    currency: "USD",
    url: "http://localhost:3000/#pricing",
  },
];

function expectFaqJsonLdMatchesVisibleFaq() {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  );
  const schemas = scripts.map((script) =>
    JSON.parse(script.textContent ?? "null"),
  );
  const schema = schemas.find((item) => item?.["@type"] === "FAQPage") as
    | {
        "@context": string;
        "@type": string;
        mainEntity: Array<{
          "@type": string;
          name: string;
          acceptedAnswer: { "@type": string; text: string };
        }>;
      }
    | undefined;

  expect(schema).toBeDefined();
  if (!schema) {
    throw new Error("FAQPage schema was not rendered");
  }

  expect(schema).toMatchObject({
    "@context": "https://schema.org",
    "@type": "FAQPage",
  });
  expect(schema.mainEntity.length).toBeGreaterThanOrEqual(3);

  for (const item of schema.mainEntity) {
    expect(item["@type"]).toBe("Question");
    expect(item.acceptedAnswer["@type"]).toBe("Answer");
    expect(item.acceptedAnswer.text).not.toBe(item.name);
    const question = screen.getByText(item.name);
    const pair = question.closest("div");
    expect(pair).not.toBeNull();
    expect(
      within(pair as HTMLElement).getByText(item.acceptedAnswer.text),
    ).toBeInTheDocument();
  }
}

describe("comparison marketing pages", () => {
  beforeEach(() => {
    mockLoadComparisonPricing.mockResolvedValue(availablePricing);
    mockLoadCatalogueOffers.mockResolvedValue(catalogueOffers);
  });

  it("renders a comparison index with every supported alternative", async () => {
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
    const indexTable = screen.getByRole("table", {
      name: /website editing options/i,
    });
    for (const route of routes) {
      const row = within(indexTable)
        .getByRole("rowheader", { name: route.name })
        .closest("tr");
      expect(row).not.toBeNull();
      expect(
        within(row as HTMLElement).getByText(
          expectedCompetitorRows[route.slug]["Best at"],
        ),
      ).toBeInTheDocument();
      expect(
        within(row as HTMLElement).getByText(
          (_, element) =>
            element?.tagName === "TD" &&
            element.textContent ===
              `${expectedCompetitorRows[route.slug].Installation} ${expectedCompetitorRows[route.slug]["How published edits reach visitors"]}`,
        ),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("heading", { name: /when to choose a platform/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(indexPlatformDisclosure)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /when to choose ReCopyFast/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(indexRecopyFastDisclosure)).toBeInTheDocument();
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
    ).toHaveAttribute(
      "href",
      "/signup?utm_source=comparison&utm_medium=page&utm_campaign=compare_index",
    );
    expect(
      screen.getByRole("link", { name: /try it on a site/i }),
    ).toHaveAttribute("href", "/try");
    expect(indexMetadata.alternates).toMatchObject({ canonical: "/compare" });
    expect(indexMetadata.openGraph).toMatchObject({ url: "/compare" });
    expect(indexMetadata.title).toBe("Compare website editing tools");
    expectFaqJsonLdMatchesVisibleFaq();
  });

  it("routes the comparison index FAQ schema through the shared JSON-LD boundary", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/compare/page.tsx"),
      "utf8",
    );

    expect(source).toContain("buildFAQPageLd(indexFaqs)");
    expect(source).toContain("serializeJsonLd(indexFaqSchema)");
    expect(source).not.toContain("JSON.stringify(indexFaqSchema)");
  });

  it.each(routes)(
    "renders the dated, fair $name comparison with valid matching FAQ schema",
    async ({
      slug,
      name,
      factsCheckedAsOf,
      shortAnswer,
      competitorFit,
      deliveryDisclosure,
    }) => {
      await renderComparisonRoute(slug);

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: new RegExp(`ReCopyFast vs ${name}`, "i"),
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(shortAnswer)).toBeInTheDocument();
      expect(
        screen.getByText(
          new RegExp(
            `product information checked as of ${factsCheckedAsOf}`,
            "i",
          ),
        ),
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
      expect(within(table).getAllByRole("rowheader")).toHaveLength(6);

      for (const [label, competitorClaim] of Object.entries(
        expectedCompetitorRows[slug],
      )) {
        const claimRow = within(table)
          .getByRole("rowheader", { name: label })
          .closest("tr");
        expect(claimRow).not.toBeNull();
        expect(
          within(claimRow as HTMLElement).getByText(competitorClaim),
        ).toBeInTheDocument();
      }

      const editorAccessRow = within(table)
        .getByRole("rowheader", {
          name: /(?:Client|Editor) access/,
        })
        .closest("tr");
      expect(editorAccessRow).not.toBeNull();
      expect(
        within(editorAccessRow as HTMLElement).getByText(
          "Invited clients request a six-digit email code and do not create a ReCopyFast account.",
        ),
      ).toBeInTheDocument();

      const deliveryRow = within(table)
        .getByRole("rowheader", {
          name: "How published edits reach visitors",
        })
        .closest("tr");
      expect(deliveryRow).not.toBeNull();
      expect(
        within(deliveryRow as HTMLElement).getByText(
          expectedCompetitorRows[slug]["How published edits reach visitors"],
        ),
      ).toBeInTheDocument();
      const pricingRow = within(table)
        .getByRole("rowheader", { name: "Pricing model" })
        .closest("tr");
      expect(pricingRow).not.toBeNull();
      expect(
        within(pricingRow as HTMLElement).getByText(
          /Agency is \$73\/month for 14 sites.*Founding Agency is \$411 lifetime.*9 of 50/i,
        ),
      ).toBeInTheDocument();
      expect(
        within(deliveryRow as HTMLElement).getByText(
          /after the page loads.*without JavaScript.*crawlers.*original HTML.*SEO-critical/i,
        ),
      ).toBeInTheDocument();
      const competitorChoice = screen
        .getByRole("heading", {
          level: 2,
          name: new RegExp(`When to choose ${name}`, "i"),
        })
        .closest("article");
      expect(competitorChoice).not.toBeNull();
      expect(
        within(competitorChoice as HTMLElement).getByText(deliveryDisclosure),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /requires permission to add a script and a compatible Content Security Policy/i,
        ),
      ).toBeInTheDocument();
      const integrationSection = screen
        .getByRole("heading", { level: 2, name: "Integration boundaries" })
        .closest("section");
      expect(integrationSection).not.toBeNull();
      expect(
        within(integrationSection as HTMLElement).getByText(
          integrationBoundaryDisclosure,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /current ReCopyFast pricing/i }),
      ).toHaveAttribute("href", "/#pricing");
      expect(
        screen.getByRole("link", { name: /start with ReCopyFast/i }),
      ).toHaveAttribute(
        "href",
        `/signup?utm_source=comparison&utm_medium=page&utm_campaign=compare_${slug}`,
      );
      expect(
        screen.getByRole("link", { name: /try ReCopyFast/i }),
      ).toHaveAttribute("href", "/try");

      const related = screen.getByRole("navigation", {
        name: /related comparisons/i,
      });
      for (const sibling of routes) {
        const link = within(related).getByRole("link", {
          name: new RegExp(sibling.name, "i"),
        });
        expect(link).toHaveAttribute("href", `/compare/${sibling.slug}`);
        if (sibling.slug === slug) {
          expect(link).toHaveAttribute("aria-current", "page");
        } else {
          expect(link).not.toHaveAttribute("aria-current");
        }
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
      const schemas = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      ).map((script) => JSON.parse(script.textContent ?? "null"));
      const softwareApplication = schemas.find(
        (schema) => schema?.["@type"] === "SoftwareApplication",
      );
      expect(softwareApplication).toMatchObject({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: `http://localhost:3000/compare/${slug}`,
        offers: [
          expect.objectContaining({ name: "Starter", price: 9 }),
          expect.objectContaining({ name: "Pro", price: 19 }),
        ],
      });
      expect(JSON.stringify(softwareApplication)).not.toMatch(
        /aggregateRating|ratingValue|"review"/,
      );
      expect(schemas).toEqual(
        expect.arrayContaining([
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Comparisons",
                item: "http://localhost:3000/compare",
              },
              {
                "@type": "ListItem",
                position: 2,
                name,
                item: `http://localhost:3000/compare/${slug}`,
              },
            ],
          },
        ]),
      );
      expect(screen.getByText(name, { selector: "span" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expectMetadata(createComparisonMetadata(comparisons[slug]), slug);
      expect(comparisonRevalidate).toBe(300);
    },
  );

  it.each(routes)(
    "pins every $name competitor claim independently",
    ({ slug }) => {
      expect(
        Object.fromEntries(
          comparisons[slug].rows.map((row) => [row.label, row.competitor]),
        ),
      ).toEqual(expectedCompetitorRows[slug]);
    },
  );

  it("documents the current Webflow content-editor account flow and legacy Editor retirement", async () => {
    await renderComparisonRoute("webflow-editor");

    expect(
      screen.getByText(/legacy Webflow Editor retired on August 4, 2026/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /accept an invitation and sign in to or create a Webflow account/i,
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("credits CloudCannon client sharing as a no-account option", async () => {
    await renderComparisonRoute("cloudcannon");

    expect(
      screen.getByText(
        /Client Sharing can let clients edit without a CloudCannon account/i,
      ),
    ).toBeInTheDocument();
  });

  it("states Duda's unlimited client-account and per-site billing model accurately", async () => {
    await renderComparisonRoute("duda");

    expect(
      screen.getByText(expectedCompetitorRows.duda["Client access"]),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/additional published sites.*priced separately/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/per-site capacity to client seats/i)).toBeNull();
  });

  it.each([
    [
      "available catalogue",
      availablePricing,
      /Agency is \$73\/month for 14 sites.*Founding Agency is \$411 lifetime.*9 of 50/i,
    ],
    [
      "sold-out founding offer",
      {
        ...availablePricing,
        founding: {
          price: 411,
          monthlyCredits: 250,
          availability: { remaining: 0, limit: 50, soldOut: true },
        },
      },
      /Agency is \$73\/month for 14 sites.*Founding Agency is sold out/i,
    ],
    [
      "unknown founding availability",
      {
        ...availablePricing,
        founding: { price: 411, monthlyCredits: 250, availability: null },
      },
      /Agency is \$73\/month for 14 sites.*Founding Agency availability is temporarily unavailable/i,
    ],
    [
      "disabled checkout",
      { status: "disabled" },
      /Agency checkout is currently unavailable/i,
    ],
    [
      "unavailable catalogue",
      { status: "unavailable" },
      /Agency pricing is temporarily unavailable/i,
    ],
  ] satisfies Array<[string, ComparisonPricing, RegExp]>)(
    "renders $0 without a hardcoded offer",
    (_label, pricing, expected) => {
      render(
        <ComparisonPage
          comparison={comparisons.duda}
          pricing={pricing}
          offers={catalogueOffers}
        />,
      );

      expect(screen.getAllByText(expected).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/\$49\/month for 10 sites/i)).toBeNull();
      expect(screen.queryByText(/\$299 lifetime/i)).toBeNull();
    },
  );

  /**
   * s45 — the offer states what it includes: everything in Agency, with the
   * founding allowance the catalogue gives it (250 AI credits a month after
   * migration 20260926120000). The number is catalogue data, never copy.
   */
  it("states the founding allowance wherever it presents the offer", () => {
    render(
      <ComparisonPage
        comparison={comparisons.duda}
        pricing={availablePricing}
        offers={catalogueOffers}
      />,
    );

    const sentence =
      "Agency is $73/month for 14 sites. Founding Agency is $411 lifetime: " +
      "everything in Agency, with 250 AI credits a month; 9 of 50 founding " +
      "spots remain.";
    // The "Pricing model" row and the "Pricing context" section.
    expect(
      screen.getAllByText((_content, element) =>
        (element?.textContent ?? "").startsWith(sentence),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("takes the founding allowance from the catalogue, not from copy", () => {
    render(
      <ComparisonPage
        comparison={comparisons.duda}
        pricing={{
          ...availablePricing,
          founding: {
            price: 411,
            monthlyCredits: 1200,
            availability: { remaining: 9, limit: 50, soldOut: false },
          },
        }}
        offers={catalogueOffers}
      />,
    );

    expect(
      screen.getAllByText(
        /Founding Agency is \$411 lifetime: everything in Agency, with 1,200 AI credits a month; 9 of 50/,
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/250 AI credits/)).toBeNull();
  });

  it("omits schema offers after a catalogue failure without hiding visible pricing state", async () => {
    mockLoadCatalogueOffers.mockResolvedValueOnce([]);

    await renderComparisonRoute("contentful");

    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map((script) => JSON.parse(script.textContent ?? "null"));
    const softwareApplication = schemas.find(
      (schema) => schema?.["@type"] === "SoftwareApplication",
    );
    expect(softwareApplication).toBeDefined();
    expect(softwareApplication).not.toHaveProperty("offers");
    expect(
      screen.getAllByText(
        /Agency is \$73\/month for 14 sites.*Founding Agency is \$411 lifetime/i,
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("publishes unique canonical and social titles for every comparison route", () => {
    const metadata = routes.map((route) =>
      createComparisonMetadata(comparisons[route.slug]),
    );
    const titles = metadata.map((item) => item.openGraph?.title);
    const canonicals = metadata.map((item) => item.alternates?.canonical);

    expect(new Set(titles).size).toBe(routes.length);
    expect(new Set(canonicals).size).toBe(routes.length);
    for (const [index] of routes.entries()) {
      const routeMetadata = metadata[index];
      expect(routeMetadata.title).toEqual({
        absolute: expect.stringMatching(/^ReCopyFast vs /),
      });
      expect(routeMetadata.openGraph?.title).toBe(
        (routeMetadata.title as { absolute: string }).absolute,
      );
      expect(routeMetadata.twitter?.title).toBe(
        (routeMetadata.title as { absolute: string }).absolute,
      );
    }
  });
});
