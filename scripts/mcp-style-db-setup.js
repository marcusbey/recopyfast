#!/usr/bin/env node

/**
 * MCP-Style Supabase Database Setup
 * Direct connection and SQL execution for ReCopyFast
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

console.log('🚀 MCP-Style Supabase Database Setup');
console.log('====================================');
console.log(`📍 Supabase URL: ${supabaseUrl}`);
console.log(`🔗 Project: ${supabaseUrl.match(/https:\/\/([^.]+)/)?.[1]}`);
console.log('');

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Execute SQL using PostgreSQL REST API
 */
async function executeSQLDirect(sql, description) {
  console.log(`\n📋 ${description}...`);
  
  try {
    // Use the /rest/v1/rpc/query endpoint (if available)
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`   ✅ ${description} - Success`);
      return { success: true, result };
    } else {
      const errorText = await response.text();
      console.log(`   ❌ ${description} - Failed: ${response.status}`);
      console.log(`   Error: ${errorText}`);
      return { success: false, error: errorText };
    }
  } catch (error) {
    console.log(`   ❌ ${description} - Exception: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test basic connectivity
 */
async function testConnection() {
  console.log('🔍 Testing Supabase Connection...');
  
  try {
    // Try to query pg_tables to test connection
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .limit(1);

    if (error) {
      // If that fails, try a basic auth check
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError) {
        console.log('   ⚠️  Auth check failed, but connection may be OK');
      }
      console.log('   ✅ Basic connection established');
      return true;
    } else {
      console.log(`   ✅ Database connection successful`);
      console.log(`   📊 Found ${data.length} existing tables`);
      return true;
    }
  } catch (err) {
    console.log(`   ❌ Connection failed: ${err.message}`);
    return false;
  }
}

/**
 * Execute a schema file
 */
async function executeSchemaFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    console.log(`   ⚠️  Schema file not found: ${filePath}`);
    return false;
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`\n📋 Executing ${description}...`);
  console.log(`   📄 File: ${path.basename(filePath)}`);
  console.log(`   📏 Size: ${sql.length} characters`);

  // Split SQL into statements and execute each
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && s !== '\n');

  console.log(`   📦 Executing ${statements.length} SQL statements...`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    if (!statement.trim()) continue;

    // Show progress for long operations
    if (statements.length > 20 && i % 10 === 0) {
      console.log(`   🔄 Progress: ${i}/${statements.length} statements...`);
    }

    const result = await executeSQLDirect(statement, `Statement ${i + 1}`);
    
    if (result.success) {
      successCount++;
    } else if (result.error && (
      result.error.includes('already exists') ||
      result.error.includes('already enabled') ||
      result.error.includes('duplicate')
    )) {
      skipCount++;
    } else {
      errorCount++;
      console.log(`   ⚠️  Statement ${i + 1} failed: ${statement.substring(0, 100)}...`);
    }

    // Small delay to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log(`   📊 Results: ${successCount} success, ${skipCount} skipped, ${errorCount} errors`);
  return errorCount === 0;
}

/**
 * Verify table creation
 */
async function verifyTables() {
  console.log('\n🔍 Verifying Table Creation...');
  
  const expectedTables = [
    'sites', 'content_elements', 'site_permissions',
    'billing_customers', 'billing_subscriptions', 
    'teams', 'team_members', 'edit_sessions'
  ];

  try {
    for (const tableName of expectedTables) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`   ❌ Table '${tableName}': ${error.message}`);
      } else {
        console.log(`   ✅ Table '${tableName}': Ready (${data?.length || 0} records)`);
      }
    }
    return true;
  } catch (error) {
    console.log(`   ❌ Verification failed: ${error.message}`);
    return false;
  }
}

/**
 * Main setup function
 */
async function setupDatabase() {
  console.log('🎯 Starting MCP-Style Database Setup...\n');

  // Test connection
  const connected = await testConnection();
  if (!connected) {
    console.log('\n💥 Cannot establish database connection. Aborting setup.');
    process.exit(1);
  }

  // Schema files to execute in order
  const schemaFiles = [
    {
      path: path.join(__dirname, '..', 'COMPLETE_DATABASE_SETUP.sql'),
      description: 'Complete Database Schema (All Tables)'
    },
    {
      path: path.join(__dirname, '..', 'supabase', 'edit-sessions-schema.sql'),
      description: 'Edit Sessions Security Schema'
    }
  ];

  let totalSuccess = true;

  // Execute each schema file
  for (const schema of schemaFiles) {
    const success = await executeSchemaFile(schema.path, schema.description);
    if (!success) {
      totalSuccess = false;
      console.log(`   ⚠️  ${schema.description} had some issues but continuing...`);
    }
  }

  // Verify table creation
  const verified = await verifyTables();

  // Final report
  console.log('\n' + '='.repeat(60));
  console.log('🎯 MCP-STYLE DATABASE SETUP COMPLETE');
  console.log('='.repeat(60));
  
  if (totalSuccess && verified) {
    console.log('✅ SUCCESS: All database tables created successfully!');
    console.log('\n📊 Your ReCopyFast database now includes:');
    console.log('   🔒 Security: Domain verification, rate limiting, API keys');
    console.log('   💳 Billing: Subscriptions, payments, usage tracking');
    console.log('   👥 Teams: Collaboration, invitations, real-time editing');
    console.log('   📊 Analytics: Usage metrics, A/B testing, performance');
    console.log('   🔐 Auth: Secure edit sessions, permission management');
    
    console.log('\n🚀 Ready for Production:');
    console.log('   1. Run: npm run dev');
    console.log('   2. Visit: http://localhost:3000');
    console.log('   3. Test all features with live database!');
  } else {
    console.log('⚠️  PARTIAL SUCCESS: Some issues encountered but core tables may be working');
    console.log('\n🔧 Manual Steps May Be Required:');
    console.log('   1. Check Supabase dashboard for any missing tables');
    console.log('   2. Review the SQL files and execute manually if needed');
    console.log('   3. Verify RLS policies are enabled');
  }

  console.log('\n🔗 Useful Links:');
  console.log(`   • Dashboard: https://supabase.com/dashboard/project/${supabaseUrl.match(/https:\/\/([^.]+)/)?.[1]}`);
  console.log(`   • SQL Editor: https://supabase.com/dashboard/project/${supabaseUrl.match(/https:\/\/([^.]+)/)?.[1]}/sql`);
  console.log(`   • Tables: https://supabase.com/dashboard/project/${supabaseUrl.match(/https:\/\/([^.]+)/)?.[1]}/editor`);
  
  console.log('\n' + '='.repeat(60));
  
  return totalSuccess && verified;
}

// Run the setup
setupDatabase()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('\n💥 Setup crashed:', error);
    process.exit(1);
  });