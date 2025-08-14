-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Customers table for Stripe customer management
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Subscriptions table
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('free', 'pro', 'enterprise')),
  status TEXT NOT NULL CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  canceled_at TIMESTAMP WITH TIME ZONE,
  trial_start TIMESTAMP WITH TIME ZONE,
  trial_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id)
);

-- Payment methods table
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT UNIQUE NOT NULL,
  amount_paid INTEGER NOT NULL, -- in cents
  amount_due INTEGER NOT NULL, -- in cents
  currency TEXT DEFAULT 'usd',
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
  hosted_invoice_url TEXT,
  invoice_pdf TEXT,
  period_start TIMESTAMP WITH TIME ZONE,
  period_end TIMESTAMP WITH TIME ZONE,
  due_date TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Tickets table for pay-per-use features
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0 NOT NULL,
  total_purchased INTEGER DEFAULT 0 NOT NULL,
  total_consumed INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id)
);

-- Ticket transactions table
CREATE TABLE ticket_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'consumption', 'refund')),
  amount INTEGER NOT NULL, -- positive for purchase/refund, negative for consumption
  description TEXT,
  stripe_payment_intent_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Usage tracking table
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL, -- 'ai_suggestion', 'translation', 'collaboration', etc.
  count INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Billing events table for audit trail
CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT,
  data JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create indexes for performance
CREATE INDEX idx_customers_user_id ON customers(user_id);
CREATE INDEX idx_customers_stripe_customer_id ON customers(stripe_customer_id);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_payment_methods_customer_id ON payment_methods(customer_id);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX idx_invoices_subscription_id ON invoices(subscription_id);
CREATE INDEX idx_tickets_user_id ON tickets(user_id);
CREATE INDEX idx_ticket_transactions_user_id ON ticket_transactions(user_id);
CREATE INDEX idx_ticket_transactions_ticket_id ON ticket_transactions(ticket_id);
CREATE INDEX idx_usage_tracking_user_id ON usage_tracking(user_id);
CREATE INDEX idx_usage_tracking_feature_type ON usage_tracking(feature_type);
CREATE INDEX idx_billing_events_user_id ON billing_events(user_id);
CREATE INDEX idx_billing_events_processed ON billing_events(processed);

-- Enable Row Level Security
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for customers
CREATE POLICY "Users can view their own customer data" ON customers
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their own customer data" ON customers
  FOR UPDATE USING (user_id = auth.uid());

-- RLS Policies for subscriptions
CREATE POLICY "Users can view their own subscription" ON subscriptions
  FOR SELECT USING (user_id = auth.uid());

-- RLS Policies for payment methods
CREATE POLICY "Users can view their own payment methods" ON payment_methods
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = payment_methods.customer_id
      AND customers.user_id = auth.uid()
    )
  );

-- RLS Policies for invoices
CREATE POLICY "Users can view their own invoices" ON invoices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = invoices.customer_id
      AND customers.user_id = auth.uid()
    )
  );

-- RLS Policies for tickets
CREATE POLICY "Users can view their own tickets" ON tickets
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their own tickets" ON tickets
  FOR UPDATE USING (user_id = auth.uid());

-- RLS Policies for ticket transactions
CREATE POLICY "Users can view their own ticket transactions" ON ticket_transactions
  FOR SELECT USING (user_id = auth.uid());

-- RLS Policies for usage tracking
CREATE POLICY "Users can view their own usage tracking" ON usage_tracking
  FOR SELECT USING (user_id = auth.uid());

-- RLS Policies for billing events
CREATE POLICY "Users can view their own billing events" ON billing_events
  FOR SELECT USING (user_id = auth.uid());

-- Triggers for updated_at
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_methods_updated_at BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Functions for subscription management
CREATE OR REPLACE FUNCTION get_user_subscription(user_uuid UUID)
RETURNS TABLE (
  plan_id TEXT,
  status TEXT,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.plan_id, s.status, s.current_period_end, s.cancel_at_period_end
  FROM subscriptions s
  WHERE s.user_id = user_uuid
  AND s.status IN ('active', 'trialing', 'past_due')
  ORDER BY s.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user ticket balance
CREATE OR REPLACE FUNCTION get_user_ticket_balance(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  user_balance INTEGER;
BEGIN
  SELECT COALESCE(balance, 0) INTO user_balance
  FROM tickets
  WHERE user_id = user_uuid;
  
  RETURN COALESCE(user_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to consume tickets
CREATE OR REPLACE FUNCTION consume_tickets(user_uuid UUID, ticket_amount INTEGER, description_text TEXT DEFAULT 'AI feature usage')
RETURNS BOOLEAN AS $$
DECLARE
  current_balance INTEGER;
  ticket_record_id UUID;
BEGIN
  -- Get current balance
  SELECT balance, id INTO current_balance, ticket_record_id
  FROM tickets
  WHERE user_id = user_uuid;
  
  -- Check if user has enough tickets
  IF current_balance < ticket_amount THEN
    RETURN FALSE;
  END IF;
  
  -- Update ticket balance
  UPDATE tickets
  SET balance = balance - ticket_amount,
      total_consumed = total_consumed + ticket_amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE user_id = user_uuid;
  
  -- Record transaction
  INSERT INTO ticket_transactions (user_id, ticket_id, type, amount, description)
  VALUES (user_uuid, ticket_record_id, 'consumption', -ticket_amount, description_text);
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to add tickets
CREATE OR REPLACE FUNCTION add_tickets(user_uuid UUID, ticket_amount INTEGER, stripe_payment_intent_id_param TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  ticket_record_id UUID;
BEGIN
  -- Insert or update tickets record
  INSERT INTO tickets (user_id, balance, total_purchased)
  VALUES (user_uuid, ticket_amount, ticket_amount)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = tickets.balance + ticket_amount,
    total_purchased = tickets.total_purchased + ticket_amount,
    updated_at = TIMEZONE('utc', NOW())
  RETURNING id INTO ticket_record_id;
  
  -- Record transaction
  INSERT INTO ticket_transactions (user_id, ticket_id, type, amount, description, stripe_payment_intent_id)
  VALUES (user_uuid, ticket_record_id, 'purchase', ticket_amount, 'Ticket purchase', stripe_payment_intent_id_param);
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;