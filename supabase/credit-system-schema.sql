-- Credit system schema for RecopyFast
-- This adds credit tracking functionality to the existing database

-- Table to track credit purchases
CREATE TABLE IF NOT EXISTS public.credit_purchases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credits_purchased INTEGER NOT NULL,
    credits_remaining INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    stripe_payment_intent_id VARCHAR(255) UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT credits_positive CHECK (credits_purchased > 0 AND credits_remaining >= 0)
);

-- Table to track credit usage
CREATE TABLE IF NOT EXISTS public.credit_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credits_used INTEGER NOT NULL,
    operation VARCHAR(50) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT usage_positive CHECK (credits_used > 0)
);

-- Update billing_subscriptions to include credit information
ALTER TABLE public.billing_subscriptions 
ADD COLUMN IF NOT EXISTS monthly_credits INTEGER DEFAULT 0;

-- Update the subscription plans with included credits
UPDATE public.billing_subscriptions 
SET monthly_credits = CASE 
    WHEN plan_id = 'pro' THEN 500
    WHEN plan_id = 'enterprise' THEN 2000
    ELSE 0
END;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_expires 
ON public.credit_purchases(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_usage_user_created 
ON public.credit_usage(user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for credit_purchases
CREATE POLICY "Users can view own credit purchases" 
ON public.credit_purchases 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage credit purchases" 
ON public.credit_purchases 
FOR ALL 
TO service_role 
USING (true);

-- RLS Policies for credit_usage
CREATE POLICY "Users can view own credit usage" 
ON public.credit_usage 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage credit usage" 
ON public.credit_usage 
FOR ALL 
TO service_role 
USING (true);

-- Function to get user's current credit balance
CREATE OR REPLACE FUNCTION public.get_user_credit_balance(p_user_id UUID)
RETURNS TABLE (
    included_credits INTEGER,
    purchased_credits INTEGER,
    used_credits INTEGER,
    total_available INTEGER
) AS $$
DECLARE
    v_plan_credits INTEGER;
    v_period_start TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get plan credits and billing period
    SELECT 
        COALESCE(bs.monthly_credits, 0),
        COALESCE(bs.current_period_start, now())
    INTO v_plan_credits, v_period_start
    FROM public.billing_subscriptions bs
    WHERE bs.user_id = p_user_id
    AND bs.status = 'active'
    LIMIT 1;
    
    -- If no subscription, default to free plan (0 credits)
    IF NOT FOUND THEN
        v_plan_credits := 0;
        v_period_start := date_trunc('month', now());
    END IF;
    
    RETURN QUERY
    SELECT 
        v_plan_credits as included_credits,
        COALESCE(SUM(cp.credits_remaining), 0)::INTEGER as purchased_credits,
        COALESCE(SUM(cu.credits_used), 0)::INTEGER as used_credits,
        GREATEST(0, v_plan_credits - COALESCE(SUM(cu.credits_used), 0))::INTEGER + 
        COALESCE(SUM(cp.credits_remaining), 0)::INTEGER as total_available
    FROM 
        (SELECT 0 as dummy) d
    LEFT JOIN public.credit_purchases cp 
        ON cp.user_id = p_user_id 
        AND cp.expires_at > now()
        AND cp.credits_remaining > 0
    LEFT JOIN public.credit_usage cu
        ON cu.user_id = p_user_id
        AND cu.created_at >= v_period_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to consume credits
CREATE OR REPLACE FUNCTION public.consume_credits(
    p_user_id UUID,
    p_credits INTEGER,
    p_operation VARCHAR(50),
    p_metadata JSONB DEFAULT '{}'
) RETURNS BOOLEAN AS $$
DECLARE
    v_balance RECORD;
    v_monthly_remaining INTEGER;
    v_to_deduct_purchased INTEGER;
BEGIN
    -- Get current balance
    SELECT * INTO v_balance FROM public.get_user_credit_balance(p_user_id);
    
    -- Check if enough credits
    IF v_balance.total_available < p_credits THEN
        RETURN FALSE;
    END IF;
    
    -- Record usage
    INSERT INTO public.credit_usage (user_id, credits_used, operation, metadata)
    VALUES (p_user_id, p_credits, p_operation, p_metadata);
    
    -- Calculate how many to deduct from purchased credits
    v_monthly_remaining := GREATEST(0, v_balance.included_credits - v_balance.used_credits - p_credits);
    v_to_deduct_purchased := p_credits - (v_balance.included_credits - v_balance.used_credits);
    
    -- Deduct from purchased credits if needed
    IF v_to_deduct_purchased > 0 THEN
        WITH deductions AS (
            SELECT 
                id,
                credits_remaining,
                SUM(credits_remaining) OVER (ORDER BY created_at) - v_to_deduct_purchased as remaining_after
            FROM public.credit_purchases
            WHERE user_id = p_user_id
            AND credits_remaining > 0
            AND expires_at > now()
            ORDER BY created_at
        )
        UPDATE public.credit_purchases cp
        SET credits_remaining = GREATEST(0, d.remaining_after)
        FROM deductions d
        WHERE cp.id = d.id
        AND d.remaining_after < d.credits_remaining;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_user_credit_balance TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credits TO service_role;