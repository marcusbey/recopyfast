#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
const client = new Client({
  host: 'db.uexwowziiigweobgpmtk.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'compozitComxmal1985%%',
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  console.log('🚀 Setting up database...');
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Read and execute the main database schema
    console.log('📋 Executing main database schema...');
    const mainSchema = fs.readFileSync(
      path.join(process.cwd(), 'COMPLETE_DATABASE_SETUP_CLEAN.sql'), 
      'utf8'
    );
    
    await client.query(mainSchema);
    console.log('✅ Main schema executed');
    
    // Read and execute the credit system schema
    console.log('📋 Executing credit system schema...');
    const creditSchema = fs.readFileSync(
      path.join(process.cwd(), 'supabase', 'credit-system-schema.sql'), 
      'utf8'
    );
    
    await client.query(creditSchema);
    console.log('✅ Credit system schema executed');
    
    // Verify tables exist
    console.log('🔍 Verifying tables...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('📊 Tables created:');
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // Test credit system function
    console.log('🧪 Testing credit balance function...');
    const testResult = await client.query(`
      SELECT * FROM public.get_user_credit_balance('00000000-0000-0000-0000-000000000000');
    `);
    
    console.log('✅ Credit balance function working:', testResult.rows[0]);
    
    console.log('🎉 Database setup completed successfully!');
    
  } catch (error) {
    console.error('💥 Setup failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the setup
setupDatabase();