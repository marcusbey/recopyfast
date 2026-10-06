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

  it("puts full-document stacks before the closing body tag", () => {
    for (const recipe of installRecipes.filter(
      ({ id }) => id === "wordpress" || id === "html",
    )) {
      expect(`${recipe.location} ${recipe.notes ?? ""}`).toContain("</body>");
    }
  });

  /**
   * The widget does not expose a complete teardown/reinitialization lifecycle.
   * A root-layout tag can remain mounted across client navigation and therefore
   * cannot be described as a complete SPA installation.
   */
  it("requires React and Next.js integrations to verify hydration and navigation", () => {
    const recipe = getInstallRecipe("nextjs") as InstallRecipe;
    const guidance = `${recipe.location} ${recipe.notes ?? ""}`;

    expect(guidance).toMatch(/after (?:the page has )?hydrat(?:e|ed|ion)/i);
    expect(guidance).toMatch(/client-side route changes/i);
    expect(guidance).toMatch(/internal navigation/i);
    expect(guidance).toMatch(/back/i);
    expect(guidance).toMatch(/reload/i);
    expect(guidance).not.toMatch(/seamless|works automatically/i);
  });

  it("warns React and Next.js integrations about URL-collecting analytics", () => {
    const recipe = getInstallRecipe("nextjs") as InstallRecipe;
    const guidance = `${recipe.location} ${recipe.notes ?? ""}`;

    expect(guidance).toMatch(/analytics/i);
    expect(guidance).toMatch(/rcf_handoff/);
    expect(guidance).toMatch(/rcf_edit_token/);
    expect(guidance).toMatch(/rcf_staging/);
    expect(guidance).toMatch(/rcf_token/);
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
