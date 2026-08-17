import type {
  PaidPlanId,
  PlanCatalogue,
  PlanLimits,
  SubscriptionPlan,
  SubscriptionPlanId,
} from "@/lib/stripe/plan-types";

// Plan shapes live in @/lib/stripe/plan-types, which is the client-safe half
// of the DB-backed plan loader. Re-exported here so the many callers that
// already import billing types from one place keep working.
export type { PlanLimits, SubscriptionPlan as PlanData };

/**
 * The dashboard shell's view of what an account is entitled to.
 *
 * Served by `GET /api/billing/entitlement`. It mirrors the three states of
 * `Entitlement` in `@/lib/billing/effective-plan` without carrying the plan
 * object, because the shell only needs to know what to render.
 *
 * It lives here rather than beside the route so client components can import
 * the type without pulling that module — and its server-only Supabase client —
 * into the browser bundle.
 *
 * Presentation only. Every decision about what may actually happen resolves
 * entitlement server-side; a client can lie about what it draws, never about
 * what the server allows.
 */
/**
 * A running trial, as far as the UI is concerned.
 *
 * `endsAt` is the stored expiry, computed server-side when the trial was
 * granted; `daysRemaining` is derived from it there too, so a client that lies
 * about its clock changes what it draws and nothing else. Whether the trial
 * still entitles anyone is decided by `resolveEntitlement`, which never reads
 * this.
 */
export interface TrialSummary {
  daysRemaining: number;
  endsAt: string;
}

export interface EntitlementSummary {
  kind: "plan" | "credits" | "none";
  planId: PaidPlanId | null;
  planName: string | null;
  /**
   * Present only while a trial is running AND nothing is being billed yet.
   * Absent — the key is omitted, not null — for every other account, so a
   * client that has never heard of trials sees exactly the payload it did
   * before.
   */
  trial?: TrialSummary;
}

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
  plan_id: SubscriptionPlanId | string;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
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
  status: "draft" | "open" | "paid" | "uncollectible" | "void";
  hosted_invoice_url?: string;
  invoice_pdf?: string;
  period_start?: string;
  period_end?: string;
  due_date?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Credit balance summary.
 *
 * Computed from credit_purchases + credit_usage rather than stored: there is no
 * balance column to drift out of sync with the rows that justify it.
 */
export interface CreditWallet {
  /** Spendable now: remaining included allowance plus purchased credits. */
  balance: number;
  /** Granted by the plan this period. */
  included: number;
  /** Bought and not yet spent. Does not expire. */
  purchased: number;
  usedThisMonth: number;
  totalPurchased: number;
  totalConsumed: number;
}

/** A purchase, a refund or a spend, merged into one timeline for the UI. */
export interface CreditTransaction {
  id: string;
  type: "purchase" | "consumption" | "refund";
  amount: number;
  description?: string;
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

// Billing dashboard data
export interface BillingDashboardData {
  customer?: Customer;
  subscription?: Subscription;
  paymentMethods: PaymentMethod[];
  invoices: Invoice[];
  creditWallet?: CreditWallet;
  recentTransactions: CreditTransaction[];
  currentUsage: {
    websites: number;
    collaborators: number;
    aiUsage: number;
    translations: number;
  };
  /**
   * The plan catalogue, resolved server-side. Client billing components render
   * prices, limits and feature lists from this rather than from a compiled-in
   * copy — see src/lib/stripe/plans.ts.
   */
  catalogue: PlanCatalogue;
  /**
   * Plan in force, counting lifetime entitlements as well as subscriptions.
   * Null when the account has none — there is no free plan to report instead.
   */
  effectivePlanId: string | null;
  /**
   * The running trial and what it has spent of its AI allowance, or null.
   *
   * Null once a subscription is live, even while the grant itself has days left
   * on it: the trial is left to lapse on its own clock rather than being
   * revoked at payment, so "unexpired" and "still trialling" stop meaning the
   * same thing the moment someone converts.
   */
  trial: (TrialSummary & { creditsUsed: number; creditsLimit: number }) | null;
  /**
   * Whether this account has ever had a trial, running or spent.
   *
   * The unentitled branch of the billing page has two readers with the same
   * `effectivePlanId: null` and very different situations — someone who has
   * never subscribed, and someone whose trial just ran out — and only this
   * tells them apart.
   */
  everTrialed: boolean;
}

// Subscription management
export interface SubscriptionUpdateRequest {
  planId: PaidPlanId;
  paymentMethodId?: string;
}

export interface CreditPurchaseRequest {
  quantity: number; // number of credit packs to purchase
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
  feature: "ai_suggestion" | "translation" | "collaboration" | "api_call";
  userId: string;
  metadata?: Record<string, unknown>;
}

// Billing alerts
export interface BillingAlert {
  type:
    | "payment_failed"
    | "subscription_canceled"
    | "trial_ending"
    | "low_credits";
  message: string;
  severity: "info" | "warning" | "error";
  actionRequired: boolean;
}
