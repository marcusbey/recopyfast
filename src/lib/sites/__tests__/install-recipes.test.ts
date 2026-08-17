import {
  getInstallRecipe,
  installRecipes,
  type InstallRecipe,
} from "@/lib/sites/install-recipes";

/**
 * Where the snippet goes, per stack, as data.
 *
 * This module is the single source: the `awaiting-install` state of the
 * installation card renders from it, and s18's public install pages will extend
 * this same array rather than keeping a second copy. The failure this prevents
 * is the ordinary one — two sets of instructions that agree on the day they are
 * written and disagree six months later, with no way to tell which is current.
 */
describe("install recipes", () => {
  it("ships the three stacks the awaiting-install state must cover", () => {
    expect(installRecipes.map((recipe) => recipe.id)).toEqual([
      "wordpress",
      "nextjs",
      "html",
    ]);
  });

  it("gives every recipe a label and a location an owner can act on", () => {
    for (const recipe of installRecipes) {
      expect(recipe.label.trim().length).toBeGreaterThan(0);
      expect(recipe.location.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * Every stack's instruction ends in the same place — immediately before
   * `</body>`. The widget reads the DOM it is given, so a snippet in `<head>`
   * runs before the copy it is meant to discover exists.
   */
  it("names the closing body tag in every recipe", () => {
    for (const recipe of installRecipes) {
      expect(`${recipe.location} ${recipe.notes ?? ""}`).toContain("</body>");
    }
  });

  it("uses each id exactly once", () => {
    const ids = installRecipes.map((recipe) => recipe.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a known recipe by id", () => {
    const recipe = getInstallRecipe("wordpress") as InstallRecipe;

    expect(recipe.id).toBe("wordpress");
    expect(recipe.label).toBe("WordPress");
  });

  it("returns undefined rather than a wrong recipe for an unknown id", () => {
    expect(getInstallRecipe("drupal")).toBeUndefined();
    expect(getInstallRecipe("")).toBeUndefined();
  });
});
