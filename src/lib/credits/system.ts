import { createClient } from '@/lib/supabase/server';

// Credit costs for different AI operations
export const CREDIT_COSTS = {
  AI_SUGGESTION: 1,      // 1 credit per AI suggestion
  AI_TRANSLATION: 5,     // 5 credits per translation (more expensive)
  BULK_AI_OPERATION: 10, // 10 credits for bulk operations
} as const;

// Credit packages configuration
export const CREDIT_PACKAGES = {
  STARTER: {
    credits: 1000,
    price: 19,
    name: 'Starter Pack',
    description: '1,000 AI credits',
  },
  PROFESSIONAL: {
    credits: 5000,
    price: 79,
    name: 'Professional Pack',
    description: '5,000 AI credits (20% savings)',
  },
  ENTERPRISE: {
    credits: 20000,
    price: 299,
    name: 'Enterprise Pack',
    description: '20,000 AI credits (40% savings)',
  },
} as const;

// Monthly included credits per plan
export const PLAN_CREDITS = {
  FREE: 0,
  PRO: 500,
  ENTERPRISE: 2000,
} as const;

export interface CreditBalance {
  included: number;      // Monthly included credits from subscription
  purchased: number;     // Purchased credits that don't expire monthly
  total: number;         // Total available credits
  usedThisMonth: number; // Credits used in current billing period
}

/**
 * Get user's current credit balance
 */
export async function getUserCreditBalance(userId: string): Promise<CreditBalance> {
  const supabase = await createClient();
  
  // Get user's subscription to determine included credits
  const { data: subscription } = await supabase
    .from('billing_subscriptions')
    .select('plan_id, current_period_start, current_period_end')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
    
  const planId = subscription?.plan_id?.toUpperCase() || 'FREE';
  const includedCredits = PLAN_CREDITS[planId as keyof typeof PLAN_CREDITS] || 0;
  
  // Get purchased credits (non-expiring)
  const { data: creditPurchases } = await supabase
    .from('credit_purchases')
    .select('credits_remaining')
    .eq('user_id', userId)
    .gt('credits_remaining', 0)
    .gt('expires_at', new Date().toISOString());
    
  const purchasedCredits = creditPurchases?.reduce((sum, purchase) => 
    sum + (purchase.credits_remaining || 0), 0) || 0;
  
  // Get usage for current billing period
  const startOfPeriod = subscription?.current_period_start || new Date().toISOString();
  
  const { data: usage } = await supabase
    .from('credit_usage')
    .select('credits_used')
    .eq('user_id', userId)
    .gte('created_at', startOfPeriod);
    
  const usedThisMonth = usage?.reduce((sum, u) => sum + u.credits_used, 0) || 0;
  
  return {
    included: includedCredits,
    purchased: purchasedCredits,
    total: Math.max(0, includedCredits - usedThisMonth) + purchasedCredits,
    usedThisMonth,
  };
}

/**
 * Check if user has enough credits for an operation
 */
export async function hasEnoughCredits(
  userId: string, 
  creditsRequired: number
): Promise<boolean> {
  const balance = await getUserCreditBalance(userId);
  return balance.total >= creditsRequired;
}

/**
 * Consume credits for an AI operation
 */
export async function consumeCredits(
  userId: string,
  credits: number,
  operation: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; error?: string; remainingCredits?: number }> {
  const supabase = await createClient();
  const balance = await getUserCreditBalance(userId);
  
  if (balance.total < credits) {
    return {
      success: false,
      error: `Insufficient credits. You need ${credits} credits but only have ${balance.total}.`,
    };
  }
  
  // Record credit usage
  const { error: usageError } = await supabase
    .from('credit_usage')
    .insert({
      user_id: userId,
      credits_used: credits,
      operation,
      metadata,
    });
    
  if (usageError) {
    console.error('Error recording credit usage:', usageError);
    return {
      success: false,
      error: 'Failed to record credit usage',
    };
  }
  
  // Deduct from purchased credits if monthly credits are exhausted
  const monthlyCreditsRemaining = Math.max(0, balance.included - balance.usedThisMonth - credits);
  const creditsToDeductFromPurchased = credits - (balance.included - balance.usedThisMonth);
  
  if (creditsToDeductFromPurchased > 0) {
    // Deduct from purchased credits (oldest first)
    const { data: purchases } = await supabase
      .from('credit_purchases')
      .select('id, credits_remaining')
      .eq('user_id', userId)
      .gt('credits_remaining', 0)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });
      
    let remainingToDeduct = creditsToDeductFromPurchased;
    
    for (const purchase of purchases || []) {
      if (remainingToDeduct <= 0) break;
      
      const toDeduct = Math.min(remainingToDeduct, purchase.credits_remaining);
      
      await supabase
        .from('credit_purchases')
        .update({ 
          credits_remaining: purchase.credits_remaining - toDeduct 
        })
        .eq('id', purchase.id);
        
      remainingToDeduct -= toDeduct;
    }
  }
  
  const newBalance = await getUserCreditBalance(userId);
  
  return {
    success: true,
    remainingCredits: newBalance.total,
  };
}

/**
 * Add purchased credits to user's account
 */
export async function addPurchasedCredits(
  userId: string,
  credits: number,
  stripePaymentIntentId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  
  // Credits expire after 90 days
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  
  const { error } = await supabase
    .from('credit_purchases')
    .insert({
      user_id: userId,
      credits_purchased: credits,
      credits_remaining: credits,
      stripe_payment_intent_id: stripePaymentIntentId,
      expires_at: expiresAt.toISOString(),
    });
    
  if (error) {
    console.error('Error adding purchased credits:', error);
    return {
      success: false,
      error: 'Failed to add credits to account',
    };
  }
  
  return { success: true };
}

/**
 * Get user's credit usage history
 */
export async function getCreditUsageHistory(
  userId: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  credits_used: number;
  operation: string;
  metadata: Record<string, any>;
  created_at: string;
}>> {
  const supabase = await createClient();
  
  const { data } = await supabase
    .from('credit_usage')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
    
  return data || [];
}

/**
 * Get credit expiration warnings
 */
export async function getExpiringCredits(userId: string): Promise<{
  expiringSoon: number;
  expiresIn: number; // days
} | null> {
  const supabase = await createClient();
  
  // Check for credits expiring in next 7 days
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  
  const { data } = await supabase
    .from('credit_purchases')
    .select('credits_remaining, expires_at')
    .eq('user_id', userId)
    .gt('credits_remaining', 0)
    .lt('expires_at', sevenDaysFromNow.toISOString())
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(1);
    
  if (!data || data.length === 0) {
    return null;
  }
  
  const expiringPurchase = data[0];
  const expiresAt = new Date(expiringPurchase.expires_at);
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  
  return {
    expiringSoon: expiringPurchase.credits_remaining,
    expiresIn: daysUntilExpiry,
  };
}