/**
 * The fix CTA on every free-tool report, pinned word for word (s96, plan
 * decision 14). Each sentence is checked against what the product does:
 *
 * - `/try` is a bookmarklet preview: desktop only, nothing saved, no way to
 *   pre-load fixes (launch kit §11, `src/components/try/TryExperience.tsx`). So
 *   the copy says "click the line … and retype it", "only your tab changes".
 * - The embed applies published copy in the visitor's browser after load, so
 *   crawlers that do not run JavaScript keep reading the original HTML. The
 *   footnote says so, and nothing here implies we edit titles, meta tags or
 *   what crawlers see.
 * - `/try` cannot edit alt text (`public/try/rcf-try.js` reads only `altKey`),
 *   so the `alt-text` variant (s101) links sign-up and the install guide and
 *   never `/try`. Its wording is s101's plan's, fixed here so s101 never edits
 *   the component.
 *
 * Links carry `utm_source=tools&utm_medium=free_tool&utm_campaign=<slug>`
 * (architect decision 5). Capturing them at sign-up is a later story.
 */

import type { ToolCtaVariant } from "./catalogue";

export interface CtaLink {
  label: string;
  href: string;
  /** Crosses into the nonce-CSP app surface: a native `<a>`, never `Link`. */
  isAppDocument: boolean;
}

export interface CtaCopy {
  heading: string;
  body: string;
  footnote: string | null;
  links: CtaLink[];
}

export function ctaUtm(slug: string): string {
  return `utm_source=tools&utm_medium=free_tool&utm_campaign=${encodeURIComponent(slug)}`;
}

export const FIX_ON_PAGE_BODY =
  "Opens our free preview. On desktop, click the line on your own page and retype it. Only your tab changes, and nothing is saved. Install ReCopyFast to keep the change; visitors see it on their next page load.";

export const FIX_ON_PAGE_FOOTNOTE =
  "Search engines that don't run JavaScript keep reading your original text. Fix search-critical copy in your site's source.";

export const ALT_TEXT_BODY =
  "With ReCopyFast installed, click an image to edit its alt text. The change is published to the live page, and visitors and screen readers get it on their next page load.";

export function ctaCopyFor(variant: ToolCtaVariant, slug: string): CtaCopy {
  const utm = ctaUtm(slug);
  if (variant === "alt-text") {
    return {
      heading: "Fix alt text on your live page",
      body: ALT_TEXT_BODY,
      footnote: null,
      links: [
        {
          label: "Start with ReCopyFast",
          href: `/signup?${utm}`,
          isAppDocument: true,
        },
        {
          label: "Read the install guide",
          href: `/docs/install?${utm}`,
          isAppDocument: false,
        },
      ],
    };
  }
  return {
    heading: "Fix it on your live page",
    body: FIX_ON_PAGE_BODY,
    footnote: FIX_ON_PAGE_FOOTNOTE,
    links: [
      {
        label: "Fix it on your live page",
        href: `/try?${utm}#install`,
        isAppDocument: false,
      },
      {
        label: "Start with ReCopyFast",
        href: `/signup?${utm}`,
        isAppDocument: true,
      },
    ],
  };
}
