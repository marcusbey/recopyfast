// Test script to verify blog generation functionality
// Run with: node test-blog-generation.js

const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function testBlogGeneration() {
  try {
    console.log('🧪 Testing blog generation...\n');

    // Test topic suggestion
    console.log('1. Testing topic suggestion...');
    const topicResponse = await fetch(`${API_URL}/api/blog/generate`);
    
    if (!topicResponse.ok) {
      throw new Error(`Topic suggestion failed: ${topicResponse.status}`);
    }
    
    const { suggestion } = await topicResponse.json();
    console.log(`✅ Suggested topic: "${suggestion.topic}" (${suggestion.category})\n`);

    // Test blog post generation
    console.log('2. Testing blog post generation...');
    const generateResponse = await fetch(`${API_URL}/api/blog/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: suggestion.topic,
        category: suggestion.category,
      }),
    });

    if (!generateResponse.ok) {
      throw new Error(`Blog generation failed: ${generateResponse.status}`);
    }

    const { post } = await generateResponse.json();
    console.log('✅ Blog post generated successfully!');
    console.log(`   Title: ${post.title}`);
    console.log(`   Slug: ${post.slug}`);
    console.log(`   Category: ${post.category}`);
    console.log(`   Published: ${post.publishedAt}\n`);

    console.log('🎉 Blog generation test completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('- Set up OPENAI_API_KEY in your environment');
    console.log('- Configure CRON_SECRET for automated generation');
    console.log('- Deploy to Vercel to enable daily blog automation');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n🔍 Troubleshooting:');
    console.log('- Ensure your local server is running (npm run dev)');
    console.log('- Check that OPENAI_API_KEY is set in .env.local');
    console.log('- Verify Supabase connection is working');
  }
}

// Run the test
testBlogGeneration();