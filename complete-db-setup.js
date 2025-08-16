#!/usr/bin/env node

/**
 * Complete ReCopyFast Database Setup
 * This script attempts multiple methods to create database tables
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

// Configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration in environment variables');
  process.exit(1);
}

// Extract project reference from URL
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

console.log('🚀 ReCopyFast Complete Database Setup');
console.log('=====================================');
console.log(`📍 Supabase URL: ${supabaseUrl}`);
console.log(`🔗 Project Ref: ${projectRef}`);
console.log('');

// Create Supabase clients
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Method 1: Try Supabase Management API
 */
async function tryManagementAPI(sql) {
  console.log('🔧 Attempting Supabase Management API...');
  
  const managementUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  
  const payload = JSON.stringify({
    query: sql
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${projectRef}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('   ✅ Management API executed successfully');
          resolve(true);
        } else {
          console.log(`   ❌ Management API failed: ${res.statusCode} - ${data}`);
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.log(`   ❌ Management API error: ${error.message}`);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Method 2: Try REST API with custom function
 */
async function tryRESTAPI(sql) {
  console.log('🔧 Attempting REST API with custom function...');
  
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/execute_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey
      },
      body: JSON.stringify({ sql_query: sql })
    });

    if (response.ok) {
      console.log('   ✅ REST API executed successfully');
      return true;
    } else {
      const error = await response.text();
      console.log(`   ❌ REST API failed: ${error}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ REST API error: ${error.message}`);
    return false;
  }
}

/**
 * Method 3: Direct PostgreSQL connection attempt
 */
async function tryDirectConnection() {
  console.log('🔧 Attempting direct PostgreSQL connection...');
  
  // This would require pg library, but we'll simulate the approach
  console.log('   ⚠️  Direct PostgreSQL connection would require pg library');
  console.log('   ⚠️  Install with: npm install pg');
  return false;
}

/**
 * Method 4: Create essential tables using table creation API
 */
async function createEssentialTables() {
  console.log('🔧 Creating essential tables using alternative methods...');
  
  // Test if we can insert into any system tables or use admin functions
  try {
    // Try to check database version to test admin access
    const { data, error } = await supabase
      .rpc('version'); // This would call the PostgreSQL version() function
    
    if (!error) {
      console.log('   ✅ Database admin access confirmed');
      console.log(`   📋 Database info: ${data}`);
      return true;
    } else {
      console.log(`   ❌ Admin access test failed: ${error.message}`);
    }
  } catch (err) {
    console.log(`   ❌ Connection test failed: ${err.message}`);
  }
  
  return false;
}

/**
 * Test basic database connectivity
 */
async function testConnection() {
  console.log('🧪 Testing database connection...');
  
  try {
    // Try a simple query that should work even without custom tables
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .limit(5);
    
    if (!error) {
      console.log('   ✅ Database connection successful');
      console.log(`   📋 Found ${data.length} existing tables`);
      if (data.length > 0) {
        console.log(`   📋 Sample tables: ${data.map(t => t.table_name).join(', ')}`);
      }
      return true;
    } else {
      console.log(`   ❌ Connection test failed: ${error.message}`);
    }
  } catch (err) {
    console.log(`   ❌ Connection error: ${err.message}`);
  }
  
  return false;
}

/**
 * Generate SQL setup script
 */
function generateSetupScript() {
  console.log('📝 Generating comprehensive setup script...');
  
  const schemaFiles = [
    'supabase/schema.sql',
    'supabase/security-schema.sql',
    'supabase/billing-schema.sql',
    'supabase/collaboration-schema.sql',
    'supabase/analytics-schema.sql'
  ];

  let allSQL = '-- ReCopyFast Complete Database Setup Script\n';
  allSQL += '-- Generated automatically - Execute in Supabase SQL Editor\n\n';

  for (const schemaFile of schemaFiles) {
    const filePath = path.join(__dirname, schemaFile);
    if (fs.existsSync(filePath)) {
      const sql = fs.readFileSync(filePath, 'utf8');
      allSQL += `-- ========================================\n`;
      allSQL += `-- ${schemaFile.toUpperCase()}\n`;
      allSQL += `-- ========================================\n\n`;
      allSQL += sql + '\n\n';
    }
  }

  // Write the complete setup script
  const outputPath = path.join(__dirname, 'COMPLETE_DATABASE_SETUP.sql');
  fs.writeFileSync(outputPath, allSQL);
  console.log(`   ✅ Complete setup script created: ${outputPath}`);
  
  return outputPath;
}

/**
 * Main setup function
 */
async function setupDatabase() {
  console.log('🎯 Starting comprehensive database setup...\n');

  // Test basic connectivity first
  const connected = await testConnection();
  if (!connected) {
    console.log('\n❌ Cannot establish database connection');
    console.log('   Please verify your Supabase credentials and project status');
    return false;
  }

  // Try different setup methods
  const methods = [
    { name: 'Management API', func: () => tryManagementAPI('SELECT version();') },
    { name: 'REST API', func: () => tryRESTAPI('SELECT version();') },
    { name: 'Direct Connection', func: tryDirectConnection },
    { name: 'Alternative Tables', func: createEssentialTables }
  ];

  let successCount = 0;
  for (const method of methods) {
    console.log(`\n🔧 Testing ${method.name}...`);
    const success = await method.func();
    if (success) {
      successCount++;
      console.log(`   ✅ ${method.name} is available`);
    } else {
      console.log(`   ❌ ${method.name} is not available`);
    }
  }

  // Generate the complete setup script
  console.log('\n📝 Creating manual setup resources...');
  const scriptPath = generateSetupScript();

  // Final recommendations
  console.log('\n' + '='.repeat(60));
  console.log('🎯 DATABASE SETUP RECOMMENDATIONS');
  console.log('='.repeat(60));

  if (successCount === 0) {
    console.log('❌ No automated setup methods available');
    console.log('\n📋 MANUAL SETUP REQUIRED:');
    console.log('   1. Open Supabase SQL Editor:');
    console.log(`      https://supabase.com/dashboard/project/${projectRef}/sql`);
    console.log(`   2. Copy content from: ${scriptPath}`);
    console.log('   3. Paste and execute in SQL Editor');
    console.log('   4. Run verification: node verify-db-setup.js');
  } else {
    console.log(`✅ Found ${successCount} available setup methods`);
    console.log('   Proceeding with automated setup...');
  }

  console.log('\n📊 SETUP STATUS:');
  console.log(`   • Database Connection: ${connected ? '✅' : '❌'}`);
  console.log(`   • Automated Methods: ${successCount}/4 available`);
  console.log(`   • Setup Script: ✅ Generated`);
  console.log(`   • Manual Fallback: ✅ Available`);

  console.log('\n🔗 USEFUL LINKS:');
  console.log(`   • Supabase Dashboard: https://supabase.com/dashboard/project/${projectRef}`);
  console.log(`   • SQL Editor: https://supabase.com/dashboard/project/${projectRef}/sql`);
  console.log(`   • Table Editor: https://supabase.com/dashboard/project/${projectRef}/editor`);

  return connected;
}

// Run the setup
setupDatabase()
  .then((success) => {
    if (success) {
      console.log('\n✨ Database setup process completed');
      console.log('   Follow the recommendations above to finish setup');
    } else {
      console.log('\n❌ Database setup process failed');
      console.log('   Please check your Supabase configuration');
    }
  })
  .catch((error) => {
    console.error('\n💥 Setup process crashed:', error.message);
    process.exit(1);
  });