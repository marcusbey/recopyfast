/**
 * The DataFast goal taxonomy (ADR 074) — every goal name RecopyFast sends,
 * the params each may carry, and the one sanitiser every param passes through.
 *
 * Goal names live here and nowhere else: a component or route that spells a
 * goal inline is a goal nobody can find when the dashboard funnel stops adding
 * up. DataFast's own rules (docs, 2026-10-22): names are `a-z0-9 _ - :`, at
 * most 64 characters; at most 10 params per event, values at most 255.
 *
 * PRIVACY RULE. DataFast runs before consent (ADR 073), so a param is never
 * anything that identifies a person or a customer: no email, name, site URL,
 * domain, token, site id or user id. Only categorical values from a closed set.
 * `sanitizeGoalParams` enforces that structurally — a value must match
 * `CATEGORICAL_VALUE`, which no email (`@`, `.`), URL (`:`, `/`, `.`) or
 * site token (`.`) can satisfy — so a future caller who passes the wrong thing
 * loses the param instead of leaking it.
 */

export const DATAFAST_GOALS = {
  /** A click on a signup/trial/purchase CTA (data attributes, no JS). */
  ctaClick: "cta_click",
  /** First text edit in the /demo or /try sample, once per page view. */
  demoEdit: "demo_edit",
  /** The website spell checker produced its report. */
  toolTypoFinderRun: "tool_typo_finder_run",
  /** The maintenance cost calculator produced the visitor's own result. */
  toolCostCalculatorUsed: "tool_cost_calculator_used",
  /** Any future /tools entry without a dedicated goal (param: its slug). */
  toolRun: "tool_run",
  /** The install snippet (or the agent brief) was copied. */
  installSnippetCopied: "install_snippet_copied",
  /** "Who will add the line?" answered at the install step (s120). */
  installMethodSelected: "install_method_selected",
  /** The ready-to-send developer message was copied (s120). */
  developerMessageCopied: "developer_message_copied",
  /** "Open in my email app" opened the developer message's mailto (s120). */
  developerMessageEmailed: "developer_message_emailed",
  /** /signup's magic-link request succeeded (client; no email param). */
  signupEmailSubmitted: "signup_email_submitted",
  /** /login's magic-link request succeeded (client; no email param). */
  loginEmailSubmitted: "login_email_submitted",
  /** Server: a verified session started this account's first trial. */
  signup: "signup",
  /** Server: `ensureTrialStarted` granted the trial. */
  appTrialStarted: "app_trial_started",
  /** Server: `/api/sites/register` created a site. */
  siteCreated: "site_created",
  /** Server: a site's first authenticated embed report flipped it to live. */
  scriptInstalled: "script_installed",
  /** Server: a site's first publish of edited copy. */
  firstEditPublished: "first_edit_published",
} as const;

export type DataFastGoalName =
  (typeof DATAFAST_GOALS)[keyof typeof DATAFAST_GOALS];

/**
 * Names DataFast reserves for its payment-provider integration. Sending one of
 * these as a custom goal would corrupt the revenue reports the Stripe
 * connection fills in; the test suite asserts none of ours collides.
 */
export const DATAFAST_RESERVED_GOAL_NAMES = [
  "payment",
  "free_trial",
  "trial_started",
  "trial_converted",
  "subscription_started",
  "subscription_upgraded",
  "subscription_downgraded",
  "subscription_renewed",
  "subscription_cancel_scheduled",
  "subscription_reactivated",
  "subscription_ended",
] as const;

/**
 * Where a CTA sits. The same strings as the GA `data-cta-location` already on
 * each anchor (gtag.ts), so the two tools' funnels can be read side by side.
 */
export const DATAFAST_CTA_LOCATIONS = [
  "header",
  "header_mobile",
  "hero",
  "editorial_hero",
  "editorial_final",
  "final_cta",
  "founding_offer",
  "pricing_plan",
  "pricing_lifetime_pro",
  "pricing_founding_agency",
  "demo",
  "try_page",
  "blog_index",
  "compare_index",
  "comparison_page",
  "tool_page",
  "tool_cta",
  "blog_post",
  // s120: the site-owner page and the two install guides it links.
  "owners_hero",
  "owners_handoff",
  "owners_final",
  "wp_guide",
  "dev_guide",
] as const;

export type DataFastCtaLocation = (typeof DATAFAST_CTA_LOCATIONS)[number];

export const DATAFAST_SNIPPET_LOCATIONS = [
  "docs_agent_instructions",
  "dashboard_site",
  "dashboard_registration",
  "dashboard_quick_setup",
] as const;

export type DataFastSnippetLocation =
  (typeof DATAFAST_SNIPPET_LOCATIONS)[number];

/** Where the install-method choice is shown (s120). */
export type DataFastInstallChoiceLocation =
  | "dashboard_registration"
  | "dashboard_site";

/** Who adds the snippet: the owner, or their developer (s120). */
export type DataFastInstallMethod = "self" | "developer";

