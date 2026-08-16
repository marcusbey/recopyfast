# Database Setup Instructions

Since direct connection isn't working, please execute these SQL commands in the Supabase SQL Editor:

## 1. Go to Supabase Dashboard
- Login to https://supabase.com/dashboard
- Select your project (uexwowziiigweobgpmtk)
- Go to SQL Editor

## 2. Execute Main Database Schema
Copy and paste the contents of `COMPLETE_DATABASE_SETUP_CLEAN.sql` into the SQL Editor and run it.

## 3. Execute Credit System Schema
Copy and paste the contents of `supabase/credit-system-schema.sql` into the SQL Editor and run it.

## 4. Verify Setup
Run this query to verify all tables are created:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

Expected tables should include:
- analytics_events
- api_keys
- billing_subscriptions
- content
- credit_purchases (new)
- credit_usage (new)
- sites
- user_profiles
- teams
- etc.

## 5. Test Credit System
Run this to test the credit balance function:

```sql
SELECT * FROM public.get_user_credit_balance('00000000-0000-0000-0000-000000000000');
```

This should return a result with included_credits, purchased_credits, used_credits, and total_available columns.

Once you've executed these SQL commands, let me know and I'll proceed with the production deployment!