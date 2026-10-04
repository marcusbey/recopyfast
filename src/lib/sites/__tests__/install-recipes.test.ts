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

  it("gives every recipe separate head and runtime locations an owner can act on", () => {
    for (const recipe of installRecipes) {
      expect(recipe.label.trim().length).toBeGreaterThan(0);
      expect(recipe.headLocation.trim().length).toBeGreaterThan(0);
      expect(recipe.runtimeLocation.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * Stable startup has two placements. Collapsing them back into one tag makes
   * the bootstrap late enough for authored text to paint before protection is
   * armed, which is exactly the visible swap this story closes.
   */
  it("puts the bootstrap in head and the runtime at a body-safe point", () => {
    for (const recipe of installRecipes) {
      expect(recipe.headLocation).toMatch(/head/i);
      expect(recipe.runtimeLocation).toMatch(/body|hydration/i);
    }
  });

  it("keeps Next.js parser-time bootstrap instructions distinct from next/script", () => {
    const recipe = getInstallRecipe("nextjs") as InstallRecipe;

    expect(recipe.headLocation).toMatch(/native inline/i);
    expect(recipe.headLocation).toMatch(/before.*body/i);
    expect(recipe.headLocation).not.toMatch(/beforeInteractive/i);
    expect(recipe.runtimeLocation).toMatch(/after hydration/i);
  });

  it("names WordPress header/footer and plain HTML head/body placements", () => {
    const wordpress = getInstallRecipe("wordpress") as InstallRecipe;
    const html = getInstallRecipe("html") as InstallRecipe;

    expect(wordpress.headLocation).toMatch(/header/i);
    expect(wordpress.runtimeLocation).toMatch(/footer/i);
    expect(html.headLocation).toContain("<head>");
    expect(html.runtimeLocation).toContain("</body>");
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
