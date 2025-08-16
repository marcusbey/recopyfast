const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Testing Supabase Connection');
console.log('===============================');
console.log(`URL: ${supabaseUrl}`);
console.log(`Service Key: ${supabaseServiceKey ? 'Present' : 'Missing'}`);

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testBasicConnection() {
  try {
    console.log('\n1️⃣ Testing auth session...');
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    console.log(`   Session: ${sessionError ? 'Error - ' + sessionError.message : 'OK'}`);

    console.log('\n2️⃣ Testing system info...');
    // Try to access a system function
    const { data: version, error: versionError } = await supabase.rpc('version');
    console.log(`   Version: ${versionError ? 'Error - ' + versionError.message : version || 'Available'}`);

    console.log('\n3️⃣ Testing basic query...');
    // Try a simple count query
    const { count, error: countError } = await supabase
      .from('sites')
      .select('*', { count: 'exact', head: true });
    console.log(`   Sites table: ${countError ? 'Error - ' + countError.message : `Found ${count} records`}`);

    console.log('\n4️⃣ Testing REST endpoint...');
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey
      }
    });
    console.log(`   REST API: ${response.ok ? 'Connected' : 'Failed - ' + response.status}`);

    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    return false;
  }
}

testBasicConnection();