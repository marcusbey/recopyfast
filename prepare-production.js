#!/usr/bin/env node

const fs = require('fs');

console.log('🚀 Preparing RecopyFast for Production Deployment');
console.log('');

// Check if all required files exist
const requiredFiles = [
  'COMPLETE_DATABASE_SETUP_CLEAN.sql',
  'supabase/credit-system-schema.sql',
  '.env'
];

console.log('📋 Checking required files...');
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
  }
});

console.log('');

// Show live Stripe products created
console.log('🎯 Live Stripe Products Created:');
console.log('✅ RecopyFast Pro - $29/month');
console.log('   Price ID: price_1RykhFRhSIDUA9arUF01cvij');
console.log('');
console.log('✅ RecopyFast Enterprise - $99/month');
console.log('   Price ID: price_1RykiJRhSIDUA9arVulTZQPS');
console.log('');
console.log('✅ RecopyFast AI Credits - $19 one-time');
console.log('   Price ID: price_1RyklYRhSIDUA9ar2MSmKDoP');
console.log('');

// Show database setup status
console.log('🗄️  Database Setup Required:');
console.log('1. Execute COMPLETE_DATABASE_SETUP_CLEAN.sql in Supabase SQL Editor');
console.log('2. Execute supabase/credit-system-schema.sql in Supabase SQL Editor');
console.log('3. Verify tables are created');
console.log('');

// Show production environment variables
console.log('🔧 Production Environment Variables:');
const envContent = fs.readFileSync('.env', 'utf8');
const liveKeys = envContent.split('\n').filter(line => 
  line.includes('_LIVE=') || line.includes('REDIS_URL=') || line.includes('CRON_SECRET=')
);

liveKeys.forEach(key => {
  const [name, value] = key.split('=');
  if (value && value.length > 0) {
    console.log(`✅ ${name}=${value.substring(0, 20)}...`);
  }
});

console.log('');

// Show next steps
console.log('📝 Next Steps:');
console.log('1. ✅ Stripe products created with live Price IDs');
console.log('2. ⏳ Execute database migrations in Supabase Dashboard');
console.log('3. ⏳ Configure domain (recopyfa.st → Vercel)');
console.log('4. ⏳ Deploy to Vercel with production environment variables');
console.log('5. ⏳ Test all features in production');
console.log('');

console.log('🎉 Ready for database setup and deployment!');
console.log('');
console.log('Instructions:');
console.log('- See execute-sql-commands.md for database setup');
console.log('- Use live Price IDs in production environment');
console.log('- Configure webhook endpoint: https://recopyfa.st/api/webhooks/stripe');