import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get suggested topic
    const topicResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/blog/generate`, {
      method: 'GET',
    });

    if (!topicResponse.ok) {
      throw new Error('Failed to get topic suggestion');
    }

    const { suggestion } = await topicResponse.json();

    // Generate blog post
    const generateResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/blog/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: suggestion.topic,
        category: suggestion.category,
        targetKeywords: getKeywordsForCategory(suggestion.category)
      }),
    });

    if (!generateResponse.ok) {
      throw new Error('Failed to generate blog post');
    }

    const { post } = await generateResponse.json();

    console.log(`✅ Generated blog post: "${post.title}" (${post.slug})`);

    return NextResponse.json({
      success: true,
      message: 'Blog post generated successfully',
      post: {
        title: post.title,
        slug: post.slug,
        category: post.category,
        publishedAt: post.publishedAt
      }
    });

  } catch (error) {
    console.error('Error in blog generation cron job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate blog post' },
      { status: 500 }
    );
  }
}

function getKeywordsForCategory(category: string): string {
  const keywordMap: { [key: string]: string } = {
    'ai-tools': 'AI website builder, no-code development, automated web design, AI-powered tools, machine learning, website automation',
    'marketing': 'content marketing, conversion optimization, A/B testing, user engagement, digital marketing, website optimization, dynamic content',
    'freelancing': 'freelance web development, client management, website maintenance, remote work, freelancer tools, project management',
    'development': 'web development, JavaScript, API development, headless CMS, modern web architecture, developer tools, real-time updates',
    'design': 'web design, UX/UI design, design systems, responsive design, user experience, visual design, content-first design',
    'business': 'startup tools, business growth, digital transformation, content strategy, website ROI, business automation, scaling websites'
  };

  return keywordMap[category] || 'website management, content management, web development, digital tools, ReCopyFast';
}