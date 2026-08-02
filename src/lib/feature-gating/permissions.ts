import { createClient } from "@/lib/supabase/server";
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
 * Check if user can add collaborators
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
