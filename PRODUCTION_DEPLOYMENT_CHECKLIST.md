# RecopyFast Production Deployment Checklist

## Pre-Deployment Requirements

### 1. Environment Variables ✅
All required environment variables must be set in production:

```bash
# Supabase (Already set)
NEXT_PUBLIC_SUPABASE_URL=https://uexwowziiigweobgpmtk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# App URL
NEXT_PUBLIC_APP_URL=https://recopyfa.st

# WebSocket Server
NEXT_PUBLIC_WS_URL=wss://recopyfa.st:3001

# OpenAI API
OPENAI_API_KEY=sk-proj-...

# Stripe API (Production keys)
STRIPE_SECRET_KEY=sk_live_51RyZ33RhSIDUA9ar...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_51RyZ33RhSIDUA9ar...
STRIPE_WEBHOOK_SECRET=whsec_hVtLxmdXdqsWhfVWw3SfDjt9dx21VuUB

# Stripe Price IDs (Update after creating products)
STRIPE_PRO_PRICE_ID=price_xxxxx_pro_monthly
STRIPE_ENTERPRISE_PRICE_ID=price_xxxxx_enterprise_monthly
STRIPE_TICKETS_PRICE_ID=price_xxxxx_credits_oneTime

# Redis
REDIS_URL=redis://default:ejCZY3G9M11V37Q72lto1eURBgfseyT2@redis-11062.c326.us-east-1-3.ec2.redns.redis-cloud.com:11062

# Security
ALLOWED_ORIGINS=https://recopyfa.st,https://www.recopyfa.st
CRON_SECRET=fCanCdKf+OMGi2CqDjrwLMzTDfeX7NX3OHfRXl2v6so=

# Monitoring (Optional but recommended)
NEXT_PUBLIC_SENTRY_DSN=

# Production URL
VERCEL_URL=https://recopyfa.st
```

### 2. Stripe Setup ❌
- [ ] Create products in Stripe Dashboard (see STRIPE_PRODUCT_SETUP.md)
- [ ] Update Price IDs in environment variables
- [ ] Configure webhook endpoint: `https://recopyfa.st/api/webhooks/stripe`
- [ ] Save webhook signing secret
- [ ] Test payment flow with test cards

### 3. Database Setup ❌
- [ ] Execute `COMPLETE_DATABASE_SETUP_CLEAN.sql` in Supabase
- [ ] Execute `credit-system-schema.sql` for credit tracking
- [ ] Verify all tables created successfully
- [ ] Check RLS policies are enabled
- [ ] Test database connections
- [ ] Set up database backups

### 4. Domain Configuration ❌
- [ ] Configure DNS for recopyfa.st
- [ ] Set up SSL certificate
- [ ] Configure CORS headers
- [ ] Set up CDN (optional)

### 5. Security Verification ✅
- [ ] All API keys are using production values
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled
- [ ] Domain verification is working
- [ ] Edit sessions require authentication

## Deployment Steps

### 1. Pre-deployment Testing
```bash
# Run all tests
npm test

# Build the project
npm run build

# Type check
npm run type-check

# Lint check
npm run lint
```

### 2. Deploy to Vercel
```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Deploy to production
vercel --prod

# Or use GitHub integration for automatic deploys
```

### 3. Post-deployment Verification

#### A. Application Health
- [ ] Homepage loads correctly
- [ ] Authentication flow works
- [ ] Dashboard is accessible
- [ ] Demo page functions properly

#### B. API Endpoints
- [ ] `/api/health` returns 200
- [ ] `/api/auth/*` endpoints work
- [ ] `/api/ai/*` endpoints require authentication
- [ ] `/api/webhooks/stripe` is accessible

#### C. Feature Testing
- [ ] User registration/login
- [ ] Site registration with script
- [ ] Content editing via embed script
- [ ] AI suggestions (Pro users only)
- [ ] Translation features (Pro users only)
- [ ] Credit consumption tracking
- [ ] Team collaboration
- [ ] Billing/subscription management

#### D. Security Testing
- [ ] Script installation requires domain ownership
- [ ] Edit mode requires authentication
- [ ] API rate limiting is active
- [ ] CORS headers are correct

### 4. Monitoring Setup
- [ ] Configure Sentry for error tracking
- [ ] Set up uptime monitoring
- [ ] Configure alerts for critical errors
- [ ] Monitor database performance
- [ ] Track API usage and limits

### 5. Backup and Recovery
- [ ] Database backups are scheduled
- [ ] Code is backed up in Git
- [ ] Environment variables are securely stored
- [ ] Recovery plan is documented

## Production Readiness Status

### ✅ Completed
- MCP configuration with secure inputs
- Environment variables documented
- Redis connection configured
- AI feature gating implemented
- Credit system implemented
- Security measures in place
- Build process working

### ❌ Required Actions
1. **Create Stripe products** and update Price IDs
2. **Execute database migrations** in Supabase
3. **Configure production domain** and SSL
4. **Set up monitoring** (Sentry)
5. **Deploy to Vercel** and verify

### ⚠️ Recommendations
- Set up staging environment for testing
- Implement automated testing in CI/CD
- Configure database read replicas for scaling
- Set up error alerting
- Document incident response procedures

## Quick Commands

```bash
# Deploy to production
vercel --prod

# Check deployment status
vercel ls

# View production logs
vercel logs

# Set environment variables
vercel env add VARIABLE_NAME

# Rollback if needed
vercel rollback
```

## Support Contacts

- **Stripe Support**: dashboard.stripe.com/support
- **Supabase Support**: supabase.com/dashboard/support
- **Vercel Support**: vercel.com/support
- **Redis Support**: Redis Cloud dashboard

## Final Checklist Before Going Live

- [ ] All environment variables are set
- [ ] Stripe products are created with correct prices
- [ ] Database is fully migrated and tested
- [ ] Domain is configured with SSL
- [ ] Monitoring is active
- [ ] Team has been trained on incident response
- [ ] Backup procedures are in place
- [ ] Legal pages (Terms, Privacy) are published
- [ ] Support email is configured
- [ ] Launch announcement is prepared

## Emergency Procedures

### If Payment Processing Fails
1. Check Stripe webhook logs
2. Verify API keys are correct
3. Check for rate limiting
4. Contact Stripe support if needed

### If Database Issues Occur
1. Check Supabase dashboard for errors
2. Verify connection pooling settings
3. Check for query timeouts
4. Use database backups if needed

### If Site is Down
1. Check Vercel deployment status
2. Verify DNS configuration
3. Check for DDoS attacks
4. Scale resources if needed