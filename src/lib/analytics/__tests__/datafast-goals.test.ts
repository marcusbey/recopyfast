/**
 * @jest-environment node
 */

import {
  DATAFAST_CTA_LOCATIONS,
  DATAFAST_GOALS,
  DATAFAST_RESERVED_GOAL_NAMES,
  dataFastCtaAttributes,
  dataFastToolGoal,
  sanitizeGoalParams,
} from "@/lib/analytics/datafast-goals";

describe("DataFast goal taxonomy", () => {
  const names = Object.values(DATAFAST_GOALS);

  it("uses only names DataFast accepts", () => {
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_:-]{1,64}$/);
    }
  });

  it("never collides with a name DataFast reserves for payment providers", () => {
    for (const reserved of DATAFAST_RESERVED_GOAL_NAMES) {
      expect(names).not.toContain(reserved);
    }
  });

  it("names every goal exactly once", () => {
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("sanitizeGoalParams", () => {
  it("keeps categorical values", () => {
    expect(
      sanitizeGoalParams({ location: "hero", plan: "lifetime_pro" }),
    ).toEqual({ location: "hero", plan: "lifetime_pro" });
  });

  it("drops anything that could be personal or identifying", () => {
    expect(
      sanitizeGoalParams({
        email: "someone@example.com",
        url: "https://customer.example/page",
        domain: "customer.example",
        token: "abc.def",
        name: "Jane Doe",
        upper: "Hero",
        long: "a".repeat(65),
        number: 42,
      }),
    ).toEqual({});
  });

  it("drops malformed keys, prototype keys and anything past ten params", () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`k${i}`, "v"]),
    );
    expect(Object.keys(sanitizeGoalParams(many))).toHaveLength(10);
    expect(sanitizeGoalParams({ "Bad Key": "v", __proto__x: "v" })).toEqual({
      __proto__x: "v",
    });
    expect(sanitizeGoalParams(null)).toEqual({});
    expect(sanitizeGoalParams("hero")).toEqual({});
  });
});

describe("dataFastCtaAttributes", () => {
  it("makes an anchor a cta_click goal with its location", () => {
    expect(dataFastCtaAttributes("hero", "signup")).toEqual({
      "data-fast-goal": "cta_click",
      "data-fast-goal-location": "hero",
      "data-fast-goal-target": "signup",
    });
  });

  it("adds a slug plan and drops one that is not a slug", () => {
    expect(
      dataFastCtaAttributes("pricing_plan", "signup", "starter"),
    ).toMatchObject({
      "data-fast-goal-plan": "starter",
    });
    expect(
      dataFastCtaAttributes("pricing_plan", "signup", "Starter Plan"),
    ).not.toHaveProperty("data-fast-goal-plan");
  });

  it("covers every GA cta location so the two funnels line up", () => {
    expect(DATAFAST_CTA_LOCATIONS).toEqual(
      expect.arrayContaining(["header", "hero", "pricing_plan", "demo"]),
    );
  });
});

describe("dataFastToolGoal", () => {
  it("maps each live tool to its dedicated goal", () => {
    expect(dataFastToolGoal("website-spell-checker")).toEqual({
      name: "tool_typo_finder_run",
      params: {},
    });
    expect(dataFastToolGoal("website-maintenance-cost")).toEqual({
      name: "tool_cost_calculator_used",
      params: {},
    });
  });

  it("falls back to tool_run carrying the slug", () => {
    expect(dataFastToolGoal("website-broken-links")).toEqual({
      name: "tool_run",
      params: { tool: "website-broken-links" },
    });
    expect(dataFastToolGoal("constructor").name).toBe("tool_run");
  });
});

describe("s120 site-owner path goals", () => {
  it("names the install-handoff goals with valid, unreserved names", () => {
    expect(DATAFAST_GOALS).toMatchObject({
      installMethodSelected: "install_method_selected",
      developerMessageCopied: "developer_message_copied",
      developerMessageEmailed: "developer_message_emailed",
    });
    for (const name of [
      DATAFAST_GOALS.installMethodSelected,
      DATAFAST_GOALS.developerMessageCopied,
      DATAFAST_GOALS.developerMessageEmailed,
    ]) {
      expect(name).toMatch(/^[a-z0-9_:-]{1,64}$/);
      expect(DATAFAST_RESERVED_GOAL_NAMES).not.toContain(name);
    }
  });

  it("knows every new CTA location, as a categorical slug", () => {
    for (const location of [
      "owners_hero",
      "owners_handoff",
      "owners_final",
      "wp_guide",
      "dev_guide",
    ] as const) {
      expect(DATAFAST_CTA_LOCATIONS).toContain(location);
      expect(sanitizeGoalParams({ location })).toEqual({ location });
    }
    expect(dataFastCtaAttributes("owners_handoff", "docs")).toEqual({
      "data-fast-goal": "cta_click",
      "data-fast-goal-location": "owners_handoff",
      "data-fast-goal-target": "docs",
    });
  });

  it("keeps the install-method params categorical", () => {
    expect(
      sanitizeGoalParams({ method: "developer", location: "dashboard_site" }),
    ).toEqual({ method: "developer", location: "dashboard_site" });
    expect(
      sanitizeGoalParams({ location: "dashboard_site", body: "short" }),
    ).toEqual({ location: "dashboard_site", body: "short" });
  });
});
