/**
 * Where the embed snippet goes, per stack — as typed data, in one place.
 *
 * The snippet itself is built by `buildEmbedScript()` and is identical for
 * every stack; the only thing that differs is which file the owner opens. That
 * difference used to exist nowhere at all: the dashboard printed a `<script>`
 * tag and left "so where do I put this" unanswered, which is the step an owner
 * stalls on.
 *
 * THIS IS THE SINGLE SOURCE. `s18`'s public install pages extend this array
 * with the remaining stacks rather than keeping their own copy — the failure
 * being avoided is the ordinary one, two sets of instructions that agree the
 * day they are written and quietly disagree six months later, with nothing to
 * say which is current.
 *
 * Every recipe ends in the same place: immediately before `</body>`. The widget
 * reads the DOM it is handed, so a snippet in `<head>` runs before the copy it
 * is meant to discover exists.
 */

export type InstallRecipeId = "wordpress" | "nextjs" | "html";

export interface InstallRecipe {
  /** Stable key. Used as the tab value and, later, as s18's page slug. */
  id: InstallRecipeId;
  /** What the stack is called, in the owner's words. */
  label: string;
  /** The file to open and the exact spot in it. */
  location: string;
  /** The one caveat that stack has, when it has one. */
  notes?: string;
}

export const installRecipes: readonly InstallRecipe[] = [
  {
    id: "wordpress",
    label: "WordPress",
    location:
      "Paste it into your theme's footer.php, immediately before the closing </body> tag.",
    notes:
      "No access to theme files? A header-and-footer snippet plugin drops it in the same place, and survives theme updates.",
  },
  {
    id: "nextjs",
    label: "Next.js",
    location:
      "Add it to app/layout.tsx, just before the closing </body> tag of the root layout.",
    notes:
      "On the Pages Router the same tag goes in pages/_document.tsx, inside <body> after <Main />.",
  },
  {
    id: "html",
    label: "Plain HTML",
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
