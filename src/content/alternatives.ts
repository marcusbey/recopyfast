export const ALTERNATIVE_SLUGS = [
  "tinacms",
  "cloudcannon",
  "contentful",
  "storyblok",
  "decap-cms",
] as const;

export type CompetitorSlug = (typeof ALTERNATIVE_SLUGS)[number];

export interface DatedPriceClaim {
  readonly label: string;
  readonly checkedAt: string;
  readonly sourceUrl: string;
}

export interface ComparisonFAQ {
  readonly question: string;
  readonly answer: string;
}

export interface ComparisonSource {
  readonly label: string;
  readonly url: string;
  readonly checkedAt: string;
}

export interface ComparisonEntry {
  readonly slug: CompetitorSlug;
  readonly name: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly intro: string;
  readonly setup: string;
  readonly whereContentLives: string;
  readonly editingWithoutDev: string;
  readonly clientEditsWithoutAccount: string;
  readonly startingPrice: DatedPriceClaim;
  readonly whereTheyWin: readonly string[];
  readonly whereWeWin: readonly string[];
  readonly faq: readonly ComparisonFAQ[];
  readonly migrationSteps: readonly string[];
  readonly sources: readonly ComparisonSource[];
}

function requireMinimum(
  value: readonly unknown[],
  minimum: number,
  field: string,
): void {
  if (value.length < minimum) {
    throw new Error(`${field} must contain at least ${minimum} items`);
  }
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

function hasDatedHttpsSource(source: ComparisonSource): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)) return false;
  try {
    return (
      new URL(source.url).protocol === "https:" &&
      source.label.trim().length > 0
    );
  } catch {
    return false;
  }
}

export function validateComparisonEntry(entry: ComparisonEntry): void {
  for (const [field, value] of Object.entries({
    name: entry.name,
    metaTitle: entry.metaTitle,
    metaDescription: entry.metaDescription,
    intro: entry.intro,
    setup: entry.setup,
    whereContentLives: entry.whereContentLives,
    editingWithoutDev: entry.editingWithoutDev,
    clientEditsWithoutAccount: entry.clientEditsWithoutAccount,
  })) {
    requireText(value, field);
  }

  requireMinimum(entry.whereTheyWin, 3, "whereTheyWin");
  requireMinimum(entry.whereWeWin, 3, "whereWeWin");

  if (entry.faq.length < 4 || entry.faq.length > 5) {
    throw new Error("faq must contain between 4 and 5 items");
  }

  if (entry.migrationSteps.length !== 3) {
    throw new Error("migrationSteps must contain exactly 3 items");
  }

  if (entry.sources.length === 0 || !entry.sources.every(hasDatedHttpsSource)) {
    throw new Error("sources must use dated HTTPS URLs");
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.startingPrice.checkedAt) ||
    !hasDatedHttpsSource({
      label: entry.startingPrice.label,
      url: entry.startingPrice.sourceUrl,
      checkedAt: entry.startingPrice.checkedAt,
    })
  ) {
    throw new Error("startingPrice must use a dated HTTPS source");
  }
}

export function validateComparisonEntries(
  entries: readonly ComparisonEntry[],
): void {
  entries.forEach(validateComparisonEntry);

  const actual = [...entries.map((entry) => entry.slug)].sort();
  const expected = [...ALTERNATIVE_SLUGS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((slug, index) => slug !== expected[index])
  ) {
    throw new Error(
      "comparison entries must cover every alternative slug exactly once",
    );
  }
}

