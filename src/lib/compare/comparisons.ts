import type { Metadata } from "next";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type ComparisonRow = {
  readonly label: string;
  readonly competitor: string;
  readonly recopyfast: string | { readonly kind: "live-pricing" };
};

type FaqItem = {
  readonly question: string;
  readonly answer: string;
};

type OfficialSource = {
  readonly label: string;
  readonly href: string;
};

export type Comparison = {
  readonly slug: string;
  readonly competitor: string;
  readonly officialHost: string;
  readonly factsCheckedAsOf: string;
  readonly title: string;
  readonly description: string;
  readonly hubDescription: string;
  readonly shortAnswer: string;
  readonly competitorFit: readonly string[];
  readonly recopyfastFit: readonly string[];
  readonly rows: readonly ComparisonRow[];
  readonly integrationNote: string;
  readonly faqs: readonly FaqItem[];
  readonly sources: readonly OfficialSource[];
};

const sharedRecopyFastRows = {
  installation:
    "One script on an existing site; no content or hosting migration. Script access and a compatible site security policy are required.",
  editorAccess:
    "Invited clients request a six-digit email code and do not create a ReCopyFast account.",
  publishing:
    "Editors save drafts, then a permitted editor explicitly publishes them.",
  delivery:
    "Published edits are applied in the visitor's browser after the page loads. Visitors without JavaScript, and crawlers that do not render JavaScript, see the original HTML copy. Put SEO-critical copy in the site's source as well.",
} as const;

const livePricingRow = { kind: "live-pricing" } as const;

const REQUIRED_ROW_LABELS = [
  "Best at",
  "Installation",
  "Publishing",
  "How published edits reach visitors",
  "Pricing model",
] as const;

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

