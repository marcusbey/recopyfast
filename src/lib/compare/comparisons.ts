import type { Metadata } from "next";
import { resolveSiteUrl } from "@/lib/seo/site-url";

export type ComparisonSlug =
  | "webflow-editor"
  | "duda"
  | "tinacms"
  | "cloudcannon";

type ComparisonRow = {
  label: string;
  competitor: string;
  recopyfast: string | { kind: "live-pricing" };
};

type FaqItem = {
  question: string;
  answer: string;
};

type OfficialSource = {
  label: string;
  href: string;
};

export type Comparison = {
  slug: ComparisonSlug;
  competitor: string;
  title: string;
  description: string;
  shortAnswer: string;
  competitorFit: string[];
  recopyfastFit: string[];
  rows: ComparisonRow[];
  integrationNote: string;
  faqs: FaqItem[];
  sources: OfficialSource[];
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

/**
 * This date applies only to competitor facts checked against their public
 * documentation. ReCopyFast prices and offer availability come from the live
 * catalogue at request time, because the first s37 draft incorrectly let an
 * editorial snapshot outlive checkout and the Agency kill switch.
 */
export const COMPETITOR_FACTS_CHECKED_AS_OF = "2026-09";

function servedHtmlAdvantage(competitor: string): string {
  return `Choose ${competitor} when published edits must be served in the page's HTML. ReCopyFast applies published edits in the visitor's browser after the page loads, so visitors without JavaScript and crawlers that do not render JavaScript see the original HTML; put SEO-critical copy in the site's source as well.`;
}

export const comparisons = {
  "webflow-editor": {
    slug: "webflow-editor",
    competitor: "Webflow",
    title: "ReCopyFast vs Webflow Editor",
    description:
      "Compare ReCopyFast with Webflow's current content-editor workflow for client website updates, access, publishing, and installation.",
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
    title: "ReCopyFast vs Duda",
    description:
      "Compare ReCopyFast and Duda for agency website workflows, client access, visual design, publishing, and per-site operations.",
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
    title: "ReCopyFast vs TinaCMS",
    description:
      "Compare ReCopyFast and TinaCMS for Git-backed content, visual editing, client access, publishing, and integration effort.",
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
    title: "ReCopyFast vs CloudCannon",
    description:
      "Compare ReCopyFast and CloudCannon for Git-based sites, visual editing, client sharing, publishing, and installation.",
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
} as const satisfies Record<ComparisonSlug, Comparison>;

export const comparisonList = Object.values(comparisons);

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
