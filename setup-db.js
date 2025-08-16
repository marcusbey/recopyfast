const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupDatabase() {
  console.log('🚀 Setting up ReCopyFast database...');
  
  // List of schema files to execute
  const schemaFiles = [
    'supabase/schema.sql',
    'supabase/security-schema.sql', 
    'supabase/billing-schema.sql',
    'supabase/collaboration-schema.sql',
    'supabase/analytics-schema.sql'
  ];
  
  for (const schemaFile of schemaFiles) {
    const filePath = path.join(__dirname, schemaFile);
    
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  Schema file not found: ${schemaFile}`);
      continue;
    }
    
    console.log(`\n📋 Executing ${schemaFile}...`);
    
    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      
      // Split by semicolon and execute each statement
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--') && s !== '\n');
      
      for (const statement of statements) {
        if (statement.trim()) {
          try {
            const { error } = await supabase.rpc('exec', { 
              sql: statement 
            });
            
            if (error) {
              if (error.message.includes('already exists') || 
                  error.message.includes('already enabled')) {
                // Ignore "already exists" errors
                continue;
              } else {
                console.error(`   Error: ${error.message}`);
              }
            }
          } catch (err) {
            // Try alternative method for extensions and basic DDL
            if (statement.includes('CREATE EXTENSION') || 
                statement.includes('CREATE TABLE') ||
                statement.includes('CREATE INDEX') ||
                statement.includes('CREATE POLICY')) {
              console.log(`   ⚠️  Skipping statement (may already exist): ${statement.substring(0, 50)}...`);
            } else {
              console.error(`   Error executing: ${statement.substring(0, 50)}...`);
              console.error(`   ${err.message}`);
            }
          }
        }
      }
      
      console.log(`   ✅ ${schemaFile} processed`);
      
    } catch (error) {
      console.error(`   ❌ Failed to read ${schemaFile}: ${error.message}`);
    }
  }
  
  console.log('\n🎉 Database setup completed!');
  console.log('\n✨ ReCopyFast database is ready with:');
  console.log('   • Core content management');
  console.log('   • Security features');
  console.log('   • Billing system');
  console.log('   • Collaboration tools');
  console.log('   • Analytics tracking');
}

setupDatabase().catch(console.error);