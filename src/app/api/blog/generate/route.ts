import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const CONTENT_TOPICS = [
  {
    category: 'ai-tools',
    topics: [
      'How AI Website Builders Are Changing Web Development Forever',
      'The Future of No-Code Website Creation with AI',
      'AI-Powered Content Generation vs Traditional Copywriting',
      'Why Every Developer Should Embrace AI-Assisted Coding',
      'The Rise of AI Design Tools for Non-Designers',
      'Machine Learning in Web Development: What You Need to Know',
      'Automated Website Testing with AI: A Game Changer',
      'How AI is Making Web Development More Accessible'
    ]
  },
  {
    category: 'marketing',
    topics: [
      'Dynamic Content Updates: The Secret to Higher Conversion Rates',
      'A/B Testing Website Content Without Developer Dependencies',
      'Personalization at Scale: Making Every Visitor Feel Special',
      'The Psychology Behind Instant Content Updates',
      'How Real-Time Content Changes Boost User Engagement',
      'Marketing Automation Meets Website Management',
      'Content Localization Made Simple for Global Campaigns',
      'The ROI of Dynamic Website Content Management'
    ]
  },
  {
    category: 'freelancing',
    topics: [
      'The Freelancer\'s Guide to Efficient Client Website Management',
      'How to Scale Your Web Development Services Without Hiring',
      'Client Communication: Making Website Updates Transparent',
      'Pricing Website Maintenance Services in 2024',
      'Building Long-Term Client Relationships Through Better UX',
      'The Remote Freelancer\'s Toolkit for Website Management',
      'How to Deliver Faster Website Updates to Impress Clients',
      'Freelancer vs Agency: Competing with Better Tools'
    ]
  },
  {
    category: 'development',
    topics: [
      'Headless CMS vs Traditional CMS: Which is Right for You?',
      'API-First Content Management: Building for the Future',
      'The Developer\'s Guide to Content-First Architecture',
      'Implementing Real-Time Features Without Complex Infrastructure',
      'Modern JavaScript Patterns for Content Management',
      'Building Scalable Content Systems with Minimal Code',
      'The Evolution of Content Management Systems',
      'Progressive Enhancement in Modern Web Development'
    ]
  },
  {
    category: 'design',
    topics: [
      'Design Systems That Actually Work for Content Teams',
      'The Designer\'s Guide to Content-Driven Design',
      'Creating Flexible Layouts That Adapt to Dynamic Content',
      'Typography and Content Hierarchy in Modern Web Design',
      'Color Psychology in Website Content Management',
      'Accessibility in Dynamic Content Systems',
      'Mobile-First Design for Content-Heavy Websites',
      'The Art of White Space in Content-Rich Interfaces'
    ]
  },
  {
    category: 'business',
    topics: [
      'How Startups Can Compete with Enterprise-Level Content Management',
      'The Business Case for Dynamic Website Content',
      'Reducing Technical Debt Through Better Content Architecture',
      'Cost-Effective Website Management for Growing Companies',
      'Building a Content Strategy That Scales with Your Business',
      'The Hidden Costs of Traditional Website Management',
      'Digital Transformation Starts with Better Content Management',
      'Why Founders Should Care About Website Content Velocity'
    ]
  }
];

export async function GET() {
  try {
    // Select random topic
    const randomCategoryData = CONTENT_TOPICS[Math.floor(Math.random() * CONTENT_TOPICS.length)];
    const randomTopic = randomCategoryData.topics[Math.floor(Math.random() * randomCategoryData.topics.length)];

    return NextResponse.json({
      suggestion: {
        topic: randomTopic,
        category: randomCategoryData.category
      }
    });
  } catch (error) {
    console.error('Error suggesting blog topic:', error);
    return NextResponse.json(
      { error: 'Failed to suggest topic' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { topic, category, targetKeywords } = await request.json();

    // If no topic provided, select one randomly
    let selectedTopic = topic;
    let selectedCategory = category;

    if (!selectedTopic) {
      const randomCategoryData = CONTENT_TOPICS[Math.floor(Math.random() * CONTENT_TOPICS.length)];
      selectedCategory = randomCategoryData.category;
      selectedTopic = randomCategoryData.topics[Math.floor(Math.random() * randomCategoryData.topics.length)];
    }

    const prompt = `Write a compelling, naturally flowing blog post about "${selectedTopic}" for web developers, marketers, freelancers, and founders.

CONTENT REQUIREMENTS:
- Target audience: Developers, marketers, designers, freelancers, founders using AI website builders
- Tone: Conversational, engaging, and naturally flowing like Medium articles
- Length: 800-1200 words with smooth narrative flow
- Include real-world examples and stories woven throughout
- Naturally mention ReCopyFast as a helpful tool where contextually appropriate (don't force it)
- Focus on practical value and actionable insights

SEO KEYWORDS TO NATURALLY INCLUDE: ${targetKeywords || getKeywordsForCategory(selectedCategory)}

STRUCTURE:
- Compelling headline that hooks the reader
- Engaging introduction with a relatable scenario or question
- 3-4 main sections with practical insights and examples
- Real-world use cases and stories
- Actionable takeaways
- Natural conclusion that ties everything together

Please write the complete blog post in markdown format with proper headings, and make it genuinely valuable to read.`;

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a skilled content writer who creates engaging, naturally flowing blog posts that provide real value to readers. Write in a conversational tone that feels like a knowledgeable friend sharing insights.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error('OpenAI API call failed');
    }

    const openaiResult = await openaiResponse.json();
    const content = openaiResult.choices[0].message.content;

    // Extract title from content (assume it's the first # heading)
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1] : selectedTopic;
    
    // Create slug from title
    const slug = title.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    // Extract excerpt (first paragraph after title)
    const paragraphs = content.split('\n\n');
    let excerpt = '';
    for (const paragraph of paragraphs) {
      if (paragraph.trim() && !paragraph.startsWith('#') && paragraph.length > 50) {
        excerpt = paragraph.trim().substring(0, 200) + '...';
        break;
      }
    }

    const supabase = await createClient();

    // Save to database
    const { data: post, error } = await supabase
      .from('blog_posts')
      .insert({
        title,
        slug,
        content,
        excerpt,
        category: selectedCategory,
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      throw new Error('Failed to save blog post');
    }

    return NextResponse.json({
      success: true,
      post: {
        id: post.id,
        title: post.title,
        slug: post.slug,
        category: post.category,
        publishedAt: post.published_at
      }
    });

  } catch (error) {
    console.error('Error generating blog post:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate blog post' },
      { status: 500 }
    );
  }
}

function getKeywordsForCategory(category: string): string {
  const keywordMap: { [key: string]: string } = {
    'ai-tools': 'AI website builder, no-code development, automated web design, AI-powered tools, machine learning',
    'marketing': 'content marketing, conversion optimization, A/B testing, user engagement, digital marketing, website optimization',
    'freelancing': 'freelance web development, client management, website maintenance, remote work, freelancer tools',
    'development': 'web development, JavaScript, API development, headless CMS, modern web architecture, developer tools',
    'design': 'web design, UX/UI design, design systems, responsive design, user experience, visual design',
    'business': 'startup tools, business growth, digital transformation, content strategy, website ROI, business automation'
  };

  return keywordMap[category] || 'website management, content management, web development, digital tools';
}