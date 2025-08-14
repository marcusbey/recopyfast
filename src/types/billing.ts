export interface Customer {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  email: string;
  name?: string;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  customer_id: string;
  stripe_subscription_id: string;
  plan_id: 'free' | 'pro' | 'enterprise';
  status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at?: string;
  trial_start?: string;
  trial_end?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethod {
  id: string;
  customer_id: string;
  stripe_payment_method_id: string;
  type: string;
  brand?: string;
  last4?: string;
  exp_month?: number;
  exp_year?: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  customer_id: string;
  subscription_id?: string;
  stripe_invoice_id: string;
  amount_paid: number;
  amount_due: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  hosted_invoice_url?: string;
  invoice_pdf?: string;
  period_start?: string;
  period_end?: string;
  due_date?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Tickets {
  id: string;
  user_id: string;
  customer_id: string;
  balance: number;
  total_purchased: number;
  total_consumed: number;
  created_at: string;
  updated_at: string;
}

export interface TicketTransaction {
  id: string;
  user_id: string;
  ticket_id: string;
  type: 'purchase' | 'consumption' | 'refund';
  amount: number;
  description?: string;
  stripe_payment_intent_id?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UsageTracking {
  id: string;
  user_id: string;
  feature_type: string;
  count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BillingEvent {
  id: string;
  user_id: string;
  event_type: string;
  stripe_event_id?: string;
  data: Record<string, unknown>;
  processed: boolean;
  created_at: string;
}

// Plan limits and features
export interface PlanLimits {
  websites: number; // -1 for unlimited
  collaborators: number; // -1 for unlimited
  aiFeatures: boolean;
  translations: number; // -1 for unlimited
}

export interface PlanData {
  id: string;
  name: string;
  description: string;
  price: number;
  priceId: string | null;
  features: string[];
  limits: PlanLimits;
}

// Billing dashboard data
export interface BillingDashboardData {
  customer?: Customer;
  subscription?: Subscription;
  paymentMethods: PaymentMethod[];
  invoices: Invoice[];
  tickets?: Tickets;
  recentTransactions: TicketTransaction[];
  currentUsage: {
    websites: number;
    collaborators: number;
    aiUsage: number;
    translations: number;
  };
}

// Subscription management
export interface SubscriptionUpdateRequest {
  planId: 'pro' | 'enterprise';
  paymentMethodId?: string;
}

export interface TicketPurchaseRequest {
  quantity: number; // number of ticket packs to purchase
  paymentMethodId?: string;
}

// Webhook event types
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: unknown;
  };
  created: number;
}

// Feature usage tracking
export interface FeatureUsage {
  feature: 'ai_suggestion' | 'translation' | 'collaboration' | 'api_call';
  userId: string;
  metadata?: Record<string, unknown>;
}

// Billing alerts
export interface BillingAlert {
  type: 'payment_failed' | 'subscription_canceled' | 'trial_ending' | 'low_tickets';
  message: string;
  severity: 'info' | 'warning' | 'error';
  actionRequired: boolean;
}