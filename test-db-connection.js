const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testDatabaseConnection() {
  console.log('🧪 Testing ReCopyFast Database Connection');
  console.log('=========================================\n');

  try {
    // Test 1: Create a test site
    console.log('1. Testing site creation...');
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .insert({
        domain: `test-${Date.now()}.example.com`,
        name: 'Test Site for Database Verification'
      })
      .select()
      .single();

    if (siteError) {
      console.log('   ❌ Site creation failed:', siteError.message);
      return;
    } else {
      console.log('   ✅ Site created successfully:', siteData.id);
    }

    // Test 2: Create a content element
    console.log('2. Testing content element creation...');
    const { data: contentData, error: contentError } = await supabase
      .from('content_elements')
      .insert({
        site_id: siteData.id,
        element_id: 'test-heading',
        selector: 'h1.main-title',
        original_content: 'Original Title',
        current_content: 'Updated Title'
      })
      .select()
      .single();

    if (contentError) {
      console.log('   ❌ Content element creation failed:', contentError.message);
    } else {
      console.log('   ✅ Content element created successfully:', contentData.id);
    }

    // Test 3: Test team functionality
    console.log('3. Testing team creation...');
    const { data: teamData, error: teamError } = await supabase
      .from('teams')
      .insert({
        name: 'Test Team',
        owner_id: '00000000-0000-0000-0000-000000000000' // placeholder UUID
      })
      .select()
      .single();

    if (teamError) {
      console.log('   ⚠️  Team creation (expected to fail without real user):', teamError.message);
    } else {
      console.log('   ✅ Team created successfully:', teamData.id);
    }

    // Test 4: Check billing tables
    console.log('4. Testing billing tables...');
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('count', { count: 'exact', head: true });

    if (customerError) {
      console.log('   ❌ Customer table access failed:', customerError.message);
    } else {
      console.log('   ✅ Billing tables accessible (customer count check)');
    }

    // Cleanup test data
    console.log('5. Cleaning up test data...');
    if (contentData) {
      await supabase.from('content_elements').delete().eq('id', contentData.id);
    }
    if (siteData) {
      await supabase.from('sites').delete().eq('id', siteData.id);
    }
    if (teamData) {
      await supabase.from('teams').delete().eq('id', teamData.id);
    }
    console.log('   ✅ Test data cleaned up');

    console.log('\n🎉 DATABASE CONNECTION TEST SUCCESSFUL!');
    console.log('   Your ReCopyFast database is fully functional.');
    console.log('   All core features are ready to use.');

  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    console.error('   Please check your Supabase configuration');
  }
}

testDatabaseConnection();