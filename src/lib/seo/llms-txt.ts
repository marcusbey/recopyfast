import { comparisonList } from "@/lib/compare/comparisons";
import { SITE_DESCRIPTION, SITE_NAME } from "./site-identity";

/**
 * `/llms.txt` (llmstxt.org): a Markdown map of the site for AI search — an H1,
 * a `>` summary, then `##` sections of links (s88; PRD § Technical SEO; s17's
 * llms.txt criterion).
 *
 * Every sentence below is one the homepage already makes and
 * `homepage-truth.test.tsx` pins (the Benefits copy), or the comparison pages'
 * delivery caveat. This file is written to be quoted by machines, so it is held
 * to the homepage's standard: nothing about A/B testing, translation, "any
 * website" or a guarantee — src/__tests__/app/llms-txt.test.ts checks.
 *
 * The comparison links come from `comparisonList`, the data the `/compare/*`
 * routes and the sitemap are built from (ADR 012 §4), so a new comparison is
 * listed here without touching this file.
 */
export function buildLlmsTxt(siteUrl: string): string {
  const link = (label: string, path: string, note: string) =>
    `- [${label}](${siteUrl}${path}): ${note}`;

  const comparisons = comparisonList.map((comparison) =>
    link(
      comparison.title,
      `/compare/${comparison.slug}`,
      comparison.description,
    ),
  );

  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "ReCopyFast adds in-place copy editing to a website that already exists — React, Vue, WordPress, Webflow or plain HTML — without moving its content or hosting. The site's Content Security Policy has to allow the script.",
    "",
    "- Invite someone by email. They sign in with a one-time code, with no account and no password, and change the words on the page, never the layout or the code. You choose, per editor, who can publish.",
    "- Edits stay a draft until someone with Publish access sets them live. Visitors only ever see published copy.",
    "- Replace a photo by pasting a link or uploading a file, right on the page.",
    "- Select any text and ask AI for a clearer, shorter, more professional or more casual version.",
    "- Save a version of the site's copy before a big change, and restore it in one click.",
    "- Per-site tokens, per-site API keys and per-editor permissions.",
    "",
    "The script applies published edits in the visitor's browser after the page loads, so visitors and crawlers that do not run JavaScript see the page's original HTML. Keep SEO-critical copy in the site's source as well.",
    "",
    "## Get started",
    "",
    link(
      "Homepage and pricing",
      "/",
      "what ReCopyFast does and what each plan costs.",
    ),
    link(
      "Try it on your site",
      "/try",
      "preview editing on a live page in your own browser tab, without registering, installing or saving anything.",
    ),
    link("Demo", "/demo", "an interactive editing demo that needs no account."),
    link(
      "Installation guide",
      "/docs/install",
      "install the snippet, verify page coverage, invite an editor, and publish.",
    ),
    link(
      "Agent installation brief",
      "/docs/install/agent-instructions.md",
      "the installation guide's brief as Markdown, for a coding agent.",
    ),
    "",
    "## Comparisons",
    "",
    link(
      "Compare website editing tools",
      "/compare",
      "how ReCopyFast compares with other ways to let clients edit a website, including where the others are the better choice.",
    ),
    ...comparisons,
    "",
    "## Legal",
    "",
    link(
      "Privacy policy",
      "/privacy",
      "what data ReCopyFast collects and why.",
    ),
    link(
      "Terms of service",
      "/terms",
      "the terms that govern using ReCopyFast.",
    ),
    "",
  ].join("\n");
}
