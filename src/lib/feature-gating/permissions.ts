import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  getEffectivePlan,
  hasAnyEntitlement,
} from "@/lib/billing/entitlements";
import {
  getUserCreditBalance,
  consumeCredits,
  CREDIT_COSTS,
} from "@/lib/credits/system";

/**
 * Feature gates.
 *
 * Every allowance read here comes from the `plans` table via
 * `getEffectivePlan`, which resolves lifetime entitlements as well as live
 * subscriptions. Nothing in this file hardcodes what a plan includes.
 *
 * An account with no plan is denied outright, before any quota arithmetic.
 * There is no free tier to fall through to: `getEffectivePlan` returns an
 * `Entitlement`, and the union does not expose `.limits` until the caller has
 * checked `entitled`, so every gate below has to say what it does about a user
 * who has not paid.
 *
 * The 14-day trial does not change that, and is not a free tier: it is a plan
 * entitlement with an end date — a row in `plan_entitlements` conferring `pro`
 * until `expires_at` (ADR 014). A trialling account therefore arrives at every
 * gate below as `kind: "plan"` with Pro's limits read verbatim from the
 * catalogue, and needs no branch of its own here. When the window closes the
 * row stops being selected and the same account resolves to `none`, meeting
 * exactly the denials already written below. Nothing in this file distinguishes
 * a trial from a purchase, deliberately: a second opinion about who is entitled
 * is how the two come to disagree.
 */

export interface FeaturePermission {
  allowed: boolean;
  reason?: string;
  requiresCredits?: boolean;
  creditsRequired?: number;
  upgradeRequired?: boolean;
  currentLimit?: number;
  maxLimit?: number;
}

/** `-1` in a plan limit means unlimited. */
const UNLIMITED = -1;

/**
 * The denial for an account with nothing at all — no plan, no credits.
 *
 * `upgradeRequired` sends the UI to the plan picker.
 */
const NO_ENTITLEMENT: FeaturePermission = {
  allowed: false,
  reason: "This account has no active plan. Choose a plan to continue.",
  upgradeRequired: true,
};

/**
 * The denial for a credit holder reaching for something credits do not buy.
 *
 * Distinct from `NO_ENTITLEMENT` because the remedy is different and so is the
 * truth: they have paid us for something, it works, and this particular thing
 * is not it. Sites and seats are plan-shaped — a quota, not metered usage — and
 * a wallet balance must never be mistaken for one.
 */
const CREDITS_ARE_NOT_A_PLAN: FeaturePermission = {
  allowed: false,
  reason:
    "Your credits cover AI features. Creating sites and inviting collaborators needs a plan.",
  upgradeRequired: true,
};

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

/**
 * How many sites this user owns.
 *
 * `sites` has no owner column — ownership is an `admin` row in
 * site_permissions, which is what POST /api/sites/register writes. The previous
 * `sites.user_id` filter returned a PostgREST 42703 that was discarded with the
 * count, so every quota check saw 0 sites and passed unconditionally.
 *
 * Throws instead of defaulting to 0: a count that cannot be read must not be
 * read as "plenty of room".
 */
