import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
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
 * The single denial for an account with no plan.
 *
 * Every gate returns this rather than a feature-specific message, because the
 * answer is the same regardless of what was asked for and the remedy is the
 * same too. `upgradeRequired` sends the UI to the plan picker.
 *
 * Purchased credits do not buy their way past it. Credits are an add-on to a
 * plan, not a substitute for one, and nothing is destroyed by the denial — a
 * wallet balance survives untouched and is spendable again the moment the
 * account has a plan.
 */
const NO_PLAN: FeaturePermission = {
  allowed: false,
  reason: "This account has no active plan. Choose a plan to continue.",
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
  const entitlement = await getEffectivePlan(userId);
  if (!entitlement.entitled) {
    return NO_PLAN;
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
 * Check if user can add collaborators
 */
export async function canAddCollaborator(
  userId: string,
  siteId: string,
): Promise<FeaturePermission> {
  const entitlement = await getEffectivePlan(userId);
  if (!entitlement.entitled) {
    return NO_PLAN;
  }
  const { plan } = entitlement;

  const supabase = await createClient();
  const { count: currentCollaborators } = await supabase
    .from("site_permissions")
    .select("*", { count: "exact", head: true })
    .eq("site_id", siteId)
    .neq("user_id", userId); // Exclude the owner

  const collaboratorLimit = plan.limits.collaborators;

  if (collaboratorLimit === 0) {
    return {
      allowed: false,
      reason: "Collaborators are not available on your current plan",
      upgradeRequired: true,
      currentLimit: 0,
      maxLimit: 0,
    };
  }

  if (collaboratorLimit === UNLIMITED) {
    return { allowed: true };
  }

  if ((currentCollaborators || 0) < collaboratorLimit) {
    return {
      allowed: true,
      currentLimit: currentCollaborators || 0,
      maxLimit: collaboratorLimit,
    };
  }

  return {
    allowed: false,
    reason: `You've reached your limit of ${collaboratorLimit} collaborator${collaboratorLimit === 1 ? "" : "s"} per website`,
    upgradeRequired: true,
    currentLimit: currentCollaborators || 0,
    maxLimit: collaboratorLimit,
  };
}

/**
 * Check if user can use AI features
 */
export async function canUseAIFeatures(
  userId: string,
  creditsRequired: number = CREDIT_COSTS.AI_SUGGESTION,
): Promise<FeaturePermission> {
  const entitlement = await getEffectivePlan(userId);
  if (!entitlement.entitled) {
    return NO_PLAN;
  }
  const { plan } = entitlement;

  if (!plan.limits.aiFeatures) {
    return {
      allowed: false,
      reason: "AI features require a Pro subscription",
      upgradeRequired: true,
    };
  }

  const creditBalance = await getUserCreditBalance(userId);

  if (creditBalance.total < creditsRequired) {
    return {
      allowed: false,
      reason: `Insufficient credits. You need ${creditsRequired} credits but only have ${creditBalance.total}.`,
      requiresCredits: true,
      creditsRequired,
    };
  }

  return { allowed: true };
}

/**
 * Check if user can use translation features
 */
export async function canUseTranslation(
  userId: string,
): Promise<FeaturePermission> {
  const entitlement = await getEffectivePlan(userId);
  if (!entitlement.entitled) {
    return NO_PLAN;
  }

  const translationLimit = entitlement.plan.limits.translations;

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
    // X plan" has to decide what to say to someone who is on none.
    plan: entitlement.entitled
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
