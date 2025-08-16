const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration');
  console.error('   Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('🔗 Database URL:', supabaseUrl);

async function testConnection() {
  console.log('🔍 Testing Supabase connection...');
  try {
    // Test basic connection with a simple query
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .limit(1);
    
    if (error && error.code !== 'PGRST116') {
      console.log('❌ Connection failed:', error.message);
      return false;
    }
    
    console.log('✅ Successfully connected to Supabase database');
    return true;
  } catch (err) {
    console.log('❌ Connection error:', err.message);
    return false;
  }
}

async function checkExistingTables() {
  console.log('📋 Checking existing database tables...');
  
  const criticalTables = [
    'sites', 'content_elements', 'content_history', 'site_permissions',
    'domain_verifications', 'rate_limits', 'api_keys', 'security_events',
    'customers', 'subscriptions', 'payment_methods', 'invoices', 'tickets',
    'teams', 'team_members', 'team_invitations', 
    'site_analytics', 'user_activity_logs', 'bulk_operations'
  ];

  const existingTables = [];
  const missingTables = [];

  for (const tableName of criticalTables) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('count', { count: 'exact', head: true });
      
      if (error) {
        missingTables.push(tableName);
      } else {
        existingTables.push(tableName);
      }
    } catch (err) {
      missingTables.push(tableName);
    }
  }

  console.log(`✅ Found ${existingTables.length} existing tables:`);
  existingTables.forEach(table => console.log(`   • ${table}`));

  if (missingTables.length > 0) {
    console.log(`❌ Missing ${missingTables.length} tables:`);
    missingTables.forEach(table => console.log(`   • ${table}`));
  }

  return { existingTables, missingTables };
}

async function testDatabaseFeatures() {
  console.log('🔧 Testing database features...');
  
  const tests = [
    {
      name: 'Row Level Security (RLS)',
      test: async () => {
        // Check if RLS is enabled on sites table
        try {
          const { data, error } = await supabase
            .from('sites')
            .select('id')
            .limit(1);
          
          // If we get data without authentication, RLS might not be properly configured
          return error ? 'Not configured' : 'Needs verification';
        } catch (err) {
          return 'Not configured';
        }
      }
    },
    {
      name: 'UUID Extensions',
      test: async () => {
        // This would require a custom function or direct SQL access
        return 'Requires manual verification';
      }
    },
    {
      name: 'Triggers and Functions',
      test: async () => {
        return 'Requires manual verification';
      }
    }
  ];

  for (const test of tests) {
    try {
      const result = await test.test();
      console.log(`   ${test.name}: ${result}`);
    } catch (err) {
      console.log(`   ${test.name}: Error - ${err.message}`);
    }
  }
}

function generateManualSetupInstructions() {
  console.log('\n📋 MANUAL DATABASE SETUP REQUIRED');
  console.log('=' .repeat(50));
  
  console.log('\n🔗 1. Open Supabase SQL Editor:');
  console.log(`   ${supabaseUrl.replace('/rest/v1', '')}/sql`);
  
  console.log('\n📁 2. Execute Schema Files in Order:');
  const schemaFiles = [
    'supabase/schema.sql',
    'supabase/security-schema.sql', 
    'supabase/billing-schema.sql',
    'supabase/collaboration-schema.sql',
    'supabase/analytics-schema.sql'
  ];
  
  schemaFiles.forEach((file, index) => {
    console.log(`   ${index + 1}. Copy contents of ${file}`);
    console.log(`      Paste and run in SQL editor`);
  });

  console.log('\n⚠️  3. Important Notes:');
  console.log('   • Execute files in the exact order listed above');
  console.log('   • Wait for each file to complete before running the next');
  console.log('   • Some "already exists" errors are normal');
  console.log('   • Ensure UUID extension is enabled first');
  
  console.log('\n✅ 4. Verification Steps:');
  console.log('   • Check that all tables were created');
  console.log('   • Verify RLS policies are active');
  console.log('   • Test that triggers and functions work');
  console.log('   • Run this script again to verify setup');

  console.log('\n🔐 5. Row Level Security:');
  console.log('   • All tables should have RLS enabled');
  console.log('   • Policies should restrict access appropriately');
  console.log('   • Test with a non-admin user to verify policies');
}

function printSchemaFileContents() {
  console.log('\n📄 SCHEMA FILE CONTENTS');
  console.log('=' .repeat(50));
  
  const schemaFiles = [
    'supabase/schema.sql',
    'supabase/security-schema.sql', 
    'supabase/billing-schema.sql',
    'supabase/collaboration-schema.sql',
    'supabase/analytics-schema.sql'
  ];

  schemaFiles.forEach((filePath, index) => {
    const fullPath = path.join(__dirname, filePath);
    
    if (fs.existsSync(fullPath)) {
      console.log(`\n📋 ${index + 1}. FILE: ${filePath}`);
      console.log('-'.repeat(40));
      
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Print first few lines to show it's available
        const lines = content.split('\n').slice(0, 5);
        lines.forEach(line => console.log(`   ${line}`));
        console.log(`   ... (${content.split('\n').length} total lines)`);
        console.log(`   ✅ Ready to copy from ${filePath}`);
      } catch (err) {
        console.log(`   ❌ Error reading file: ${err.message}`);
      }
    } else {
      console.log(`   ❌ File not found: ${filePath}`);
    }
  });
}

async function main() {
  console.log('🚀 ReCopyFast Database Setup Tool');
  console.log('=' .repeat(40));
  
  // Test connection
  const connected = await testConnection();
  if (!connected) {
    console.log('\n❌ Cannot proceed without database connection');
    console.log('   Check your Supabase credentials and network connection');
    return;
  }

  // Check existing tables
  const { existingTables, missingTables } = await checkExistingTables();
  
  if (missingTables.length === 0) {
    console.log('\n🎉 All critical tables exist!');
    
    // Test database features
    await testDatabaseFeatures();
    
    console.log('\n✅ Database appears to be properly configured');
    console.log('   You can now use the ReCopyFast application');
    
  } else {
    console.log(`\n⚠️  Database setup incomplete (${missingTables.length} tables missing)`);
    
    // Generate setup instructions
    generateManualSetupInstructions();
    printSchemaFileContents();
    
    console.log('\n🔄 Run this script again after completing the manual setup');
  }

  console.log('\n🏁 Setup check complete');
}

main().catch((error) => {
  console.error('❌ Setup failed:', error.message);
  console.error('   Please check your configuration and try again');
});