async function countOwnedSites(
  supabase: SupabaseLike,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("site_permissions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("permission", "admin");

  if (error) {
    throw new Error(`Failed to count owned sites: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Check if user can create a new website
 */
export async function canCreateWebsite(
  userId: string,
): Promise<FeaturePermission> {
  // Quota-shaped: only a plan carries one. Credits are metered usage and buy
  // no allowance here, however large the balance.
  const entitlement = await getEffectivePlan(userId);
  if (entitlement.kind !== "plan") {
    return entitlement.kind === "credits"
      ? CREDITS_ARE_NOT_A_PLAN
      : NO_ENTITLEMENT;
  }
  const { plan } = entitlement;

  const supabase = await createClient();
  const currentWebsites = await countOwnedSites(supabase, userId);
  const websiteLimit = plan.limits.websites;

  if (websiteLimit === UNLIMITED) {
    return { allowed: true };
  }

  if (currentWebsites < websiteLimit) {
    return {
      allowed: true,
      currentLimit: currentWebsites,
      maxLimit: websiteLimit,
    };
  }

  // Plans that sell overage sites say so, so the customer sees a price rather
  // than a wall.
  const overage = plan.additionalSitePrice;
  const reason =
    overage !== null
      ? `Your ${plan.name} plan includes ${websiteLimit} website${websiteLimit === 1 ? "" : "s"}. ` +
        `Additional sites are $${overage} each per month.`
      : `You've reached your limit of ${websiteLimit} website${websiteLimit === 1 ? "" : "s"}`;

  return {
    allowed: false,
    reason,
    upgradeRequired: true,
    currentLimit: currentWebsites,
    maxLimit: websiteLimit,
  };
}

/**
 * Whose plan a seat on this site is charged to.
 *
 * Ownership is an `admin` row in site_permissions, the same definition
 * `countOwnedSites` uses — `sites` has no owner column.
 *
 * Throws rather than defaulting, for the same reason the site count does: a
 * lookup that failed must not be read as "nobody owns this, let it through".
 */
async function resolveSiteOwnerId(
  supabase: SupabaseLike,
  siteId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("site_permissions")
    .select("user_id")
    .eq("site_id", siteId)
    .eq("permission", "admin")
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (error) {
    throw new Error(`Failed to resolve site owner: ${error.message}`);
  }

  return data?.user_id ?? null;
}

/**
 * Can another collaborator be added to this site?
 *
 * Charged to the site's **owner**, not to whoever is doing the sharing. A
 * manager may share a site they do not own, so billing the actor would let a
 * Starter owner hand a Pro manager the ability to invite without limit — the
 * seats would land on the Starter site and be paid for by nobody.
 *
 * Falls back to the actor when no owner row exists. That is a data
 * inconsistency rather than a permitted state, and the actor is already known
 * to hold manager or owner rights on the site, so it is the closest available
 * payer — but it is logged, because a site with no owner is a bug worth
 * seeing.
 */
export async function canShareSite(
  siteId: string,
  actingUserId: string,
): Promise<FeaturePermission> {
  const supabase = await createClient();
  const ownerId = await resolveSiteOwnerId(supabase, siteId);

  if (!ownerId) {
    console.error(
      `[feature-gating] site ${siteId} has no admin row; charging the seat to the acting user instead`,
    );
  }

  return canAddCollaborator(ownerId ?? actingUserId, siteId);
}

/**
 * Every seat occupied on a site, across both doors that create one.
 *
 * A seat is a person with standing access to change live copy, and two tables
 * grant exactly that: `site_permissions` holds collaborators who have a
 * ReCopyFast account, `site_editors` holds email addresses on the durable
 * allowlist — usually a client's marketing contact who has no account and never
 * will. They are different records of the same purchased thing.
 *
 * Counting only the first is what made the limit avoidable. Each door checked
 * its own table, so each independently allowed N and alternating between them
 * allowed 2N. One count, read by both paths, is the only shape that cannot
 * drift — the same reason `hasAnyEntitlement` exists rather than each gate
 * deciding for itself what "entitled" means.
 *
 * `site_editors` is read with the service-role client deliberately. Its SELECT
 * policy requires `admin` on the site, and the share path admits managers too,
 * so a request-scoped read would return 0 for precisely the caller in the best
 * position to exploit it. A quota that RLS can silently zero is not a quota.
 *
 * Both reads throw on failure rather than coalescing to 0, for the reason
 * `countOwnedSites` documents: a count that could not be read must never be
 * read as "plenty of room".
 */
async function countOccupiedSeats(
  supabase: SupabaseLike,
  siteId: string,
  payerId: string,
): Promise<number> {
  const { count: collaborators, error: collaboratorError } = await supabase
    .from("site_permissions")
    .select("*", { count: "exact", head: true })
    .eq("site_id", siteId)
    .neq("user_id", payerId); // The payer holds their own site, not a seat on it.

  if (collaboratorError) {
    throw new Error(
      `Failed to count collaborator seats: ${collaboratorError.message}`,
    );
  }

  const { count: editors, error: editorError } = await createServiceRoleClient()
    .from("site_editors")
    .select("*", { count: "exact", head: true })
    .eq("site_id", siteId)
    .is("revoked_at", null); // A revoked editor has given their seat back.

  if (editorError) {
    throw new Error(`Failed to count editor seats: ${editorError.message}`);
  }

  return (collaborators ?? 0) + (editors ?? 0);
}

/**
 * Can this site take another seat, charged to `userId`'s plan?
 *
 * Named for the collaborator path it was written for, but the allowance it
 * reads is per-site and covers editors too — see `countOccupiedSeats`. Both
 * POST /api/sites/[siteId]/share and POST /api/editor/editors consume this,
 * which is what makes the limit hold whichever door is used.
 */
export async function canAddCollaborator(
  userId: string,
  siteId: string,
): Promise<FeaturePermission> {
  // Quota-shaped: only a plan carries one. Credits are metered usage and buy
  // no allowance here, however large the balance.
  const entitlement = await getEffectivePlan(userId);
  if (entitlement.kind !== "plan") {
    return entitlement.kind === "credits"
      ? CREDITS_ARE_NOT_A_PLAN
      : NO_ENTITLEMENT;
  }
  const { plan } = entitlement;
  const collaboratorLimit = plan.limits.collaborators;

  // Answered before counting: a plan selling no seats and one selling unlimited
  // both have the same answer whatever the current occupancy is, and neither
  // needs two round trips to reach it.
  if (collaboratorLimit === 0) {
    return {
      allowed: false,
      reason:
        `Your ${plan.name} plan does not include collaborator seats. ` +
        `Upgrade to invite editors or collaborators to this site.`,
      upgradeRequired: true,
      currentLimit: 0,
      maxLimit: 0,
    };
  }

  if (collaboratorLimit === UNLIMITED) {
    return { allowed: true };
  }

  const supabase = await createClient();
  const occupiedSeats = await countOccupiedSeats(supabase, siteId, userId);

  if (occupiedSeats < collaboratorLimit) {
    return {
      allowed: true,
      currentLimit: occupiedSeats,
      maxLimit: collaboratorLimit,
    };
  }

  return {
    allowed: false,
    // Says "seats" rather than "collaborators", because the number counts
    // editors as well and an owner told they have 5 collaborators while seeing
    // two in the list would reasonably conclude the count is broken.
    reason:
      `You've used all ${collaboratorLimit} seat${collaboratorLimit === 1 ? "" : "s"} on your ${plan.name} plan for this site. ` +
      `Editors and collaborators share the same allowance — remove one, or upgrade for more.`,
    upgradeRequired: true,
    currentLimit: occupiedSeats,
    maxLimit: collaboratorLimit,
  };
}

/**
 * Check if user can use AI features.
 *
 * AI is metered, so a credit balance is sufficient on its own whatever plan the
 * holder is on. The plan's `aiFeatures` flag used to be checked first and deny
 * outright, which left a paying Starter subscriber worse off at AI than someone
 * with no plan and a wallet. That inversion is what this ordering removes: the
 * balance decides, and the flag only shapes what we say when the balance is
 * short.
 */
export async function canUseAIFeatures(
  userId: string,
  creditsRequired: number = CREDIT_COSTS.AI_SUGGESTION,
): Promise<FeaturePermission> {
  const entitlement = await getEffectivePlan(userId);

  if (!hasAnyEntitlement(entitlement)) {
    return NO_ENTITLEMENT;
  }

  const creditBalance = await getUserCreditBalance(userId);

  if (creditBalance.total >= creditsRequired) {
    return { allowed: true };
  }

  // Out of credits, and what to do about it depends on where more would come
  // from. A plan that includes AI grants an allowance that refills next period;
  // one that does not never will, so the remedy there is to buy a pack rather
  // than to wait for a renewal that was never coming.
  if (entitlement.kind === "plan" && !entitlement.plan.limits.aiFeatures) {
    return {
      allowed: false,
      reason:
        `Your ${entitlement.plan.name} plan does not include AI credits. ` +
        `Buy credits to use AI features — this costs ${creditsRequired} and you have ${creditBalance.total}.`,
      requiresCredits: true,
      creditsRequired,
    };
  }

  return {
    allowed: false,
    reason: `Insufficient credits. You need ${creditsRequired} credits but only have ${creditBalance.total}.`,
    requiresCredits: true,
    creditsRequired,
  };
}

/**
 * Check if user can use translation features
 */
export async function canUseTranslation(
  userId: string,
): Promise<FeaturePermission> {
  const entitlement = await getEffectivePlan(userId);

  if (!hasAnyEntitlement(entitlement)) {
    return NO_ENTITLEMENT;
  }

  // A credit holder has no included allowance, so they take the pay-per-use
  // path below — the same one a plan with `translations: 0` takes.
  const translationLimit =
    entitlement.kind === "plan" ? entitlement.plan.limits.translations : 0;

  if (translationLimit === 0) {
    // Plans with no included translation allowance can still pay per use out
    // of purchased credits.
    const balance = await getUserCreditBalance(userId);

    if (balance.total >= 1) {
      return {
        allowed: true,
        requiresCredits: true,
        creditsRequired: 1,
      };
    }

    return {
      allowed: false,
      reason: "Translation features require a Pro plan, or purchased credits",
      upgradeRequired: true,
      requiresCredits: true,
      creditsRequired: 1,
    };
  }

  // Unlimited translations or within limit
  return { allowed: true };
}

/**
 * Consume feature usage (for credit-based features)
 */
export async function consumeFeatureUsage(
  userId: string,
  feature: "ai_suggestion" | "translation" | "collaboration",
  metadata?: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  let creditsRequired = 0;
  if (feature === "ai_suggestion") {
    creditsRequired = CREDIT_COSTS.AI_SUGGESTION;
  } else if (feature === "translation") {
    creditsRequired = CREDIT_COSTS.AI_TRANSLATION;
  }

  const permission = await (feature === "ai_suggestion"
    ? canUseAIFeatures(userId, creditsRequired)
    : canUseTranslation(userId));

  if (!permission.allowed) {
    return { success: false, error: permission.reason };
  }

  if (feature === "ai_suggestion" || feature === "translation") {
    const result = await consumeCredits(
      userId,
      creditsRequired,
      feature,
      metadata,
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }
  }

  await supabase.from("usage_tracking").insert({
    user_id: userId,
    feature_type: feature,
    count: 1,
    metadata: {
      ...metadata,
      credits_used: creditsRequired,
    },
  });

  return { success: true };
}

/**
 * Get user's current usage limits and status
 */
export async function getUserUsageLimits(userId: string) {
  const supabase = await createClient();
  const entitlement = await getEffectivePlan(userId);
  const creditBalance = await getUserCreditBalance(userId);

  const websiteCount = await countOwnedSites(supabase, userId);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: monthlyUsage } = await supabase
    .from("usage_tracking")
    .select("feature_type, count")
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  const aiUsage =
    monthlyUsage
      ?.filter((u) => u.feature_type === "ai_suggestion")
      .reduce((total, u) => total + u.count, 0) || 0;

  const translationUsage =
    monthlyUsage
      ?.filter((u) => u.feature_type === "translation")
      .reduce((total, u) => total + u.count, 0) || 0;

  return {
    // Null rather than a stand-in plan, so a caller rendering "you are on the
    // X plan" has to decide what to say to someone who is on none. A credit
    // holder is on none — that is the point of the distinction.
    plan:
      entitlement.kind === "plan"
        ? {
            id: entitlement.planId,
            name: entitlement.plan.name,
            limits: entitlement.plan.limits,
          }
        : null,
    current: {
      websites: websiteCount,
      aiUsage,
      translationUsage,
      creditBalance: creditBalance.total,
    },
    permissions: {
      canCreateWebsite: await canCreateWebsite(userId),
      canUseAI: await canUseAIFeatures(userId),
      canUseTranslation: await canUseTranslation(userId),
    },
  };
}

/**
 * Middleware to check feature access
 */
export async function requireFeatureAccess(
  userId: string,
  feature: "websites" | "ai" | "translation" | "collaborators",
  siteId?: string,
): Promise<{ allowed: boolean; error?: string; upgradeRequired?: boolean }> {
  let permission: FeaturePermission;

  switch (feature) {
    case "websites":
      permission = await canCreateWebsite(userId);
      break;
    case "ai":
      permission = await canUseAIFeatures(userId);
      break;
    case "translation":
      permission = await canUseTranslation(userId);
      break;
    case "collaborators":
      if (!siteId) {
        return {
          allowed: false,
          error: "Site ID required for collaborator check",
        };
      }
      permission = await canAddCollaborator(userId, siteId);
      break;
    default:
      return { allowed: false, error: "Unknown feature" };
  }

  return {
    allowed: permission.allowed,
    error: permission.reason,
    upgradeRequired: permission.upgradeRequired,
  };
}
