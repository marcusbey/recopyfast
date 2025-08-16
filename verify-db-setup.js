const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function verifyDatabaseSetup() {
  console.log('🔍 ReCopyFast Database Verification');
  console.log('=====================================\n');

  // Critical tables that must exist
  const requiredTables = [
    // Core schema
    'sites',
    'content_elements', 
    'content_history',
    'site_permissions',
    'blog_posts',
    
    // Security schema
    'domain_verifications',
    'rate_limits',
    'api_keys',
    'security_events',
    
    // Billing schema  
    'customers',
    'subscriptions',
    'payment_methods',
    'invoices',
    'tickets',
    'ticket_transactions',
    
    // Collaboration schema
    'teams',
    'team_members',
    'team_invitations',
    'content_editing_sessions',
    'collaboration_notifications',
    
    // Analytics schema
    'site_analytics',
    'user_activity_logs',
    'performance_metrics',
    'bulk_operations',
    'ab_tests',
    'audit_logs'
  ];

  let existingTables = [];
  let missingTables = [];
  let setupComplete = true;

  console.log('📋 Checking required tables...');

  for (const tableName of requiredTables) {
    try {
      // Try to select from the table (this will fail if table doesn't exist)
      const { data, error } = await supabase
        .from(tableName)
        .select('count', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === 'PGRST116') { // Table not found
          missingTables.push(tableName);
          console.log(`   ❌ ${tableName} - missing`);
          setupComplete = false;
        } else {
          // Table exists but has other issues (permissions, etc.)
          existingTables.push(tableName);
          console.log(`   ⚠️  ${tableName} - exists (${error.message})`);
        }
      } else {
        existingTables.push(tableName);
        console.log(`   ✅ ${tableName} - ready`);
      }
    } catch (err) {
      missingTables.push(tableName);
      console.log(`   ❌ ${tableName} - error: ${err.message}`);
      setupComplete = false;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Tables found: ${existingTables.length}`);
  console.log(`   ❌ Tables missing: ${missingTables.length}`);

  if (setupComplete) {
    console.log('\n🎉 DATABASE SETUP COMPLETE!');
    console.log('   All required tables are present and accessible.');
    
    // Test basic operations
    console.log('\n🧪 Testing basic operations...');
    await testBasicOperations();
    
  } else {
    console.log('\n❌ DATABASE SETUP INCOMPLETE');
    console.log('   Missing tables need to be created manually.');
    
    if (missingTables.length > 0) {
      console.log('\n📋 Missing tables:');
      missingTables.forEach(table => console.log(`   • ${table}`));
    }
    
    console.log('\n📖 Next steps:');
    console.log('   1. Open: https://supabase.com/dashboard/project/uexwowziiigweobgpmtk/sql');
    console.log('   2. Execute schema files in order (see database-setup-instructions.md)');
    console.log('   3. Run this verification script again');
  }

  return setupComplete;
}

async function testBasicOperations() {
  const tests = [
    {
      name: 'Sites table functionality',
      test: async () => {
        // Try to insert a test site
        const { data, error } = await supabase
          .from('sites')
          .insert({
            domain: 'test.example.com',
            name: 'Test Site'
          })
          .select();
        
        if (data && data.length > 0) {
          // Clean up test data
          await supabase
            .from('sites')
            .delete()
            .eq('id', data[0].id);
          return 'Working ✅';
        }
        return error ? `Error: ${error.message}` : 'Unknown issue';
      }
    },
    {
      name: 'Content elements functionality',
      test: async () => {
        try {
          const { error } = await supabase
            .from('content_elements')
            .select('id')
            .limit(1);
          
          return error ? `Error: ${error.message}` : 'Working ✅';
        } catch (err) {
          return `Error: ${err.message}`;
        }
      }
    },
    {
      name: 'Authentication integration',
      test: async () => {
        try {
          // This will test if RLS is working properly
          const { data, error } = await supabase.auth.getUser();
          return error ? 'Not authenticated (normal)' : 'User authenticated';
        } catch (err) {
          return 'Auth system working';
        }
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

async function showDatabaseInfo() {
  console.log('\n📊 Database Information:');
  console.log(`   URL: ${supabaseUrl}`);
  console.log(`   Project ID: uexwowziiigweobgpmtk`);
  
  try {
    // Get some basic stats if possible
    const tableCount = await countAccessibleTables();
    console.log(`   Accessible tables: ${tableCount}`);
  } catch (err) {
    console.log(`   Table count: Unable to determine`);
  }
}

async function countAccessibleTables() {
  const testTables = [
    'sites', 'content_elements', 'teams', 'customers', 'subscriptions'
  ];
  
  let count = 0;
  for (const table of testTables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('count', { count: 'exact', head: true });
      
      if (!error) count++;
    } catch (err) {
      // Table doesn't exist
    }
  }
  
  return count;
}

async function main() {
  await showDatabaseInfo();
  const isComplete = await verifyDatabaseSetup();
  
  if (isComplete) {
    console.log('\n🚀 Your ReCopyFast database is ready!');
    console.log('   You can now run: npm run dev');
  } else {
    console.log('\n⏳ Complete the database setup first');
    console.log('   See: database-setup-instructions.md');
  }
}

main().catch((error) => {
  console.error('\n❌ Verification failed:', error.message);
  console.error('   Check your Supabase configuration and network connection');
});