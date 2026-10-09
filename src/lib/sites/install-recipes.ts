/**
 * Where the embed snippet goes, per stack — as typed data, in one place.
 *
 * The snippet itself is built by `buildEmbedScript()` and is identical for
 * every stack. Full-document sites differ only in where the owner pastes it.
 * React and Next.js are different: hydration, client navigation and
 * URL-collecting analytics all affect whether the integration is safe and
 * complete.
 *
 * THIS IS THE SINGLE SOURCE. `s18`'s public install pages extend this array
 * with the remaining stacks rather than keeping their own copy — the failure
 * being avoided is the ordinary one, two sets of instructions that agree the
 * day they are written and quietly disagree six months later, with nothing to
 * say which is current.
 *
 * The Next.js recipe used to say that a root-layout tag completed installation.
 * On aicompoz.com the document-level widget remained mounted across client
 * navigation, while analytics could inspect credential-bearing editor URLs
 * before the widget removed their query values. Keep those checks explicit.
 *
 * s67 (ADR 049, owner decision 3): the widget now follows History API route
 * changes on its own, and hash routes are not supported. The card used to
 * say the widget had no complete lifecycle for client-side route changes;
 * after s67 that contradicted /docs/install. The SPA wording here must keep
 * matching src/lib/docs/installation-content.ts.
 */

export type InstallRecipeId = "wordpress" | "nextjs" | "html";

/**
 * The short heading of the "put the snippet in" step, for one stack. `code`,
 * when present, follows `text` and is set as inline code.
 */
export interface InstallStepTitle {
  text: string;
  code?: string;
}

/** Full-document stacks share one step title. */
const BEFORE_BODY_CLOSE: InstallStepTitle = {
  text: "Paste it before",
  code: "</body>",
};

export interface InstallRecipe {
  /** Stable key. Used as the tab value and, later, as s18's page slug. */
  id: InstallRecipeId;
  /** What the stack is called, in the owner's words. */
  label: string;
  /**
   * The install step's heading while this stack is selected. Per recipe, not
   * one shared line: "Paste it before </body>" above the Next.js recipe told
   * the owner the opposite of the recipe under it (PR #67 review).
   */
  stepTitle: InstallStepTitle;
  /** Where and how the generated snippet should load. */
  location: string;
  /** Integration caveats that must remain visible with the recipe. */
  notes?: string;
}

export const installRecipes: readonly InstallRecipe[] = [
  {
    id: "wordpress",
    label: "WordPress",
    stepTitle: BEFORE_BODY_CLOSE,
    location:
      "Paste it into your theme's footer.php, immediately before the closing </body> tag.",
    notes:
      "No access to theme files? A header-and-footer snippet plugin drops it in the same place, and survives theme updates.",
  },
  {
    id: "nextjs",
    label: "Next.js",
    stepTitle: { text: "Load it after the page has hydrated" },
    location:
      'For React or Next.js, load the generated tag after the page has hydrated. In Next.js, next/script with strategy="afterInteractive" is one option; preserve every generated attribute and value.',
    notes:
      "The widget follows client-side route changes made with the History API (links, Back and Forward in a history-mode router): each in-app navigation loads that page's published copy and makes its newly rendered elements editable. Hash routes (/#/route) are not supported; switch the router to history mode, or give each route's elements a unique author-written data-rcf-id. Verify a full page load and an in-app navigation, then Back, reload, and returning to an edited page. Before the widget loads on editor-entry URLs, ensure analytics and session-replay scripts cannot read rcf_handoff, rcf_staging, or rcf_token in the query, or the #rcf_edit= fragment: exclude it from URL capture.",
  },
  {
    id: "html",
    label: "Plain HTML",
    stepTitle: BEFORE_BODY_CLOSE,
    location:
      "Paste it before the closing </body> tag of every page you want to be editable.",
    notes:
      "Sharing one footer include across pages means pasting it once; otherwise each page needs its own copy.",
  },
] as const;

/** Resolves a recipe by id, or `undefined` — never a substitute recipe. */
export function getInstallRecipe(id: string): InstallRecipe | undefined {
  return installRecipes.find((recipe) => recipe.id === id);
}
