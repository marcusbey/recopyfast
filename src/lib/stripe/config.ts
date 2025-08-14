import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
});

export const STRIPE_CONFIG = {
  PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
  SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
  WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
  CURRENCY: 'usd',
  API_VERSION: '2024-12-18.acacia' as const,
} as const;

// Subscription plans configuration
export const SUBSCRIPTION_PLANS = {
  FREE: {
    id: 'free',
    name: 'Free',
    description: '1 website, basic editing only, no AI features',
    price: 0,
    priceId: null,
    features: [
      '1 website',
      'Basic content editing',
      'Community support',
    ],
    limits: {
      websites: 1,
      collaborators: 0,
      aiFeatures: false,
      translations: 0,
    },
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    description: 'Unlimited websites, AI features, 5 collaborators',
    price: 29,
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    features: [
      'Unlimited websites',
      'AI-powered suggestions',
      'Translation support',
      '5 collaborators',
      'Priority support',
      'Advanced analytics',
    ],
    limits: {
      websites: -1, // unlimited
      collaborators: 5,
      aiFeatures: true,
      translations: -1, // unlimited
    },
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited everything, white-label, priority support',
    price: 99,
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID!,
    features: [
      'Everything in Pro',
      'Unlimited collaborators',
      'White-label solution',
      'Custom integrations',
      'Dedicated support',
      'SLA guarantee',
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
  PRICE_ID: process.env.STRIPE_TICKETS_PRICE_ID!,
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;
export type SubscriptionPlanData = typeof SUBSCRIPTION_PLANS[SubscriptionPlan];