type NoParams = Record<string, never>;

/** The params each goal may carry. Every value is categorical. */
export interface DataFastGoalParams {
  cta_click: {
    location: DataFastCtaLocation;
    target: DataFastCtaTarget;
    plan?: string;
  };
  demo_edit: { surface: "demo" | "try" };
  tool_typo_finder_run: NoParams;
  tool_cost_calculator_used: NoParams;
  tool_run: { tool: string };
  install_snippet_copied: { location: DataFastSnippetLocation };
  install_method_selected: {
    method: DataFastInstallMethod;
    location: DataFastInstallChoiceLocation;
  };
  developer_message_copied: { location: DataFastInstallChoiceLocation };
  developer_message_emailed: {
    location: DataFastInstallChoiceLocation;
    /**
     * What the draft carried: the whole message ("full"), the snippet and
     * guide link ("short"), or the subject only ("none").
     */
    body: "full" | "short" | "none";
  };
  signup_email_submitted: NoParams;
  login_email_submitted: NoParams;
  signup: NoParams;
  app_trial_started: { offer: "founding" | "standard" };
  site_created: NoParams;
  script_installed: NoParams;
  first_edit_published: NoParams;
}

/** Goals sent from the browser via `trackGoal` (datafast-client.ts). */
export type DataFastClientGoal =
  | "demo_edit"
  | "tool_typo_finder_run"
  | "tool_cost_calculator_used"
  | "tool_run"
  | "install_snippet_copied"
  | "install_method_selected"
  | "developer_message_copied"
  | "developer_message_emailed"
  | "signup_email_submitted"
  | "login_email_submitted";

/** Goals sent from the server via `sendDataFastGoal` (datafast-server.ts). */
export type DataFastServerGoal =
  | "signup"
  | "app_trial_started"
  | "site_created"
  | "script_installed"
  | "first_edit_published";

const PARAM_KEY = /^[a-z0-9_-]{1,64}$/;
/** Lowercase slug, ≤64. Deliberately far narrower than DataFast's 255. */
const CATEGORICAL_VALUE = /^[a-z0-9_-]{1,64}$/;
const MAX_PARAMS = 10;

/**
 * Keep only well-formed categorical params, at most ten. Anything else is
 * dropped silently: a goal without its param is still a goal, and a param that
 * fails here is by construction something that should never have been sent.
 */
export function sanitizeGoalParams(params: unknown): Record<string, string> {
  if (typeof params !== "object" || params === null) return {};
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Object.keys(clean).length >= MAX_PARAMS) break;
    if (!PARAM_KEY.test(key)) continue;
    if (typeof value !== "string" || !CATEGORICAL_VALUE.test(value)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Where the CTA leads: the signup form, checkout, a try-it surface, or an
 * install guide (s120: the owner page's "send this to your developer").
 */
export type DataFastCtaTarget = "signup" | "checkout" | "demo" | "try" | "docs";

export type DataFastCtaAttributes = {
  "data-fast-goal": "cta_click";
  "data-fast-goal-location": DataFastCtaLocation;
  "data-fast-goal-target": DataFastCtaTarget;
  "data-fast-goal-plan"?: string;
};

/**
 * The attributes that make an anchor a `cta_click` goal. DataFast's script
 * reads `data-fast-goal-*` on click (kebab → snake_case), so this works on a
 * prerendered marketing page with no React handler at all. `plan` is a
 * catalogue id ("starter", "lifetime_pro"); one that is not a slug is dropped.
 * Put it on the anchor itself: DataFast counts clicks on the tagged element.
 */
export function dataFastCtaAttributes(
  location: DataFastCtaLocation,
  target: DataFastCtaTarget,
  plan?: string,
): DataFastCtaAttributes {
  return {
    "data-fast-goal": DATAFAST_GOALS.ctaClick,
    "data-fast-goal-location": location,
    "data-fast-goal-target": target,
    ...(plan && CATEGORICAL_VALUE.test(plan)
      ? { "data-fast-goal-plan": plan }
      : {}),
  };
}

const TOOL_GOALS: Readonly<
  Record<string, "tool_typo_finder_run" | "tool_cost_calculator_used">
> = {
  "website-spell-checker": DATAFAST_GOALS.toolTypoFinderRun,
  "website-maintenance-cost": DATAFAST_GOALS.toolCostCalculatorUsed,
};

export type DataFastToolGoal =
  | {
      name: "tool_typo_finder_run" | "tool_cost_calculator_used";
      params: NoParams;
    }
  | { name: "tool_run"; params: { tool: string } };

/** The goal a successful run of the tool at `slug` sends. */
export function dataFastToolGoal(slug: string): DataFastToolGoal {
  const dedicated = Object.prototype.hasOwnProperty.call(TOOL_GOALS, slug)
    ? TOOL_GOALS[slug]
    : undefined;
  return dedicated
    ? { name: dedicated, params: {} }
    : { name: DATAFAST_GOALS.toolRun, params: { tool: slug } };
}
