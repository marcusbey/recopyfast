#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase configuration
const supabaseUrl = 'https://uexwowziiigweobgpmtk.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVleHdvd3ppaWlnd2VvYmdwbXRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTA1ODU5OSwiZXhwIjoyMDcwNjM0NTk5fQ.ikJLtjIWBMvX7ruF41qxSxHx8x-C5NoT8LJpxrTa2Rs';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupCreditSystem() {
  console.log('🚀 Setting up credit system...');
  
  try {
    // Read the credit system schema SQL
    const sqlContent = fs.readFileSync(
      path.join(process.cwd(), 'supabase', 'credit-system-schema.sql'), 
      'utf8'
    );
    
    console.log('📋 Executing credit system schema...');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: sqlContent
    });
    
    if (error) {
      console.error('❌ Error executing schema:', error);
      
      // Try alternative method - execute statements one by one
      console.log('🔄 Trying alternative execution method...');
      
      const statements = sqlContent
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        console.log(`📝 Executing statement ${i + 1}/${statements.length}`);
        
        try {
          const { error: stmtError } = await supabase.rpc('exec_sql', {
            sql: stmt + ';'
          });
          
          if (stmtError) {
            console.warn(`⚠️  Warning on statement ${i + 1}:`, stmtError.message);
          } else {
            console.log(`✅ Statement ${i + 1} executed successfully`);
          }
        } catch (err) {
          console.warn(`⚠️  Error on statement ${i + 1}:`, err.message);
        }
      }
    } else {
      console.log('✅ Credit system schema executed successfully');
    }
    
    // Verify tables were created
    console.log('🔍 Verifying credit system tables...');
    
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['credit_purchases', 'credit_usage']);
    
    if (tablesError) {
      console.error('❌ Error checking tables:', tablesError);
    } else {
      console.log('📊 Credit system tables:', tables?.map(t => t.table_name) || []);
    }
    
    // Test the credit balance function
    console.log('🧪 Testing credit balance function...');
    
    const { data: testResult, error: testError } = await supabase
      .rpc('get_user_credit_balance', {
        p_user_id: '00000000-0000-0000-0000-000000000000' // Test UUID
      });
    
    if (testError) {
      console.warn('⚠️  Credit balance function test failed:', testError.message);
    } else {
      console.log('✅ Credit balance function working:', testResult);
    }
    
    console.log('🎉 Credit system setup completed!');
    
  } catch (error) {
    console.error('💥 Setup failed:', error);
    process.exit(1);
  }
}

// Run the setup
setupCreditSystem();