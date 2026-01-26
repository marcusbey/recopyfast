import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia",
  typescript: true,
});

export const STRIPE_CONFIG = {
  PUBLISHABLE_KEY:
    process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE!
      : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
  SECRET_KEY:
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_SECRET_KEY_LIVE!
      : process.env.STRIPE_SECRET_KEY!,
  WEBHOOK_SECRET:
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_WEBHOOK_SECRET_LIVE!
      : process.env.STRIPE_WEBHOOK_SECRET!,
  CURRENCY: "usd",
  API_VERSION: "2024-12-18.acacia" as const,
} as const;

// Subscription plans configuration
export const SUBSCRIPTION_PLANS = {
  // Hidden fallback for users with no active subscription
  FREE: {
    id: "free",
    name: "Free",
    description: "No active subscription",
    price: 0,
    yearlyPrice: 0,
    priceId: null,
    yearlyPriceId: null,
    features: [] as readonly string[],
    limits: {
      websites: 0,
      collaborators: 0,
      aiFeatures: false,
      translations: 0,
    },
  },
  STARTER: {
    id: "starter",
    name: "Starter",
    description: "1 website, instant copy testing, basic features",
    price: 9,
    yearlyPrice: 7.47,
    priceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_STARTER_PRICE_ID_LIVE!
        : process.env.STRIPE_STARTER_PRICE_ID!,
    yearlyPriceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_STARTER_YEARLY_PRICE_ID_LIVE!
        : process.env.STRIPE_STARTER_YEARLY_PRICE_ID!,
    features: [
      "1 website",
      "Instant copy testing",
      "Click-to-edit interface",
      "Basic version history",
      "Community support",
    ],
    limits: {
      websites: 1,
      collaborators: 0,
      aiFeatures: false,
      translations: 0,
    },
  },
  PRO: {
    id: "pro",
    name: "Pro",
    description: "Up to 3 websites, all features, +$6 per additional website",
    price: 19,
    yearlyPrice: 15.77,
    priceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_PRO_PRICE_ID_LIVE!
        : process.env.STRIPE_PRO_PRICE_ID!,
    yearlyPriceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_PRO_YEARLY_PRICE_ID_LIVE!
        : process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
    features: [
      "Up to 3 websites",
      "+$6 per additional website",
      "Instant copy testing",
      "Click-to-edit interface",
      "Full version history",
      "Priority support",
    ],
    limits: {
      websites: 3,
      collaborators: 5,
      aiFeatures: true,
      translations: -1, // unlimited
    },
  },
  ENTERPRISE: {
    id: "enterprise",
    name: "Enterprise",
    description: "Unlimited websites, team collaboration, multiple users",
    price: 39,
    yearlyPrice: 32.37,
    priceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_ENTERPRISE_PRICE_ID_LIVE!
        : process.env.STRIPE_ENTERPRISE_PRICE_ID!,
    yearlyPriceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID_LIVE!
        : process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID!,
    features: [
      "Unlimited websites",
      "Team collaboration",
      "Multiple users",
      "Full version history",
      "Dedicated support",
      "Custom integrations",
    ],
    limits: {
      websites: -1, // unlimited
      collaborators: -1, // unlimited
      aiFeatures: true,
      translations: -1, // unlimited
    },
  },
} as const;

// Ticket system configuration
export const TICKET_CONFIG = {
  PRICE_PER_TICKET: 0.5, // $0.50 per ticket
  TICKETS_PER_PURCHASE: 10, // $5 for 10 tickets
  PRICE_ID:
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_TICKETS_PRICE_ID_LIVE!
      : process.env.STRIPE_TICKETS_PRICE_ID!,
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;
export type SubscriptionPlanData =
  (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan];
