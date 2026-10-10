/**
 * How the site names and describes itself, everywhere a machine reads it: the
 * root metadata, the homepage's social card, its SoftwareApplication JSON-LD and
 * `/llms.txt`.
 *
 * Moved out of `src/app/layout.tsx` in s88 because a layout may only export the
 * names Next knows (`metadata`, `default`, …) and these now have four readers.
 *
 * Until s50 the title and description said "Universal CMS Layer" and "Transform
 * any website into an editable platform". Neither is true: a site whose Content
 * Security Policy blocks the script cannot run it, and there is no content model.
 * manifest.ts and opengraph-image.tsx carry the same two lines.
 */
export const SITE_NAME = "ReCopyFast";

export const SITE_TITLE = "ReCopyFast - Edit your website copy in place";

export const SITE_DESCRIPTION =
  "Make the copy on the site you already built editable, with one script tag.";

/**
 * The site-wide social card. The root layout uses it as the default; the
 * homepage restates it with its own `url`, because a page's `openGraph`
 * replaces the parent's whole object rather than merging into it.
 */
export const SITE_OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  locale: "en_US",
} as const;