function requireUniqueTextItems(
  values: readonly string[],
  minimum: number,
  field: string,
): void {
  if (values.length < minimum) {
    throw new Error(`${field} must contain at least ${minimum} statements`);
  }

  const normalized = values.map((value, index) => {
    requireText(value, `${field}[${index}]`);
    return value.trim().toLocaleLowerCase("en-US");
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} statements must be unique within the comparison`);
  }
}

function isOfficialHttpsSource(
  source: OfficialSource,
  officialHost: string,
): boolean {
  try {
    const url = new URL(source.href);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    return (
      source.label.trim().length > 0 &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (hostname === officialHost || hostname.endsWith(`.${officialHost}`))
    );
  } catch {
    return false;
  }
}

/**
 * Runtime validation is intentional even though the registry is typed. The
 * first s17 attempt had a closed slug list beside its data, so adding a page
 * could satisfy TypeScript while silently missing a consumer. This gate keeps
 * each key and payload self-consistent and rejects thin or unsafe entries at
 * module load, before Next can generate a partial cluster.
 */
export function validateComparisonRegistry(
  registry: Readonly<Record<string, Comparison>>,
): void {
  const entries = Object.entries(registry);
  if (entries.length === 0) {
    throw new Error("comparison registry must not be empty");
  }

  const slugs = new Set<string>();
  const titles = new Set<string>();
  const descriptions = new Set<string>();

  for (const [key, comparison] of entries) {
    if (comparison.slug !== key) {
      throw new Error(
        `comparison slug "${comparison.slug}" must match registry key "${key}"`,
      );
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(comparison.slug)) {
      throw new Error(`comparison slug "${comparison.slug}" is not canonical`);
    }
    if (slugs.has(comparison.slug)) {
      throw new Error(`comparison slug "${comparison.slug}" must be unique`);
    }
    slugs.add(comparison.slug);

    for (const [field, value] of Object.entries({
      competitor: comparison.competitor,
      officialHost: comparison.officialHost,
      title: comparison.title,
      description: comparison.description,
      hubDescription: comparison.hubDescription,
      shortAnswer: comparison.shortAnswer,
      integrationNote: comparison.integrationNote,
    })) {
      requireText(value, `${comparison.slug}.${field}`);
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comparison.factsCheckedAsOf)) {
      throw new Error(
        `${comparison.slug}.factsCheckedAsOf must use YYYY-MM format`,
      );
    }
    if (!/^[a-z0-9.-]+$/.test(comparison.officialHost)) {
      throw new Error(`${comparison.slug}.officialHost must be a hostname`);
    }

    requireUniqueTextItems(
      comparison.competitorFit,
      3,
      `${comparison.slug}.competitorFit`,
    );
    requireUniqueTextItems(
      comparison.recopyfastFit,
      3,
      `${comparison.slug}.recopyfastFit`,
    );

    const rowLabels = comparison.rows.map((row) => row.label);
    const uniqueRowLabels = new Set(rowLabels);
    const hasAccessRow =
      uniqueRowLabels.has("Client access") ||
      uniqueRowLabels.has("Editor access");
    if (
      uniqueRowLabels.size !== rowLabels.length ||
      !hasAccessRow ||
      REQUIRED_ROW_LABELS.some((label) => !uniqueRowLabels.has(label))
    ) {
      throw new Error(
        `${comparison.slug} must contain every required comparison row exactly once`,
      );
    }
    for (const [index, row] of comparison.rows.entries()) {
      requireText(row.label, `${comparison.slug}.rows[${index}].label`);
      requireText(
        row.competitor,
        `${comparison.slug}.rows[${index}].competitor`,
      );
      if (row.label === "Pricing model") {
        if (
          typeof row.recopyfast !== "object" ||
          row.recopyfast === null ||
          row.recopyfast.kind !== "live-pricing" ||
          Object.keys(row.recopyfast).length !== 1
        ) {
          throw new Error(
            `${comparison.slug} Pricing model must use exactly the live-pricing marker`,
          );
        }
      } else {
        if (typeof row.recopyfast !== "string") {
          throw new Error(
            `${comparison.slug} ${row.label} ReCopyFast value must be nonempty text`,
          );
        }
        requireText(
          row.recopyfast,
          `${comparison.slug}.rows[${index}].recopyfast`,
        );
      }
    }

    const faqQuestions = comparison.faqs.map((faq, index) => {
      requireText(faq.question, `${comparison.slug}.faqs[${index}].question`);
      requireText(faq.answer, `${comparison.slug}.faqs[${index}].answer`);
      return faq.question.trim().toLocaleLowerCase("en-US");
    });
    if (
      faqQuestions.length < 4 ||
      new Set(faqQuestions).size !== faqQuestions.length
    ) {
      throw new Error(
        `${comparison.slug} must contain at least 4 unique FAQ items`,
      );
    }

    if (
      comparison.sources.length === 0 ||
      !comparison.sources.every((source) =>
        isOfficialHttpsSource(source, comparison.officialHost),
      ) ||
      new Set(comparison.sources.map((source) => source.href)).size !==
        comparison.sources.length
    ) {
      throw new Error(
        `${comparison.slug} sources must be unique official HTTPS URLs`,
      );
    }

    const normalizedTitle = comparison.title.trim().toLocaleLowerCase("en-US");
    const normalizedDescription = comparison.description
      .trim()
      .toLocaleLowerCase("en-US");
    if (
      titles.has(normalizedTitle) ||
      descriptions.has(normalizedDescription)
    ) {
      throw new Error(
        "comparison metadata titles and descriptions must be unique",
      );
    }
    titles.add(normalizedTitle);
    descriptions.add(normalizedDescription);
  }
}

export function defineComparisonRegistry<
  const Registry extends Readonly<Record<string, Comparison>>,
>(registry: Registry): Registry {
  validateComparisonRegistry(registry);
  return registry;
}

function servedHtmlAdvantage(competitor: string): string {
  return `Choose ${competitor} when published edits must be served in the page's HTML. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.`;
}

export const comparisons = defineComparisonRegistry({
  "webflow-editor": {
    slug: "webflow-editor",
    competitor: "Webflow",
    officialHost: "webflow.com",
    factsCheckedAsOf: "2026-09",
    title: "ReCopyFast vs Webflow Editor",
    description:
      "Compare ReCopyFast with Webflow's current content-editor workflow for client website updates, access, publishing, and installation.",
    hubDescription:
      "For visual site building, CMS, hosting, and today's content-editor workflow.",
    shortAnswer:
      "Choose Webflow when you need to design or rebuild a site in a visual platform with CMS and hosting. Choose ReCopyFast when the site already exists on another stack and clients only need a focused way to edit, draft, and publish copy without a migration or account.",
    competitorFit: [
      "You want visual site building, CMS, and hosting in one Webflow workflow.",
      "Your team needs to change layout and design, not only existing page copy.",
      "The site is already in Webflow or you are prepared to build it there.",
      servedHtmlAdvantage("Webflow"),
    ],
    recopyfastFit: [
      "The existing site should stay on its current stack and hosting.",
      "Clients should enter with a six-digit email code instead of creating a product account.",
      "You want invited clients to edit without a Webflow seat or account.",
    ],
    rows: [
      {
        label: "Best at",
        competitor: "Visual design, site building, CMS, and hosting together.",
        recopyfast: "Adding focused copy editing to an existing site.",
      },
      {
        label: "Installation",
        competitor: "Build or run the site in Webflow.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Client access",
        competitor:
          "Current content editors accept an invitation and sign in to or create a Webflow account.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "Content editors can save drafts and publish to staging or production when Webflow permissions allow it.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "Webflow publishes edits so they are served in the page's HTML, an advantage when JavaScript is unavailable or a crawler does not render it.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "Site plans and Workspace or seat plans depend on the Webflow setup.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "The legacy Webflow Editor retired on August 4, 2026. This page uses Webflow's current content-editor workflow, where clients accept an invitation and sign in to or create a Webflow account. ReCopyFast does not recreate Webflow's layout designer, CMS, or hosting.",
    faqs: [
      {
        question: "Is the legacy Webflow Editor still available?",
        answer:
          "No. Webflow says the legacy Editor and its white-labeling retired on August 4, 2026. Current content editors use Webflow's newer account-based editing flow.",
      },
      {
        question: "Can ReCopyFast replace Webflow's visual site builder?",
        answer:
          "No. ReCopyFast edits content on an existing site; it does not build layouts, host the site, or replace Webflow CMS.",
      },
      {
        question: "Do ReCopyFast client editors need an account?",
        answer:
          "No ReCopyFast account is required for an invited client editor. They request a six-digit code by email to open the editing session.",
      },
      {
        question: "Which option keeps the existing site outside Webflow?",
        answer:
          "ReCopyFast keeps the existing stack and hosting in place. Webflow is the stronger option when the site itself should be designed, hosted, and managed in Webflow.",
      },
    ],
    sources: [
      { label: "Webflow pricing", href: "https://webflow.com/pricing" },
      {
        label: "Webflow content editor documentation",
        href: "https://help.webflow.com/hc/en-us/articles/33961251014931-Edit-site-content-as-a-content-editor",
      },
      {
        label: "Webflow legacy Editor deprecation FAQ",
        href: "https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ",
      },
    ],
  },
  duda: {
    slug: "duda",
    competitor: "Duda",
    officialHost: "duda.co",
    factsCheckedAsOf: "2026-09",
    title: "ReCopyFast vs Duda",
    description:
      "Compare ReCopyFast and Duda for agency website workflows, client access, visual design, publishing, and per-site operations.",
    hubDescription:
      "For agencies comparing an all-in-one visual builder with an editing layer for existing sites.",
    shortAnswer:
      "Choose Duda when your agency wants one visual builder for creating and managing client sites. Choose ReCopyFast when those sites already run on other stacks and you want to add client copy editing with one script, no migration, and no client account.",
    competitorFit: [
      "Your agency wants to build and manage client sites in one visual platform.",
      "Clients or teammates need layout, design, preview, and publishing tools.",
      "Granular client permissions and plan-dependent white-label options matter to your workflow.",
      servedHtmlAdvantage("Duda"),
    ],
    recopyfastFit: [
      "You manage existing sites across different frameworks or CMS products.",
      "Clients only need a focused copy workflow, not a full site builder.",
      "You need focused copy editing for sites that remain on their current hosting rather than rebuilding them in Duda.",
    ],
    rows: [
      {
        label: "Best at",
        competitor: "Building and managing agency sites in a visual platform.",
        recopyfast: "Adding focused copy editing to existing client sites.",
      },
      {
        label: "Installation",
        competitor: "Sites are built and managed through Duda.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Client access",
        competitor:
          "On Team plans and higher, client accounts are unlimited; agencies assign them to sites with per-site permissions.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "The visual editor supports preview plus Publish or Republish, subject to permissions.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "Duda publishes edits so they are served in the page's HTML, an advantage when JavaScript is unavailable or a crawler does not render it.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "Team plans and higher include unlimited client accounts. Platform subscriptions include site allowances, with additional published sites priced separately.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "Duda is a broader website-building and client-management platform. ReCopyFast does not create layouts or host sites; it adds an editing layer to authored copy already present on a site.",
    faqs: [
      {
        question: "Is ReCopyFast a Duda site builder replacement?",
        answer:
          "No. Duda provides a visual site builder and agency management platform. ReCopyFast adds copy editing to a site that already exists.",
      },
      {
        question: "How do Duda clients get access?",
        answer:
          "Duda documents unlimited client accounts that agencies assign to sites with per-site permissions on Team plans and higher. Clients accept invitations and set passwords.",
      },
      {
        question: "Can ReCopyFast work across different site stacks?",
        answer:
          "It uses a script rather than a framework SDK, but the site must allow that script and its Content Security Policy must permit the required connections.",
      },
      {
        question: "Which option includes a visual site builder?",
        answer:
          "Duda includes a visual site-building platform. ReCopyFast edits authored copy on a site that already exists and does not provide layout or hosting tools.",
      },
    ],
    sources: [
      { label: "Duda pricing", href: "https://www.duda.co/pricing" },
      {
        label: "Duda editor overview",
        href: "https://support.duda.co/hc/en-us/articles/26519221644439-Editor-Overview",
      },
      {
        label: "Duda client management documentation",
        href: "https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients",
      },
      {
        label: "Duda client permissions",
        href: "https://www.duda.co/features/client-permissions",
      },
    ],
  },
  tinacms: {
    slug: "tinacms",
    competitor: "TinaCMS",
    officialHost: "tina.io",
    factsCheckedAsOf: "2026-09",
    title: "ReCopyFast vs TinaCMS",
    description:
      "Compare ReCopyFast and TinaCMS for Git-backed content, visual editing, client access, publishing, and integration effort.",
    hubDescription:
      "For teams weighing Git-backed structured content against script-based copy editing.",
    shortAnswer:
      "Choose TinaCMS when Git-backed structured content and developer-defined schemas are part of the product architecture. Choose ReCopyFast when you want to keep an existing site and add simple client copy editing without moving content into a Git-backed CMS.",
    competitorFit: [
      "You want content in Git with developer-defined schemas and version history.",
      "A React-oriented visual editing integration fits the site's architecture.",
      "Developers own the content model and editorial workflow configuration.",
      "Choose TinaCMS when its Git commits feed a site build and deployment that serves updated HTML. TinaCMS is headless, so delivery depends on that site setup. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.",
    ],
    recopyfastFit: [
      "You do not want to migrate existing page copy into a new content model.",
      "The client's job is changing authored copy rather than managing repository content.",
      "Draft and publish should happen without writing edits to the source repository.",
    ],
    rows: [
      {
        label: "Best at",
        competitor:
          "Structured, Git-backed content in a developer-managed setup.",
        recopyfast: "Adding focused copy editing to an existing site.",
      },
      {
        label: "Installation",
        competitor:
          "Developers configure TinaCMS, its schema, content files, and visual editing integration.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Editor access",
        competitor:
          "Editors are invited to the project; GitHub access and workflow depend on the setup and plan.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "In TinaCloud production, saves commit directly to Git, or through Editorial Workflow when it is enabled.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "In TinaCloud production, saves commit directly to Git, or through Editorial Workflow when it is enabled. Whether edits appear in served HTML depends on the site's build and deployment; statically built or server-rendered sites can serve the updated content after that workflow completes.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "TinaCloud plans vary by project, user allowance, and workflow features.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "TinaCMS is designed around structured source content and a developer-configured integration. ReCopyFast reads editable text from the rendered site and does not write content changes back to a Git repository.",
    faqs: [
      {
        question: "Does ReCopyFast store edited content in Git?",
        answer:
          "No. ReCopyFast stores and publishes content through its own editing workflow; it does not commit changes to the site's source repository.",
      },
      {
        question: "When is TinaCMS the better fit?",
        answer:
          "TinaCMS is a stronger fit when structured content, Git version control, and developer-defined schemas are requirements.",
      },
      {
        question: "Does ReCopyFast require a content migration?",
        answer:
          "No content migration is built into the setup. ReCopyFast adds its script to the existing site and discovers authored text in the rendered page.",
      },
      {
        question: "Does TinaCMS serve the finished website itself?",
        answer:
          "TinaCMS is headless. Its Git-backed content feeds the site's own build or rendering workflow, which determines how published content reaches visitors.",
      },
    ],
    sources: [
      { label: "TinaCMS documentation", href: "https://tina.io/docs" },
      {
        label: "TinaCMS editor usage documentation",
        href: "https://tina.io/tinadocs/docs/using-tinacms/usage-editors",
      },
      {
        label: "TinaCMS developer usage documentation",
        href: "https://tina.io/tinadocs/docs/using-tinacms/usage-developers",
      },
      {
        label: "TinaCMS Editorial Workflow documentation",
        href: "https://tina.io/docs/tinacloud/editorial-workflow",
      },
      {
        label: "TinaCMS separate content repository guide",
        href: "https://tina.io/docs/guides/separate-content-repo",
      },
      { label: "TinaCMS pricing", href: "https://tina.io/pricing" },
    ],
  },
  cloudcannon: {
    slug: "cloudcannon",
    competitor: "CloudCannon",
    officialHost: "cloudcannon.com",
    factsCheckedAsOf: "2026-09",
    title: "ReCopyFast vs CloudCannon",
    description:
      "Compare ReCopyFast and CloudCannon for Git-based sites, visual editing, client sharing, publishing, and installation.",
    hubDescription:
      "For static-site teams comparing repository sync and visual editing workflows.",
    shortAnswer:
      "Choose CloudCannon when a Git-based visual CMS and repository sync are central to your static-site workflow. Choose ReCopyFast when the site should stay as it is and clients only need a lightweight draft-and-publish copy editor added by script.",
    competitorFit: [
      "Your agency has a Git and static-site workflow that should remain the content source of truth.",
      "Editors need visual editing tied to repository sync and configured site builds.",
      "Client Sharing or full user accounts fit the permissions and attribution you need.",
      servedHtmlAdvantage("CloudCannon"),
    ],
    recopyfastFit: [
      "You want the same focused editing layer across sites that do not share a Git CMS setup.",
      "Invited editors should authenticate individually by email code without product accounts.",
      "You do not want client edits to depend on repository sync or a static-site build workflow.",
    ],
    rows: [
      {
        label: "Best at",
        competitor: "Visual editing for Git-backed and static-site workflows.",
        recopyfast: "Adding focused copy editing to an existing site.",
      },
      {
        label: "Installation",
        competitor:
          "Connect a repository and configure the site and editing experience.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Client access",
        competitor:
          "Client Sharing can allow password-based access without a CloudCannon account; full users are also supported.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "Repository syncing and publishing between site copies depend on the configured workflow.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "CloudCannon syncs published content through the repository and build workflow so edits are served in the page's HTML, an advantage when JavaScript is unavailable or a crawler does not render it.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "Plans bundle user allowances; extra users or site shares may vary by plan, and Standard lists unlimited sites.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "CloudCannon Client Sharing can let clients edit without a CloudCannon account by using a site-specific password. That shared access cannot attribute changes to different editors. ReCopyFast uses individual invited email addresses and six-digit codes, but it does not sync edits to Git.",
    faqs: [
      {
        question: "Can CloudCannon clients edit without an account?",
        answer:
          "Yes. CloudCannon documents Client Sharing with a site-specific password, though shared access cannot distinguish which client made a change.",
      },
      {
        question: "Does ReCopyFast sync content to a Git repository?",
        answer:
          "No. ReCopyFast publishes through its own site editing layer and does not write changes to the site's repository.",
      },
      {
        question: "When is CloudCannon the better fit?",
        answer:
          "CloudCannon is a stronger fit when visual editing, static-site builds, and repository sync belong in one configured Git CMS workflow.",
      },
      {
        question: "Can ReCopyFast replace CloudCannon's Git workflow?",
        answer:
          "No. ReCopyFast does not sync edits to a repository or manage static-site builds. It is for focused copy editing on the rendered site.",
      },
    ],
    sources: [
      {
        label: "CloudCannon Git CMS overview",
        href: "https://cloudcannon.com/git-cms/",
      },
      {
        label: "CloudCannon pricing",
        href: "https://cloudcannon.com/pricing/",
      },
      {
        label: "CloudCannon syncing and publishing documentation",
        href: "https://cloudcannon.com/documentation/user-articles/introduction-to-syncing-and-publishing/",
      },
      {
        label: "CloudCannon Client Sharing documentation",
        href: "https://cloudcannon.com/documentation/user-articles/what-is-client-sharing/",
      },
    ],
  },
  contentful: {
    slug: "contentful",
    competitor: "Contentful",
    officialHost: "contentful.com",
    factsCheckedAsOf: "2026-10",
    title: "ReCopyFast vs Contentful",
    description:
      "Compare ReCopyFast and Contentful for structured content, live preview, roles, publishing, delivery, and integration effort.",
    hubDescription:
      "For teams comparing reusable structured content and API delivery with focused existing-site editing.",
    shortAnswer:
      "Choose Contentful when reusable structured content must feed several websites, apps, or channels through APIs. Choose ReCopyFast when one existing website should keep its current content and only needs focused client copy editing without a content-model migration.",
    competitorFit: [
      "Your team needs modeled content that can be reused across websites, apps, and other channels.",
      "You need roles, environment controls, and content governance, choosing a plan that supports the required features.",
      "Developers can integrate Contentful's delivery and preview APIs into the frontend.",
      "Choose Contentful when published content should enter the frontend through a structured API. Whether it reaches visitors in served HTML depends on that frontend's rendering and deployment; ReCopyFast applies published edits in the browser after load.",
    ],
    recopyfastFit: [
      "The site already works and should not be rebuilt around entries, references, and delivery APIs.",
      "Clients only need to change authored page copy rather than manage a general-purpose content space.",
      "An invited editor should use an email code without becoming a persistent CMS user.",
    ],
    rows: [
      {
        label: "Best at",
        competitor:
          "Modeling reusable structured content for websites, apps, and other channels.",
        recopyfast: "Adding focused copy editing to an existing site.",
      },
      {
        label: "Installation",
        competitor:
          "Model content, integrate the delivery APIs or SDKs, and configure preview for the consuming frontend.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Editor access",
        competitor:
          "Editors are invited organization users with role-based access. Custom permissions and advanced environment controls depend on the plan.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "Publishing makes entries available through the Content Delivery API. Roles control who edits or publishes; workflow features depend on the plan.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "Contentful delivers published content as JSON and media through its APIs. The site's rendering or build workflow determines whether visitors receive that content in served HTML.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "Platform plans vary by spaces, users, roles, locales, API calls, bandwidth, and governance features.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "Contentful is a structured content platform, not a drop-in page overlay. ReCopyFast does not replace cross-channel content models, localization, environments, or API delivery; it avoids that migration when the immediate job is bounded editing on one existing site.",
    faqs: [
      {
        question: "Is ReCopyFast a headless CMS like Contentful?",
        answer:
          "No. Contentful stores structured content and delivers it through APIs. ReCopyFast stores and applies edits for elements discovered on an existing rendered website.",
      },
      {
        question: "What does Contentful do better?",
        answer:
          "Contentful is the stronger fit for reusable structured content, multiple delivery channels, formal roles, and content governance.",
      },
      {
        question: "Can Contentful editors preview changes?",
        answer:
          "Yes. Side-by-side preview needs Content Preview setup; live updates and inspector mode also need the Live Preview SDK.",
      },
      {
        question: "When is ReCopyFast the simpler choice?",
        answer:
          "When the site already works and the goal is focused copy editing without moving its authored content into a new model and API integration.",
      },
    ],
    sources: [
      {
        label: "Contentful Content Delivery API overview",
        href: "https://www.contentful.com/developers/docs/references/content-delivery-api/overview/",
      },
      {
        label: "Contentful live preview documentation",
        href: "https://www.contentful.com/developers/docs/tutorials/preview/live-preview/",
      },
      {
        label: "Contentful roles documentation",
        href: "https://www.contentful.com/help/roles/",
      },
      {
        label: "Contentful users documentation",
        href: "https://www.contentful.com/help/users-and-teams/users/",
      },
      {
        label: "Contentful pricing",
        href: "https://www.contentful.com/pricing/",
      },
    ],
  },
  storyblok: {
    slug: "storyblok",
    competitor: "Storyblok",
    officialHost: "storyblok.com",
    factsCheckedAsOf: "2026-10",
    title: "ReCopyFast vs Storyblok",
    description:
      "Compare ReCopyFast and Storyblok for component-based content, visual editing, roles, workflows, delivery, and setup.",
    hubDescription:
      "For teams comparing a component-aware headless CMS and Visual Editor with a script-based editing layer.",
    shortAnswer:
      "Choose Storyblok when a headless content platform, reusable components, and an integrated Visual Editor belong in the site's architecture. Choose ReCopyFast when the current frontend should remain untouched apart from adding focused copy editing by script.",
    competitorFit: [
      "Your frontend is built around structured stories and reusable content blocks.",
      "Editors need a component-aware Visual Editor with draft previews and publishing controls.",
      "Roles, workflows, scheduling, localization, and API delivery belong in one content platform.",
      "Choose Storyblok when its API content feeds a frontend that can render published updates into served HTML. ReCopyFast applies published edits in the visitor's browser after the page loads.",
    ],
    recopyfastFit: [
      "The deployed site should not be rebuilt around Storyblok components and API responses.",
      "The editing job is limited to existing authored copy rather than structured page composition.",
      "Occasional client editors should enter with an email code instead of occupying a CMS seat.",
    ],
    rows: [
      {
        label: "Best at",
        competitor:
          "Component-based headless content with a visual preview and broader editorial platform.",
        recopyfast: "Adding focused copy editing to an existing site.",
      },
      {
        label: "Installation",
        competitor:
          "Integrate the Content Delivery API and SDK, map frontend components, and connect the Storyblok Bridge for visual editing.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Editor access",
        competitor:
          "Users join a space with roles controlling content, blocks, assets, languages, and publishing. Custom roles and workflows are available on supporting plans.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "Stories move between draft, published, and changed states; workflows and scheduled publishing vary by plan and configuration.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "Storyblok delivers JSON through its content API. The frontend's rendering or build workflow determines when that content becomes visitor-facing HTML.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "Plans vary by spaces, seats, traffic, API requests, locales, workflow features, and governance needs.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "Storyblok's Visual Editor communicates with a configured frontend through its SDK and Bridge. ReCopyFast does not provide a reusable block model or headless delivery API; it is narrower and starts from copy already rendered on the site.",
    faqs: [
      {
        question: "Does Storyblok provide visual editing?",
        answer:
          "Yes. Its Visual Editor combines a draft rendering with form and block editing after the frontend and Bridge are configured.",
      },
      {
        question: "What development work does Storyblok require?",
        answer:
          "The documented setup connects the content API, initializes an SDK, maps components, and links the frontend preview to the Visual Editor.",
      },
      {
        question: "What does Storyblok do better?",
        answer:
          "Storyblok provides structured components, localization, roles, workflows, assets, APIs, and visual preview as one broader content platform.",
      },
      {
        question: "When is ReCopyFast the better fit?",
        answer:
          "When the site is already deployed and needs bounded copy editing without rebuilding the frontend around structured Storyblok components.",
      },
    ],
    sources: [
      {
        label: "Storyblok Visual Editor documentation",
        href: "https://www.storyblok.com/docs/manuals/visual-editor",
      },
      {
        label: "Storyblok roles documentation",
        href: "https://www.storyblok.com/docs/manuals/roles.html",
      },
      {
        label: "Storyblok workflows documentation",
        href: "https://www.storyblok.com/docs/manuals/workflows",
      },
      {
        label: "Storyblok JavaScript SDK documentation",
        href: "https://www.storyblok.com/docs/libraries/js/js-sdk",
      },
      {
        label: "Storyblok pricing",
        href: "https://www.storyblok.com/pricing",
      },
    ],
  },
  "decap-cms": {
    slug: "decap-cms",
    competitor: "Decap CMS",
    officialHost: "decapcms.org",
    factsCheckedAsOf: "2026-10",
    title: "ReCopyFast vs Decap CMS",
    description:
      "Compare ReCopyFast and Decap CMS for open-source Git content, authentication, editorial workflow, delivery, and setup.",
    hubDescription:
      "For teams comparing an open-source Git content workflow with direct editing on an existing site.",
    shortAnswer:
      "Choose Decap CMS when repository files, commits, pull requests, and a static-site build are the content workflow. Choose ReCopyFast when the deployed site is the starting point and clients need focused edits without a Git backend or collection schema.",
    competitorFit: [
      "Content should stay as files in a Git repository alongside the site.",
      "An open-source CMS and repository review history are core requirements.",
      "Developers can configure collections, backend authentication, previews, and the site's build and deploy path.",
      "Choose Decap CMS when commits feed a build that serves updated HTML. Decap CMS does not deliver the frontend itself; ReCopyFast applies published edits in the visitor's browser after page load.",
    ],
    recopyfastFit: [
      "The site is dynamic, legacy, or otherwise not modeled as editable repository files.",
      "The first edit should not require configuring a Git backend and authentication, a collection schema, and the site's build/deploy path.",
      "Editors should work on the rendered page through individual email-code access.",
    ],
    rows: [
      {
        label: "Best at",
        competitor:
          "Open-source editorial UI over Git-backed content and review workflows.",
        recopyfast: "Adding focused copy editing to an existing site.",
      },
      {
        label: "Installation",
        competitor:
          "Add the admin app, configure collections and media, choose a Git backend, and provide authentication plus a build and deploy path.",
        recopyfast: sharedRecopyFastRows.installation,
      },
      {
        label: "Editor access",
        competitor:
          "Editors authenticate through the configured backend; standard Git backends, Git Gateway, Open Authoring, and hosted Turbo have different account requirements.",
        recopyfast: sharedRecopyFastRows.editorAccess,
      },
      {
        label: "Publishing",
        competitor:
          "By default a save commits to the publication branch; editorial workflow uses branches and pull or merge requests for drafts, review, and approval.",
        recopyfast: sharedRecopyFastRows.publishing,
      },
      {
        label: "How published edits reach visitors",
        competitor:
          "Decap CMS updates repository content but does not deliver the website. The configured build and deployment determine when those files become visitor-facing HTML.",
        recopyfast: sharedRecopyFastRows.delivery,
      },
      {
        label: "Pricing model",
        competitor:
          "The core CMS is free and open source; Git hosting, authentication, site hosting, builds, and optional hosted services are separate.",
        recopyfast: livePricingRow,
      },
    ],
    integrationNote:
      "Decap CMS wraps a Git content workflow and needs a configured backend. ReCopyFast does not create commits or pull requests, and it does not replace repository-based review when that history is the required source of truth.",
    faqs: [
      {
        question: "Is Decap CMS free?",
        answer:
          "The core Decap CMS project is free and open source. Git hosting, authentication, builds, deployment, and any optional hosted services remain separate concerns.",
      },
      {
        question: "Where does Decap CMS save content?",
        answer:
          "It reads and updates files through the configured Git backend, with published content stored on the configured repository branch.",
      },
      {
        question: "Can Decap CMS support a review workflow?",
        answer:
          "Yes. Its editorial workflow maps drafts and approvals to branches plus pull or merge requests on supported Git backends.",
      },
      {
        question: "Why choose ReCopyFast instead?",
        answer:
          "Choose ReCopyFast when the existing rendered site should stay outside a Git-based content model and the editor only needs bounded page-copy changes.",
      },
    ],
    sources: [
      {
        label: "Decap CMS overview",
        href: "https://decapcms.org/docs/intro/",
      },
      {
        label: "Decap CMS installation steps",
        href: "https://decapcms.org/docs/add-to-your-site/",
      },
      {
        label: "Decap CMS backend overview",
        href: "https://decapcms.org/docs/backends-overview/",
      },
      {
        label: "Decap CMS editorial workflow",
        href: "https://decapcms.org/docs/editorial-workflows/",
      },
      {
        label: "Decap CMS Open Authoring",
        href: "https://decapcms.org/docs/open-authoring/",
      },
    ],
  },
});

export type ComparisonSlug = keyof typeof comparisons;

export const comparisonList = Object.values(comparisons);

/**
 * The hub states the oldest source-check date represented by its cards. Detail
 * pages show their own date, so adding a newly researched competitor does not
 * pretend that older entries were rechecked at the same time.
 */
export const COMPETITOR_FACTS_CHECKED_AS_OF = comparisonList.reduce(
  (oldest, comparison) =>
    comparison.factsCheckedAsOf < oldest ? comparison.factsCheckedAsOf : oldest,
  "9999-12",
);

export function getComparisonFromRegistry(
  registry: Readonly<Record<string, Comparison>>,
  slug: string,
): Comparison | null {
  return Object.hasOwn(registry, slug) ? (registry[slug] ?? null) : null;
}

export function getComparison(slug: string): Comparison | null {
  return getComparisonFromRegistry(comparisons, slug);
}

export function getComparisonRow(
  comparison: Comparison,
  label: string,
): ComparisonRow {
  const row = comparison.rows.find((candidate) => candidate.label === label);
  if (!row) {
    throw new Error(
      `Comparison ${comparison.slug} is missing the required "${label}" row`,
    );
  }
  return row;
}

export function comparisonSiteUrl(path: string): string {
  return `${resolveSiteUrl()}${path}`;
}

export function createComparisonMetadata(comparison: Comparison): Metadata {
  const canonical = `/compare/${comparison.slug}`;
  const title = comparison.title;

  return {
    title: { absolute: comparison.title },
    description: comparison.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "ReCopyFast",
      title,
      description: comparison.description,
      locale: "en_US",
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: comparison.description,
      images: ["/twitter-image"],
    },
  };
}
