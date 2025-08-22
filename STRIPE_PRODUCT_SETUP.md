# Stripe Product Setup Guide for RecopyFast

## Overview
This guide walks you through creating the necessary products and pricing in your Stripe Dashboard for RecopyFast's subscription and credit-based billing model.

## Step 1: Access Stripe Dashboard
1. Log in to your Stripe Dashboard at https://dashboard.stripe.com
2. Navigate to **Products** in the left sidebar

## Step 2: Create Products and Pricing

### A. Free Tier (Optional - for tracking)
**Product Details:**
- Name: `RecopyFast Free`
- Description: `Basic content editing for up to 5 websites`

**Features:**
- ✅ Content editing interface
- ✅ Up to 5 websites
- ✅ Basic analytics
- ❌ No AI features
- ❌ No team collaboration

**Pricing:**
- Price: $0/month
- No Stripe product needed (handled in app logic)

### B. Pro Tier
**Product Details:**
- Name: `RecopyFast Pro`
- Description: `Professional plan with AI features and unlimited websites`

**Features:**
- ✅ Everything in Free
- ✅ Unlimited websites
- ✅ AI content suggestions
- ✅ AI translations
- ✅ 500 AI credits/month included
- ✅ Team collaboration (up to 5 members)
- ✅ Priority support

**Pricing Setup:**
1. Click **"Add Product"**
2. Enter:
   - Product name: `RecopyFast Pro`
   - Description: `Professional plan with AI features`
3. Click **"Add pricing"**
4. Set:
   - Pricing model: `Recurring`
   - Price: `$29.00`
   - Billing period: `Monthly`
5. Save the Price ID (format: `price_1234567890abcdef`)
6. Update `.env`: `STRIPE_PRO_PRICE_ID=price_xxxxx`

### C. Enterprise Tier
**Product Details:**
- Name: `RecopyFast Enterprise`
- Description: `Enterprise plan with advanced features and support`

**Features:**
- ✅ Everything in Pro
- ✅ 2000 AI credits/month included
- ✅ Unlimited team members
- ✅ Advanced analytics
- ✅ API access
- ✅ Dedicated support
- ✅ Custom domain support
- ✅ SLA guarantee

**Pricing Setup:**
1. Click **"Add Product"**
2. Enter:
   - Product name: `RecopyFast Enterprise`
   - Description: `Enterprise plan with premium features`
3. Click **"Add pricing"**
4. Set:
   - Pricing model: `Recurring`
   - Price: `$99.00`
   - Billing period: `Monthly`
5. Save the Price ID
6. Update `.env`: `STRIPE_ENTERPRISE_PRICE_ID=price_xxxxx`

### D. AI Credits Pack
**Product Details:**
- Name: `RecopyFast AI Credits`
- Description: `Additional AI credits for content generation`

**Features:**
- 1000 AI credits
- Valid for 90 days
- Can be purchased by any tier
- Credits roll over month-to-month until expiry

**Pricing Setup:**
1. Click **"Add Product"**
2. Enter:
   - Product name: `RecopyFast AI Credits`
   - Description: `1000 AI credits for content generation`
3. Click **"Add pricing"**
4. Set:
   - Pricing model: `One time`
   - Price: `$19.00`
5. Save the Price ID
6. Update `.env`: `STRIPE_TICKETS_PRICE_ID=price_xxxxx`

## Step 3: Configure Webhook Endpoint

1. Go to **Developers** → **Webhooks**
2. Click **"Add endpoint"**
3. Enter:
   - Endpoint URL: `https://recopyfa.st/api/webhooks/stripe`
   - Description: `RecopyFast subscription events`
4. Select events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `checkout.session.completed`
5. Save the webhook signing secret
6. Update `.env`: `STRIPE_WEBHOOK_SECRET_LIVE=whsec_xxxxx`

## Step 4: Create Test Data (Optional)

For development, create test mode versions:
1. Switch to **Test mode** in Stripe Dashboard
2. Repeat steps 2-3 for test products
3. Use test Price IDs in development environment

## Step 5: Verify Setup

Run this checklist:
- [ ] Pro monthly subscription created
- [ ] Enterprise monthly subscription created
- [ ] AI Credits one-time product created
- [ ] All Price IDs saved to `.env`
- [ ] Webhook endpoint configured
- [ ] Webhook secret saved to `.env`

## Credit Usage Rates

Configure these in your application:
- AI Suggestion: 1 credit per use
- AI Translation: 5 credits per use
- Bulk AI operations: 10 credits per batch

## Testing Subscriptions

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires auth: `4000 0025 0000 3155`

## Next Steps

After creating products:
1. Update `.env` with all Price IDs
2. Test subscription flow in development
3. Verify webhook handling
4. Test upgrade/downgrade scenarios
5. Deploy to production