-- Compatibility tables for the ticket-wallet runtime code.
-- The existing billing_tickets table tracks purchase records; these tables
-- track wallet balance and ledger entries used by src/lib/stripe/tickets.ts.

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  customer_id UUID REFERENCES billing_customers(id),
  balance INTEGER NOT NULL DEFAULT 0,
  total_purchased INTEGER NOT NULL DEFAULT 0,
  total_consumed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'consumption', 'refund')),
  amount INTEGER NOT NULL,
  description TEXT,
  stripe_payment_intent_id TEXT UNIQUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transactions_user_id ON ticket_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_feature ON usage_tracking(user_id, feature_type, created_at);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own ticket wallet" ON tickets;
CREATE POLICY "Users can view their own ticket wallet"
  ON tickets FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage ticket wallet" ON tickets;
CREATE POLICY "Service role can manage ticket wallet"
  ON tickets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own ticket transactions" ON ticket_transactions;
CREATE POLICY "Users can view their own ticket transactions"
  ON ticket_transactions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage ticket transactions" ON ticket_transactions;
CREATE POLICY "Service role can manage ticket transactions"
  ON ticket_transactions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own usage tracking" ON usage_tracking;
CREATE POLICY "Users can view their own usage tracking"
  ON usage_tracking FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage usage tracking" ON usage_tracking;
CREATE POLICY "Service role can manage usage tracking"
  ON usage_tracking FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION add_tickets(
  user_uuid UUID,
  ticket_amount INTEGER,
  stripe_payment_intent_id_param TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_ticket_id UUID;
BEGIN
  INSERT INTO tickets (user_id, balance, total_purchased)
  VALUES (user_uuid, ticket_amount, ticket_amount)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = tickets.balance + ticket_amount,
    total_purchased = tickets.total_purchased + ticket_amount,
    updated_at = NOW()
  RETURNING id INTO v_ticket_id;

  INSERT INTO ticket_transactions (
    user_id,
    ticket_id,
    type,
    amount,
    description,
    stripe_payment_intent_id
  )
  VALUES (
    user_uuid,
    v_ticket_id,
    'purchase',
    ticket_amount,
    'Ticket purchase',
    stripe_payment_intent_id_param
  )
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION consume_tickets(
  user_uuid UUID,
  ticket_amount INTEGER,
  description_text TEXT DEFAULT 'Feature usage'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_ticket tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket
  FROM tickets
  WHERE user_id = user_uuid
  FOR UPDATE;

  IF NOT FOUND OR v_ticket.balance < ticket_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE tickets
  SET
    balance = balance - ticket_amount,
    total_consumed = total_consumed + ticket_amount,
    updated_at = NOW()
  WHERE id = v_ticket.id;

  INSERT INTO ticket_transactions (
    user_id,
    ticket_id,
    type,
    amount,
    description
  )
  VALUES (
    user_uuid,
    v_ticket.id,
    'consumption',
    ticket_amount,
    description_text
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_ticket_balance(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance
  FROM tickets
  WHERE user_id = user_uuid;

  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_tickets(UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION consume_tickets(UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_ticket_balance(UUID) TO authenticated, service_role;
