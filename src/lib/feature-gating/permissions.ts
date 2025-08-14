import { createClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/stripe/subscription';
import { getUserTicketBalance, consumeTickets } from '@/lib/stripe/tickets';
import { SUBSCRIPTION_PLANS } from '@/lib/stripe/config';

export interface FeaturePermission {
  allowed: boolean;
  reason?: string;
  requiresTickets?: boolean;
  ticketsRequired?: number;
  upgradeRequired?: boolean;
  currentLimit?: number;
  maxLimit?: number;
}

/**
 * Check if user can create a new website
 */
export async function canCreateWebsite(userId: string): Promise<FeaturePermission> {
  const supabase = await createClient();
  const subscription = await getUserSubscription(userId);
  
  const planId = subscription?.plan_id || 'free';
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  
  // Count current websites
  const { count: currentWebsites } = await supabase
    .from('sites')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const websiteLimit = plan.limits.websites;
  
  // Unlimited websites
  if (websiteLimit === -1) {
    return { allowed: true };
  }
  
  // Check if within limit
  if ((currentWebsites || 0) < websiteLimit) {
    return { 
      allowed: true,
      currentLimit: currentWebsites || 0,
      maxLimit: websiteLimit
    };
  }
  
  return {
    allowed: false,
    reason: `You've reached your limit of ${websiteLimit} website${websiteLimit === 1 ? '' : 's'}`,
    upgradeRequired: true,
    currentLimit: currentWebsites || 0,
    maxLimit: websiteLimit
  };
}

/**
 * Check if user can add collaborators
 */
export async function canAddCollaborator(userId: string, siteId: string): Promise<FeaturePermission> {
  const supabase = await createClient();
  const subscription = await getUserSubscription(userId);
  
  const planId = subscription?.plan_id || 'free';
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  
  // Count current collaborators for the site
  const { count: currentCollaborators } = await supabase
    .from('site_permissions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .neq('user_id', userId); // Exclude the owner
    
  const collaboratorLimit = plan.limits.collaborators;
  
  // No collaborators allowed
  if (collaboratorLimit === 0) {
    return {
      allowed: false,
      reason: 'Collaborators are not available on your current plan',
      upgradeRequired: true,
      currentLimit: 0,
      maxLimit: 0
    };
  }
  
  // Unlimited collaborators
  if (collaboratorLimit === -1) {
    return { allowed: true };
  }
  
  // Check if within limit
  if ((currentCollaborators || 0) < collaboratorLimit) {
    return { 
      allowed: true,
      currentLimit: currentCollaborators || 0,
      maxLimit: collaboratorLimit
    };
  }
  
  return {
    allowed: false,
    reason: `You've reached your limit of ${collaboratorLimit} collaborator${collaboratorLimit === 1 ? '' : 's'} per website`,
    upgradeRequired: true,
    currentLimit: currentCollaborators || 0,
    maxLimit: collaboratorLimit
  };
}

/**
 * Check if user can use AI features
 */
export async function canUseAIFeatures(userId: string, ticketsRequired: number = 1): Promise<FeaturePermission> {
  const subscription = await getUserSubscription(userId);
  const planId = subscription?.plan_id || 'free';
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  
  // AI features not available on current plan
  if (!plan.limits.aiFeatures) {
    // Check if user has tickets
    const ticketBalance = await getUserTicketBalance(userId);
    
    if (ticketBalance >= ticketsRequired) {
      return {
        allowed: true,
        requiresTickets: true,
        ticketsRequired,
      };
    }
    
    return {
      allowed: false,
      reason: 'AI features require a Pro or Enterprise plan, or individual tickets',
      upgradeRequired: true,
      requiresTickets: true,
      ticketsRequired,
    };
  }
  
  // AI features included in plan
  return { allowed: true };
}

/**
 * Check if user can use translation features
 */
export async function canUseTranslation(userId: string): Promise<FeaturePermission> {
  const subscription = await getUserSubscription(userId);
  const planId = subscription?.plan_id || 'free';
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  
  const translationLimit = plan.limits.translations;
  
  // No translations allowed
  if (translationLimit === 0) {
    // Check if user has tickets
    const ticketBalance = await getUserTicketBalance(userId);
    
    if (ticketBalance >= 1) {
      return {
        allowed: true,
        requiresTickets: true,
        ticketsRequired: 1,
      };
    }
    
    return {
      allowed: false,
      reason: 'Translation features require a Pro or Enterprise plan, or individual tickets',
      upgradeRequired: true,
      requiresTickets: true,
      ticketsRequired: 1,
    };
  }
  
  // Unlimited translations or within limit
  return { allowed: true };
}

/**
 * Consume feature usage (for ticket-based features)
 */
export async function consumeFeatureUsage(
  userId: string,
  feature: 'ai_suggestion' | 'translation' | 'collaboration',
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  
  // Check if feature requires tickets
  const permission = await (feature === 'ai_suggestion' 
    ? canUseAIFeatures(userId) 
    : canUseTranslation(userId));
    
  if (!permission.allowed) {
    return { success: false, error: permission.reason };
  }
  
  // Consume tickets if required
  if (permission.requiresTickets && permission.ticketsRequired) {
    const success = await consumeTickets(
      userId,
      permission.ticketsRequired,
      `${feature} usage`
    );
    
    if (!success) {
      return { success: false, error: 'Insufficient tickets' };
    }
  }
  
  // Track usage
  await supabase
    .from('usage_tracking')
    .insert({
      user_id: userId,
      feature_type: feature,
      count: 1,
      metadata: metadata || {},
    });
    
  return { success: true };
}

/**
 * Get user's current usage limits and status
 */
export async function getUserUsageLimits(userId: string) {
  const supabase = await createClient();
  const subscription = await getUserSubscription(userId);
  const ticketBalance = await getUserTicketBalance(userId);
  
  const planId = subscription?.plan_id || 'free';
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  
  // Get current usage counts
  const { count: websiteCount } = await supabase
    .from('sites')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
    
  // Get this month's usage
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const { data: monthlyUsage } = await supabase
    .from('usage_tracking')
    .select('feature_type, count')
    .eq('user_id', userId)
    .gte('created_at', startOfMonth.toISOString());
    
  const aiUsage = monthlyUsage?.filter(u => u.feature_type === 'ai_suggestion')
    .reduce((total, u) => total + u.count, 0) || 0;
    
  const translationUsage = monthlyUsage?.filter(u => u.feature_type === 'translation')
    .reduce((total, u) => total + u.count, 0) || 0;
  
  return {
    plan: {
      id: planId,
      name: plan.name,
      limits: plan.limits,
    },
    current: {
      websites: websiteCount || 0,
      aiUsage,
      translationUsage,
      ticketBalance,
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
  feature: 'websites' | 'ai' | 'translation' | 'collaborators',
  siteId?: string
): Promise<{ allowed: boolean; error?: string; upgradeRequired?: boolean }> {
  let permission: FeaturePermission;
  
  switch (feature) {
    case 'websites':
      permission = await canCreateWebsite(userId);
      break;
    case 'ai':
      permission = await canUseAIFeatures(userId);
      break;
    case 'translation':
      permission = await canUseTranslation(userId);
      break;
    case 'collaborators':
      if (!siteId) {
        return { allowed: false, error: 'Site ID required for collaborator check' };
      }
      permission = await canAddCollaborator(userId, siteId);
      break;
    default:
      return { allowed: false, error: 'Unknown feature' };
  }
  
  return {
    allowed: permission.allowed,
    error: permission.reason,
    upgradeRequired: permission.upgradeRequired,
  };
}