export const ALTERNATIVES = [
  {
    slug: "tinacms",
    name: "TinaCMS",
    metaTitle: "TinaCMS alternative for existing sites | ReCopyFast",
    metaDescription:
      "Compare TinaCMS and ReCopyFast for visual editing, Git-backed content, client access, setup, and current pricing.",
    intro:
      "TinaCMS is a strong Git-backed choice when a team wants content schemas and an editor integrated with its codebase. ReCopyFast starts from a different constraint: keep the site as it is and add bounded editing to the rendered page.",
    setup:
      "Configure Tina, model file-based content, and connect the editor to the site's framework. Visual editing is documented for React-based frameworks and Astro.",
    whereContentLives:
      "File-based content such as Markdown, MDX, and JSON stays in the Git repository with the site.",
    editingWithoutDev:
      "Editors can work visually after a developer has completed the Tina integration and content model.",
    clientEditsWithoutAccount:
      "The documented cloud workflow grants project user seats; it is not a one-time no-account edit link.",
    startingPrice: {
      label: "$0 Free; Team $29/month or $290/year",
      checkedAt: "2026-09-12",
      sourceUrl: "https://tina.io/pricing",
    },
    whereTheyWin: [
      "Git-backed files keep content changes in the same repository and review history as the site.",
      "Tina's visual editor connects structured content to React-based frameworks and Astro previews.",
      "Paid tiers add team roles and support, while Team Plus includes an editorial workflow.",
    ],
    whereWeWin: [
      "ReCopyFast attaches to an already-rendered site with a script instead of requiring a Tina schema and data layer first.",
      "The original page remains in place while ReCopyFast stores and serves keyed edits for discovered elements.",
      "A scoped email-code grant lets an occasional client edit without joining the agency's project as a user.",
    ],
    faq: [
      {
        question: "Is ReCopyFast a drop-in replacement for TinaCMS?",
        answer:
          "No. TinaCMS is a Git-backed headless CMS with content modeling. ReCopyFast is an editing layer for a site that already renders its content.",
      },
      {
        question: "Does TinaCMS support visual editing?",
        answer:
          "Yes. Tina documents visual editing for React-based frameworks and Astro once the site is integrated.",
      },
      {
        question: "Where does TinaCMS store content?",
        answer:
          "Tina documents file-based content stored in Git alongside the codebase.",
      },
      {
        question: "Which option fits a site that cannot be re-platformed?",
        answer:
          "ReCopyFast is designed for that constraint because its install starts with a script on the existing rendered site.",
      },
    ],
    migrationSteps: [
      "Choose one existing page and confirm which text or images should be editable.",
      "Register its domain, install the issued ReCopyFast script, and verify the report from that host.",
      "Test a bounded edit and client code flow before changing any TinaCMS integration.",
    ],
    sources: [
      {
        label: "TinaCMS pricing",
        url: "https://tina.io/pricing",
        checkedAt: "2026-09-12",
      },
      {
        label: "TinaCMS framework and visual-editing support",
        url: "https://tina.io/docs/integration/frameworks",
        checkedAt: "2026-09-12",
      },
      {
        label: "TinaCMS content storage",
        url: "https://tina.io/docs/features/data-fetching",
        checkedAt: "2026-09-12",
      },
    ],
  },
  {
    slug: "cloudcannon",
    name: "CloudCannon",
    metaTitle: "CloudCannon alternative for mixed-stack sites | ReCopyFast",
    metaDescription:
      "Compare CloudCannon and ReCopyFast for Git sync, visual editing, client sharing, publishing workflows, and setup.",
    intro:
      "CloudCannon combines Git syncing, visual editing, collaboration, and publishing workflows. It is especially capable when the website files already live in a supported repository workflow. ReCopyFast is narrower and starts with the deployed page.",
    setup:
      "Connect or upload the website files, create a CloudCannon site, configure editable content, and connect the Git branch and publishing workflow.",
    whereContentLives:
      "Website content and code stay in the connected Git repository and sync with the CloudCannon site.",
    editingWithoutDev:
      "Non-technical editors can use visual, content, data, and source interfaces after the site is configured.",
    clientEditsWithoutAccount:
      "Yes. CloudCannon's current pricing explicitly includes Client Sharing without a CloudCannon account.",
    startingPrice: {
      label: "$55/month Standard; $49/month paid annually",
      checkedAt: "2026-09-12",
      sourceUrl: "https://cloudcannon.com/pricing/",
    },
    whereTheyWin: [
      "CloudCannon keeps site files synchronized with Git and exposes that history without locking content into a proprietary store.",
      "Its documented Client Sharing already lets a client update content without a CloudCannon account.",
      "Editing sessions, branch-based publishing, conflict handling, and several editing interfaces support deeper team workflows.",
    ],
    whereWeWin: [
      "ReCopyFast can begin from the deployed page without first importing the site into a Git-based CMS project.",
      "One installation model can cover mixed client stacks whose source and build pipelines are managed in different ways.",
      "The editing surface is constrained to discovered live-page elements rather than exposing file, collection, or source interfaces.",
    ],
    faq: [
      {
        question: "Can CloudCannon clients edit without an account?",
        answer:
          "Yes. CloudCannon's pricing page lists Client Sharing as allowing client updates without a CloudCannon account.",
      },
      {
        question: "Does CloudCannon keep content in Git?",
        answer:
          "Yes. CloudCannon synchronizes the website files and content with a connected Git repository and branch.",
      },
      {
        question: "Why choose ReCopyFast instead?",
        answer:
          "Choose it when the main constraint is adding bounded editing to an already-deployed site without adopting a repository and build workflow in the editing product.",
      },
      {
        question: "Does ReCopyFast replace CloudCannon's publishing workflow?",
        answer:
          "No. CloudCannon offers broader Git and branch workflows. ReCopyFast focuses on small, in-page content changes through its own staging and publish path.",
      },
    ],
    migrationSteps: [
      "Pick a low-risk client page whose deployed HTML is stable enough for an installation test.",
      "Install and verify the issued script without disconnecting CloudCannon or its Git repository.",
      "Compare the bounded client-edit journey with the existing CloudCannon sharing workflow before deciding what to retain.",
    ],
    sources: [
      {
        label: "CloudCannon pricing and Client Sharing",
        url: "https://cloudcannon.com/pricing/",
        checkedAt: "2026-09-12",
      },
      {
        label: "CloudCannon developer getting started",
        url: "https://cloudcannon.com/documentation/developer-guides/getting-started-with-cloudcannon/",
        checkedAt: "2026-09-12",
      },
      {
        label: "CloudCannon syncing and publishing",
        url: "https://cloudcannon.com/documentation/user-articles/introduction-to-syncing-and-publishing/",
        checkedAt: "2026-09-12",
      },
    ],
  },
  {
    slug: "contentful",
    name: "Contentful",
    metaTitle: "Contentful alternative for live-page editing | ReCopyFast",
    metaDescription:
      "Compare Contentful and ReCopyFast for structured content, APIs, roles, visual workflows, existing sites, and pricing.",
    intro:
      "Contentful is a composable content platform for structured content delivered across channels. ReCopyFast does less: it adds a controlled editing layer to a website that already exists and renders.",
    setup:
      "Model content in Contentful, integrate its delivery APIs or SDKs, and connect the frontend fields and preview/editor experience.",
    whereContentLives:
      "Structured entries, assets, locales, and relationships live in Contentful spaces and are delivered through its APIs.",
    editingWithoutDev:
      "Editors can manage entries and use editorial tools after developers model the content and integrate the consuming application.",
    clientEditsWithoutAccount:
      "No guest edit link is documented; people who create or update content are invited Contentful organization users with roles.",
    startingPrice: {
      label: "$0 Free; Lite $300/month",
      checkedAt: "2026-09-12",
      sourceUrl: "https://www.contentful.com/pricing/",
    },
    whereTheyWin: [
      "Contentful's structured content model is built for reusing the same entries across websites, apps, and other channels.",
      "The current Free platform tier includes ten users, two roles, two locales, API traffic, and CDN bandwidth.",
      "Its role, team, locale, API, and enterprise tooling supports governance beyond a single-page editing layer.",
    ],
    whereWeWin: [
      "ReCopyFast does not require replacing page content with entries and references before someone can change a headline.",
      "A developer can install the editing layer without rewriting the site around a content-delivery SDK or API.",
      "The occasional editor works against the rendered client page rather than navigating a general-purpose content space.",
    ],
    faq: [
      {
        question: "Is ReCopyFast a headless CMS like Contentful?",
        answer:
          "No. Contentful stores structured content and serves it through APIs. ReCopyFast overlays edits on elements found in an existing rendered site.",
      },
      {
        question: "What does Contentful do better?",
        answer:
          "Contentful is the stronger fit for modeled, reusable content delivered across many channels with formal roles and governance.",
      },
      {
        question: "Can a Contentful editor work without a user account?",
        answer:
          "Contentful documents editors as invited organization users whose roles control the content they can manage.",
      },
      {
        question: "When is ReCopyFast the simpler option?",
        answer:
          "When the website already works and the goal is to let someone make bounded copy changes without a content-model migration.",
      },
    ],
    migrationSteps: [
      "Identify one page whose copy does not need Contentful's cross-channel content model.",
      "Install ReCopyFast alongside the existing frontend and verify only the intended elements are discovered.",
      "Run a reversible edit before moving or removing any Contentful entry or API integration.",
    ],
    sources: [
      {
        label: "Contentful platform pricing",
        url: "https://www.contentful.com/pricing/",
        checkedAt: "2026-09-12",
      },
      {
        label: "Contentful users and membership",
        url: "https://www.contentful.com/help/users-and-teams/users/",
        checkedAt: "2026-09-12",
      },
      {
        label: "Contentful roles and permissions",
        url: "https://www.contentful.com/help/roles/",
        checkedAt: "2026-09-12",
      },
    ],
  },
  {
    slug: "storyblok",
    name: "Storyblok",
    metaTitle: "Storyblok alternative for existing websites | ReCopyFast",
    metaDescription:
      "Compare Storyblok and ReCopyFast for visual editing, SDK integration, content blocks, client access, localization, and pricing.",
    intro:
      "Storyblok pairs a headless content platform with a component-aware Visual Editor. It is a capable choice for teams building a structured frontend around reusable blocks. ReCopyFast targets sites that should not be rebuilt first.",
    setup:
      "Create a Storyblok space, integrate its content API and framework SDK, register frontend components, and connect the Bridge for visual editing.",
    whereContentLives:
      "Stories, components, assets, locales, and workflow state live in a Storyblok space and reach the site through its APIs.",
    editingWithoutDev:
      "Editors can use visual preview and forms after developers connect the frontend components and preview environment.",
    clientEditsWithoutAccount:
      "Storyblok access is seat-based; editors work as users in a space rather than through a no-account edit grant.",
    startingPrice: {
      label: "$0 Starter; Growth $99/month",
      checkedAt: "2026-09-12",
      sourceUrl: "https://www.storyblok.com/pricing",
    },
    whereTheyWin: [
      "Storyblok's Visual Editor links structured blocks to a live preview while preserving a customizable headless frontend.",
      "Official SDKs cover React, Next.js, Astro, Vue, Nuxt, Svelte, and other JavaScript integrations.",
      "Spaces include content workflows, assets, localization, APIs, and higher-tier governance in one platform.",
    ],
    whereWeWin: [
      "ReCopyFast can edit an existing page without first converting its content and layout into Storyblok components.",
      "Installation does not require a Storyblok SDK, access token, Bridge, or preview environment in the application.",
      "A site-scoped email-code grant serves an occasional client without consuming a persistent CMS seat.",
    ],
    faq: [
      {
        question: "Does Storyblok have visual editing?",
        answer:
          "Yes. Its Visual Editor combines a draft preview with component and form editing after the frontend is integrated.",
      },
      {
        question: "What development work does Storyblok require?",
        answer:
          "The documented setup initializes an SDK, connects the Content Delivery API and Bridge, and maps components for editing.",
      },
      {
        question: "What does Storyblok do better?",
        answer:
          "It provides a broader structured-content platform with reusable blocks, assets, locales, workflows, APIs, and SDKs.",
      },
      {
        question: "When is ReCopyFast a better fit?",
        answer:
          "When the site is already deployed and the immediate job is bounded copy editing without rebuilding the frontend around content blocks.",
      },
    ],
    migrationSteps: [
      "Select one existing page and keep the Storyblok space and frontend integration unchanged.",
      "Install and verify ReCopyFast on that host, then inspect the exact discovered elements.",
      "Test an owner and scoped client edit before deciding whether any content should leave Storyblok.",
    ],
    sources: [
      {
        label: "Storyblok pricing",
        url: "https://www.storyblok.com/pricing",
        checkedAt: "2026-09-12",
      },
      {
        label: "Storyblok Visual Editor",
        url: "https://www.storyblok.com/docs/manuals/visual-editor",
        checkedAt: "2026-09-12",
      },
      {
        label: "Storyblok JavaScript SDK",
        url: "https://www.storyblok.com/docs/libraries/js/js-sdk",
        checkedAt: "2026-09-12",
      },
    ],
  },
  {
    slug: "decap-cms",
    name: "Decap CMS",
    metaTitle: "Decap CMS alternative for direct page editing | ReCopyFast",
    metaDescription:
      "Compare Decap CMS and ReCopyFast for open-source Git workflows, authentication, previews, existing sites, and setup.",
    intro:
      "Decap CMS is an open-source interface over a Git workflow for static-site content. It is attractive when repository commits and pull requests are the publishing system. ReCopyFast avoids that requirement for sites that need direct, bounded edits.",
    setup:
      "Add the Decap admin files, configure collections and media, select a Git backend, and provide the authentication and build/deploy path.",
    whereContentLives:
      "Content is committed to the configured Git repository, usually as front matter, Markdown, JSON, or other site files.",
    editingWithoutDev:
      "Editors get a friendly CMS and preview after a developer configures collections, fields, backend authentication, and the site's build.",
    clientEditsWithoutAccount:
      "Authentication is still required through a Git provider, Git Gateway/identity, or another configured backend; Open Authoring requires a GitHub user.",
    startingPrice: {
      label: "Free and open source; hosting and authentication are separate",
      checkedAt: "2026-09-12",
      sourceUrl: "https://decapcms.org/docs/intro/",
    },
    whereTheyWin: [
      "Decap CMS is open source and can be self-managed without a per-seat software subscription.",
      "Its editorial workflow turns drafts and approvals into Git branches, pull requests, and merges.",
      "Content stays as repository files and works with most static site generators and supported Git backends.",
    ],
    whereWeWin: [
      "ReCopyFast does not require a Git provider, OAuth proxy, collection schema, or repository build to start editing.",
      "It can attach to deployed dynamic, legacy, or hand-built pages whose copy is not represented as static-site files.",
      "Edits happen on the rendered customer page instead of in a separate collection and field form.",
    ],
    faq: [
      {
        question: "Is Decap CMS free?",
        answer:
          "Decap CMS is open source. The Git provider, authentication, hosting, build, and operational work remain separate concerns.",
      },
      {
        question: "Where does Decap CMS save content?",
        answer:
          "It fetches and commits content files in the configured hosted Git repository and branch.",
      },
      {
        question: "Can Decap CMS support review workflows?",
        answer:
          "Yes. Its editorial workflow maps drafts and approvals to branches and pull or merge requests on supported Git backends.",
      },
      {
        question: "Why use ReCopyFast instead?",
        answer:
          "Use it when the site should remain outside a Git-based content workflow and the editor needs to work directly on the existing page.",
      },
    ],
    migrationSteps: [
      "Choose a page whose content is difficult to express safely through the existing Decap collections.",
      "Install and verify ReCopyFast without removing the Decap admin or Git backend.",
      "Compare a reversible live-page edit with the current commit/build workflow before changing either system.",
    ],
    sources: [
      {
        label: "Decap CMS overview",
        url: "https://decapcms.org/docs/intro/",
        checkedAt: "2026-09-12",
      },
      {
        label: "Decap CMS configuration",
        url: "https://decapcms.org/docs/configuration-options/",
        checkedAt: "2026-09-12",
      },
      {
        label: "Decap CMS editorial workflow",
        url: "https://decapcms.org/docs/editorial-workflows/",
        checkedAt: "2026-09-12",
      },
      {
        label: "Decap CMS Open Authoring",
        url: "https://decapcms.org/docs/open-authoring/",
        checkedAt: "2026-09-12",
      },
    ],
  },
] as const satisfies readonly ComparisonEntry[];

validateComparisonEntries(ALTERNATIVES);

export function getComparisonEntry(slug: string): ComparisonEntry | null {
  return ALTERNATIVES.find((entry) => entry.slug === slug) ?? null;
}
