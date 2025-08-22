# Supabase Database Setup Guide for RecopyFast

## Prerequisites
- Supabase project created (Project ref: `uexwowziiigweobgpmtk`)
- Access to Supabase Dashboard
- SQL file: `COMPLETE_DATABASE_SETUP_CLEAN.sql`

## Step 1: Access Supabase SQL Editor

1. Log in to Supabase Dashboard at https://supabase.com/dashboard
2. Select your project
3. Navigate to **SQL Editor** in the left sidebar

## Step 2: Execute Database Schema

### Option A: Using SQL Editor (Recommended)
1. Click **"New query"**
2. Copy the contents of `COMPLETE_DATABASE_SETUP_CLEAN.sql`
3. Paste into the SQL editor
4. Click **"Run"** or press `Cmd/Ctrl + Enter`
5. Verify all statements execute successfully

### Option B: Using Terminal
```bash
# Using the provided script
node setup-db.js

# Or manually with psql
psql "postgresql://postgres:YOUR_DB_PASSWORD@db.uexwowziiigweobgpmtk.supabase.co:5432/postgres" -f COMPLETE_DATABASE_SETUP_CLEAN.sql
```

## Step 3: Verify Tables Created

Run this query to verify all tables exist:
```sql
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected tables:
- `analytics_events`
- `api_keys`
- `billing_subscriptions`
- `billing_usage`
- `content`
- `content_versions`
- `domains`
- `edit_sessions`
- `invitations`
- `notifications`
- `security_events`
- `sites`
- `team_members`
- `teams`
- `user_profiles`
- `webhooks`

## Step 4: Verify Row Level Security (RLS)

Check RLS is enabled on all tables:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename NOT LIKE '%_migrations'
ORDER BY tablename;
```

All tables should show `rowsecurity = true`.

## Step 5: Set Up Real-time Subscriptions

1. Go to **Database** → **Replication**
2. Enable replication for these tables:
   - `content` - For live content updates
   - `notifications` - For real-time notifications
   - `team_members` - For collaboration features

## Step 6: Create Initial Data

### Create Default Team for New Users
```sql
-- This is handled automatically by the user_profiles trigger
-- When a user signs up, they get a default personal team
```

### Add Credit Packages (for billing)
```sql
INSERT INTO public.billing_packages (name, credits, price_cents, stripe_price_id)
VALUES 
  ('Starter Pack', 1000, 1900, 'price_xxxxx_credits_1000'),
  ('Pro Pack', 5000, 7900, 'price_xxxxx_credits_5000'),
  ('Enterprise Pack', 20000, 29900, 'price_xxxxx_credits_20000');
```

## Step 7: Configure Storage Buckets

1. Go to **Storage** in Supabase Dashboard
2. Create buckets:
   - `avatars` - For user profile pictures
   - `content-assets` - For embedded images in content
   - `exports` - For bulk export files

3. Set policies:
```sql
-- Allow users to upload their own avatars
CREATE POLICY "Users can upload own avatar" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow public read access to avatars
CREATE POLICY "Public avatar access" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'avatars');
```

## Step 8: Set Up Edge Functions (Optional)

For advanced features, create edge functions:

1. **Content Processing Function**
```typescript
// supabase/functions/process-content/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  // Process content for AI analysis
  const { content, siteId } = await req.json()
  
  // Add your processing logic
  return new Response(JSON.stringify({ processed: true }))
})
```

2. Deploy: `supabase functions deploy process-content`

## Step 9: Configure Database Webhooks

Set up database webhooks for external integrations:

1. Go to **Database** → **Webhooks**
2. Create webhook for subscription changes:
   - Name: `Subscription Updates`
   - Table: `billing_subscriptions`
   - Events: `INSERT`, `UPDATE`
   - URL: `https://recopyfa.st/api/webhooks/subscription-change`

## Step 10: Performance Optimization

### Create Additional Indexes
```sql
-- Optimize content queries
CREATE INDEX idx_content_site_updated 
ON content(site_id, updated_at DESC);

-- Optimize analytics queries
CREATE INDEX idx_analytics_site_created 
ON analytics_events(site_id, created_at DESC);

-- Optimize team member lookups
CREATE INDEX idx_team_members_user_team 
ON team_members(user_id, team_id);
```

### Enable Query Performance Insights
1. Go to **Settings** → **Database**
2. Enable **Query Performance** monitoring
3. Set slow query threshold to 1000ms

## Step 11: Backup Configuration

1. Go to **Settings** → **Database**
2. Verify daily backups are enabled
3. Note: Supabase keeps 7 days of backups on free tier, 30 days on Pro

## Verification Checklist

Run these checks to ensure setup is complete:

- [ ] All tables created successfully
- [ ] RLS enabled on all tables
- [ ] Indexes created for performance
- [ ] Real-time enabled for required tables
- [ ] Storage buckets configured
- [ ] Initial data inserted
- [ ] Webhooks configured
- [ ] Backups enabled

## Troubleshooting

### Common Issues

1. **RLS Policy Errors**
   - Ensure user is authenticated
   - Check JWT contains required claims
   - Verify policy conditions

2. **Performance Issues**
   - Check index usage with `EXPLAIN ANALYZE`
   - Monitor slow query log
   - Consider connection pooling

3. **Real-time Not Working**
   - Verify replication is enabled
   - Check WebSocket connection
   - Ensure RLS policies allow SELECT

## Next Steps

1. Test all CRUD operations
2. Verify RLS policies work correctly
3. Monitor performance metrics
4. Set up alerts for errors
5. Document any custom functions or triggers