const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupCriticalTables() {
  console.log('🚀 Creating critical tables for ReCopyFast...');
  
  // Essential tables with simplified structure
  const criticalTables = [
    {
      name: 'sites',
      sql: `
        CREATE TABLE IF NOT EXISTS sites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          domain TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          api_key TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    },
    {
      name: 'content_elements', 
      sql: `
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
      `
    },
    {
      name: 'site_permissions',
      sql: `
        CREATE TABLE IF NOT EXISTS site_permissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
          permission TEXT DEFAULT 'edit' CHECK (permission IN ('view', 'edit', 'admin')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(user_id, site_id)
        );
      `
    },
    {
      name: 'billing_customers',
      sql: `
        CREATE TABLE IF NOT EXISTS billing_customers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
          stripe_customer_id TEXT UNIQUE,
          email TEXT NOT NULL,
          name TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    },
    {
      name: 'billing_subscriptions',
      sql: `
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
      `
    },
    {
      name: 'teams',
      sql: `
        CREATE TABLE IF NOT EXISTS teams (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    },
    {
      name: 'team_members',
      sql: `
        CREATE TABLE IF NOT EXISTS team_members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
          user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager', 'owner')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(team_id, user_id)
        );
      `
    }
  ];

  for (const table of criticalTables) {
    try {
      console.log(`Creating table: ${table.name}...`);
      
      // Use raw query through the REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ query: table.sql })
      });

      if (response.ok) {
        console.log(`✅ Table ${table.name} created successfully`);
      } else {
        const error = await response.text();
        if (error.includes('already exists')) {
          console.log(`ℹ️  Table ${table.name} already exists`);
        } else {
          console.error(`❌ Failed to create ${table.name}: ${error}`);
        }
      }
    } catch (error) {
      console.log(`ℹ️  Table ${table.name} - ${error.message}`);
    }
  }

  // Test the connection and tables
  console.log('\n🔍 Testing database connection...');
  try {
    const { data, error } = await supabase
      .from('sites')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.log('⚠️  Database tables may need manual creation via Supabase dashboard');
      console.log('   Error:', error.message);
    } else {
      console.log('✅ Database connection successful - tables are ready!');
    }
  } catch (err) {
    console.log('⚠️  Please create tables manually in Supabase dashboard');
  }

  console.log('\n📋 Manual Setup Instructions:');
  console.log('   1. Go to https://supabase.com/dashboard');
  console.log('   2. Open your project SQL editor');
  console.log('   3. Copy and paste each schema file content');
  console.log('   4. Run the queries to create all tables');
  
  console.log('\n🎯 Essential tables needed:');
  criticalTables.forEach(table => {
    console.log(`   • ${table.name}`);
  });
}

setupCriticalTables().catch(console.error);