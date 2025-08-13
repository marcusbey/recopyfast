#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('\n🚀 ReCopyFast Development Server Starting...\n');

// Check environment file
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const hasSupabaseUrl = envContent.includes('NEXT_PUBLIC_SUPABASE_URL=') && 
                        !envContent.includes('your_supabase_project_url');
  const hasSupabaseKey = envContent.includes('SUPABASE_SERVICE_ROLE_KEY=') && 
                        !envContent.includes('your_supabase_service_role_key');
  
  if (hasSupabaseUrl && hasSupabaseKey) {
    console.log('✅ Supabase configuration found');
    console.log('   - Full functionality enabled');
  } else {
    console.log('⚠️  Supabase configuration incomplete');
    console.log('   - Running in demo mode');
    console.log('   - Real-time sync will work, but data won\'t persist');
  }
} else {
  console.log('⚠️  No .env.local file found');
  console.log('   - Running in demo mode');
}

console.log('\n📍 Available URLs:');
console.log('   - Homepage:  http://localhost:3000');
console.log('   - Demo:      http://localhost:3000/demo');
console.log('   - Health:    http://localhost:3001/health');

console.log('\n🧪 To test the demo:');
console.log('   1. Visit http://localhost:3000/demo');
console.log('   2. Click on any text to edit it');
console.log('   3. Open multiple browser windows to see real-time sync');

if (!fs.existsSync(envPath) || !fs.readFileSync(envPath, 'utf8').includes('supabase.co')) {
  console.log('\n🔧 To enable full functionality:');
  console.log('   1. Create a Supabase project at https://supabase.com');
  console.log('   2. Copy your credentials to .env.local');
  console.log('   3. Run the SQL schema from supabase/schema.sql');
}

console.log('\n' + '='.repeat(60) + '\n');