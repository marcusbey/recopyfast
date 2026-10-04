/**
 * Where both stable-startup placements go, per stack — as typed data, in one
 * place.
 *
 * `buildStableEmbedInstallation()` returns one native head bootstrap and one
 * hydration-safe runtime tag. Their bytes are identical across stacks; only
 * the files and lifecycle points differ. Treating them as one location would
 * put the bootstrap back at body-end, after authored text may already have
 * painted — the exact visible swap s61 exists to close.
 *
 * THIS IS THE SINGLE SOURCE. `s18`'s public install pages extend this array
 * with the remaining stacks rather than keeping their own copy — the failure
 * being avoided is the ordinary one, two sets of instructions that agree the
 * day they are written and quietly disagree six months later, with nothing to
 * say which is current.
 *
 * Existing one-tag installations still run through `buildEmbedScript()`, but
 * they need migration to both placements for the new first-paint protection.
 */

export type InstallRecipeId = "wordpress" | "nextjs" | "html";

export interface InstallRecipe {
  /** Stable key. Used as the tab value and, later, as s18's page slug. */
  id: InstallRecipeId;
  /** What the stack is called, in the owner's words. */
  label: string;
  /** Where the parser-time bootstrap must run before body content exists. */
  headLocation: string;
  /** Where the external runtime can load without racing framework hydration. */
  runtimeLocation: string;
  /** The one caveat that stack has, when it has one. */
  notes?: string;
}

export const installRecipes: readonly InstallRecipe[] = [
  {
    id: "wordpress",
    label: "WordPress",
    headLocation:
      "Paste the head bootstrap into a trusted header-and-footer plugin's Header section, or into header.php inside <head> before page content.",
    runtimeLocation:
      "Paste the runtime tag into the plugin's Footer section, or into footer.php immediately before </body>.",
    notes:
      "Use both placements. An existing single-tag install still runs, but it cannot protect text that painted before that tag loaded.",
  },
  {
    id: "nextjs",
    label: "Next.js",
    headLocation:
      "Render the head bootstrap as a native inline <script> in app/layout.tsx inside <head>, before <body> begins. Do not wrap the bootstrap in next/script.",
    runtimeLocation:
      "Load the external runtime after hydration from the root layout. next/script with afterInteractive is appropriate for this runtime tag only.",
    notes:
      "On the Pages Router, emit the bootstrap natively in pages/_document.tsx <Head> and load the runtime after hydration from the application.",
  },
  {
    id: "html",
    label: "Plain HTML",
    headLocation:
      "Paste the head bootstrap inside <head>, before page content and before <body> begins.",
    runtimeLocation:
      "Paste the runtime tag immediately before </body> on every page you want to be editable.",
    notes:
      "Shared head and footer includes let you add each placement once; otherwise both placements are required on every page.",
  },
] as const;

/** Resolves a recipe by id, or `undefined` — never a substitute recipe. */
export function getInstallRecipe(id: string): InstallRecipe | undefined {
  return installRecipes.find((recipe) => recipe.id === id);
}
