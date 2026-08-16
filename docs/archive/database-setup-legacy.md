# ReCopyFast Database Setup Instructions

## ✅ Connection Verified
Your Supabase database connection is working! Now you need to execute the schema files to create all required tables.

## 🔗 Access Your Database
1. Open the Supabase SQL Editor: https://supabase.com/dashboard/project/uexwowziiigweobgpmtk/sql
2. You'll need to log in to your Supabase account

## 📋 Schema Files to Execute (IN ORDER)

Execute these files **in the exact order listed below**. Wait for each file to complete before running the next one.

### 1. Core Schema (supabase/schema.sql)
This creates the fundamental tables for content management:
- `sites` - Website registrations
- `content_elements` - Editable content elements
- `content_history` - Version history
- `site_permissions` - User access control
- `blog_posts` - Blog content

### 2. Security Schema (supabase/security-schema.sql)  
This adds security features:
- `domain_verifications` - Domain ownership verification
- `rate_limits` - API rate limiting
- `api_keys` - API key management
- `security_events` - Security event logging

### 3. Billing Schema (supabase/billing-schema.sql)
This adds subscription and payment features:
- `customers` - Stripe customer records
- `subscriptions` - Subscription management
- `payment_methods` - Payment method storage
- `invoices` - Invoice tracking
- `tickets` - Pay-per-use credits

### 4. Collaboration Schema (supabase/collaboration-schema.sql)
This adds team collaboration features:
- `teams` - Team management
- `team_members` - Team membership
- `team_invitations` - Team invitations
- `content_editing_sessions` - Real-time collaboration
- `collaboration_notifications` - Team notifications

### 5. Analytics Schema (supabase/analytics-schema.sql)
This adds analytics and advanced features:
- `site_analytics` - Usage analytics
- `user_activity_logs` - Activity tracking
- `ab_tests` - A/B testing
- `bulk_operations` - Bulk data operations
- `audit_logs` - Compliance auditing

## 🚀 Step-by-Step Execution

### Step 1: Open SQL Editor
1. Go to https://supabase.com/dashboard/project/uexwowziiigweobgpmtk/sql
2. Click "New query" or use the existing editor

### Step 2: Execute Schema Files
For each schema file:

1. **Copy the entire contents** of `supabase/schema.sql`
2. **Paste into the SQL editor**
3. **Click "Run"** and wait for completion
4. **Verify success** - you should see tables created
5. **Repeat for the next file**

### Step 3: Verify Setup
After executing all 5 schema files, run this verification query:
```sql
-- Check that all critical tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

You should see these critical tables:
- `api_keys`
- `audit_logs` 
- `billing_customers` → `customers`
- `billing_subscriptions` → `subscriptions`
- `blog_posts`
- `bulk_operations`
- `content_elements`
- `content_history`
- `customers`
- `invoices`
- `payment_methods`
- `rate_limits`
- `security_events`
- `site_analytics`
- `site_permissions`
- `sites`
- `subscriptions`
- `team_members`
- `teams`
- `tickets`
- `user_activity_logs`

## 🔐 Row Level Security (RLS)
All tables should automatically have RLS enabled with appropriate policies. This ensures:
- Users can only see their own data
- Team members can access team resources
- Proper access control for all operations

## ⚠️ Common Issues

### "Extension already exists" errors
These are normal and can be ignored. The UUID extension may already be enabled.

### "Table already exists" errors  
If you're re-running scripts, these errors are normal.

### Permission errors
Make sure you're using the service role key, not the anon key.

### Foreign key constraint errors
Execute files in the exact order specified - later files depend on earlier tables.

## ✅ Verification Commands

After setup, run these queries to verify everything works:

```sql
-- Test core functionality
SELECT COUNT(*) as site_count FROM sites;
SELECT COUNT(*) as content_count FROM content_elements;

-- Verify RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Check functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
ORDER BY routine_name;
```

## 🎉 Success Criteria
Your database is properly set up when:
- ✅ All schema files executed without critical errors
- ✅ All essential tables are created
- ✅ RLS policies are enabled on all tables  
- ✅ Triggers and functions are created
- ✅ The verification script shows "All critical tables exist!"

## 🆘 Need Help?
If you encounter issues:
1. Check the Supabase logs for detailed error messages
2. Ensure you're executing files in the correct order
3. Verify your service role key has proper permissions
4. Re-run the verification script: `node db-setup-comprehensive.js`

## 🔄 After Setup
Once the database is set up:
1. Run `npm run dev` to start the development server
2. Test the application functionality
3. Verify user registration and content editing work
4. Check that team features function properly

Your ReCopyFast database will be fully configured and ready for use!