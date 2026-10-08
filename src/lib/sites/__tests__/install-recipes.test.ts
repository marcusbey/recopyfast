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
   * s67 (owner decision 3, 2026-10-08): the plain snippet follows History API
   * route changes; hash routes are not supported. The dashboard card says what
   * /docs/install says (src/lib/docs/installation-content.ts) — it used to say
   * the widget had no complete lifecycle for client-side route changes, which
   * s67 made false. Each site still verifies a full load and an in-app
   * navigation.
   */
  it("requires React and Next.js integrations to verify hydration and navigation", () => {
    const recipe = getInstallRecipe("nextjs") as InstallRecipe;
    const guidance = `${recipe.location} ${recipe.notes ?? ""}`;

    expect(guidance).toMatch(/after (?:the page has )?hydrat(?:e|ed|ion)/i);
    expect(guidance).toMatch(/follows client-side route changes/i);
    expect(guidance).toContain("Hash routes (/#/route) are not supported");
    expect(guidance).toMatch(/switch the router to history mode/i);
    expect(guidance).toMatch(/full page load and an in-app navigation/i);
    expect(guidance).toMatch(/back/i);
    expect(guidance).toMatch(/reload/i);
    expect(guidance).not.toMatch(/no complete lifecycle|teardown/i);
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
