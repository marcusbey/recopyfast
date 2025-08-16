# ReCopyFast Database Setup Instructions

## ⚠️ IMPORTANT: Manual Database Setup Required

The agents have created comprehensive database schemas, but they need to be executed manually through the Supabase dashboard.

## 🎯 Quick Setup (Essential Tables)

### Step 1: Access Supabase Dashboard

1. Go to https://supabase.com/dashboard
2. Select your project: `uexwowziiigweobgpmtk`
3. Navigate to **SQL Editor** in the sidebar

### Step 2: Execute Core Schema

Copy and paste this essential SQL into the SQL Editor and click "Run":

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sites table
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Content elements table
CREATE TABLE IF NOT EXISTS content_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  selector TEXT NOT NULL,
  original_content TEXT,
  current_content TEXT,
  language TEXT DEFAULT 'en',
  variant TEXT DEFAULT 'default',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(site_id, element_id, language, variant)
);

-- Site permissions
CREATE TABLE IF NOT EXISTS site_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  permission TEXT DEFAULT 'edit' CHECK (permission IN ('view', 'edit', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, site_id)
);

-- Billing customers
CREATE TABLE IF NOT EXISTS billing_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Billing subscriptions
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
  status TEXT NOT NULL,
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager', 'owner')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_content_elements_site_id ON content_elements(site_id);
CREATE INDEX IF NOT EXISTS idx_content_elements_element_id ON content_elements(element_id);
CREATE INDEX IF NOT EXISTS idx_site_permissions_user_id ON site_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_site_permissions_site_id ON site_permissions(site_id);
```

## 🔐 Step 3: Enable Row Level Security (RLS)

Execute this SQL to enable security:

```sql
-- Enable RLS
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies
CREATE POLICY "Users can view sites they have permission to" ON sites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = sites.id
      AND site_permissions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view their own billing" ON billing_customers
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can view their own subscriptions" ON billing_subscriptions
  FOR ALL USING (user_id = auth.uid());
```

## 🚀 Complete Setup (All Features)

For the full feature set, also run these schema files in order:

### 1. Security Schema
Execute the content of: `supabase/security-schema.sql`

### 2. Collaboration Schema  
Execute the content of: `supabase/collaboration-schema.sql`

### 3. Analytics Schema
Execute the content of: `supabase/analytics-schema.sql`

## ✅ Verification

After running the SQL, verify the setup:

1. **Check Tables**: In Supabase dashboard, go to **Table Editor**
2. **Verify Tables**: You should see all the tables listed
3. **Test Connection**: Run the development server: `npm run dev`

## 🎯 Essential Tables for Basic Functionality

The minimum tables needed for ReCopyFast to work:

- ✅ `sites` - Website management
- ✅ `content_elements` - Content storage
- ✅ `site_permissions` - User access control
- ✅ `billing_customers` - User billing info
- ✅ `billing_subscriptions` - Subscription management
- ✅ `teams` - Team collaboration
- ✅ `team_members` - Team membership

## 🔧 Alternative: One-Click Schema Import

You can also import the complete schemas by copying the content of these files into the SQL Editor:

1. `supabase/schema.sql` - Core tables
2. `supabase/billing-schema.sql` - Payment system
3. `supabase/collaboration-schema.sql` - Team features
4. `supabase/security-schema.sql` - Security features
5. `supabase/analytics-schema.sql` - Analytics tracking

## 📋 Post-Setup Checklist

After creating the tables:

- [ ] All tables are visible in Table Editor
- [ ] RLS policies are enabled
- [ ] Indexes are created for performance
- [ ] `npm run dev` starts without database errors
- [ ] You can create a site in the dashboard

## 🆘 Need Help?

If you encounter any issues:

1. Check the Supabase dashboard logs
2. Verify your environment variables are set
3. Ensure your Supabase project is active
4. Contact me if tables aren't creating properly

The core functionality will work with just the essential tables above!