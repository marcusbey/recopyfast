#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database configuration — credentials come from the environment only.
// Set DATABASE_URL, or SUPABASE_DB_HOST + SUPABASE_PASSWORD.
const connectionString = process.env.DATABASE_URL;
const host = process.env.SUPABASE_DB_HOST;
const password = process.env.SUPABASE_PASSWORD;

if (!connectionString && !(host && password)) {
  console.error(
    '❌ Missing database credentials. Set DATABASE_URL, or SUPABASE_DB_HOST and SUPABASE_PASSWORD.'
  );
  process.exit(1);
}

const client = new Client(
  connectionString
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : {
        host,
        port: Number(process.env.SUPABASE_DB_PORT || 5432),
        database: process.env.SUPABASE_DB_NAME || 'postgres',
        user: process.env.SUPABASE_DB_USER || 'postgres',
        password,
        ssl: { rejectUnauthorized: false }
      }
);

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