/**
 * The blog's topic list and keyword map, moved out of
 * src/app/api/blog/generate/route.ts in s89 so the daily cron can draft
 * in-process instead of fetching its own public URL. Content unchanged.
 */

export interface BlogTopic {
  topic: string;
  category: string;
}

export const CONTENT_TOPICS: ReadonlyArray<{
  category: string;
  topics: readonly string[];
}> = [
  {
    category: "ai-tools",
    topics: [
      "How AI Website Builders Are Changing Web Development Forever",
      "The Future of No-Code Website Creation with AI",
      "AI-Powered Content Generation vs Traditional Copywriting",
      "Why Every Developer Should Embrace AI-Assisted Coding",
      "The Rise of AI Design Tools for Non-Designers",
      "Machine Learning in Web Development: What You Need to Know",
      "Automated Website Testing with AI: A Game Changer",
      "How AI is Making Web Development More Accessible",
    ],
  },
  {
    category: "marketing",
    topics: [
      "Dynamic Content Updates: The Secret to Higher Conversion Rates",
      "A/B Testing Website Content Without Developer Dependencies",
      "Personalization at Scale: Making Every Visitor Feel Special",
      "The Psychology Behind Instant Content Updates",
      "How Real-Time Content Changes Boost User Engagement",
      "Marketing Automation Meets Website Management",
      "Content Localization Made Simple for Global Campaigns",
      "The ROI of Dynamic Website Content Management",
    ],
  },
  {
    category: "freelancing",
    topics: [
      "The Freelancer's Guide to Efficient Client Website Management",
      "How to Scale Your Web Development Services Without Hiring",
      "Client Communication: Making Website Updates Transparent",
      "Pricing Website Maintenance Services in 2024",
      "Building Long-Term Client Relationships Through Better UX",
      "The Remote Freelancer's Toolkit for Website Management",
      "How to Deliver Faster Website Updates to Impress Clients",
      "Freelancer vs Agency: Competing with Better Tools",
    ],
  },
  {
    category: "development",
    topics: [
      "Headless CMS vs Traditional CMS: Which is Right for You?",
      "API-First Content Management: Building for the Future",
      "The Developer's Guide to Content-First Architecture",
      "Implementing Real-Time Features Without Complex Infrastructure",
      "Modern JavaScript Patterns for Content Management",
      "Building Scalable Content Systems with Minimal Code",
      "The Evolution of Content Management Systems",
      "Progressive Enhancement in Modern Web Development",
    ],
  },
  {
    category: "design",
    topics: [
      "Design Systems That Actually Work for Content Teams",
      "The Designer's Guide to Content-Driven Design",
      "Creating Flexible Layouts That Adapt to Dynamic Content",
      "Typography and Content Hierarchy in Modern Web Design",
      "Color Psychology in Website Content Management",
      "Accessibility in Dynamic Content Systems",
      "Mobile-First Design for Content-Heavy Websites",
      "The Art of White Space in Content-Rich Interfaces",
    ],
  },
  {
    category: "business",
    topics: [
      "How Startups Can Compete with Enterprise-Level Content Management",
      "The Business Case for Dynamic Website Content",
      "Reducing Technical Debt Through Better Content Architecture",
      "Cost-Effective Website Management for Growing Companies",
      "Building a Content Strategy That Scales with Your Business",
      "The Hidden Costs of Traditional Website Management",
      "Digital Transformation Starts with Better Content Management",
      "Why Founders Should Care About Website Content Velocity",
    ],
  },
];

function indexFor(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

/** A random topic from the list, with its category. */
export function pickTopic(random: () => number = Math.random): BlogTopic {
  const group = CONTENT_TOPICS[indexFor(random, CONTENT_TOPICS.length)];
  return {
    topic: group.topics[indexFor(random, group.topics.length)],
    category: group.category,
  };
}

/** SEO keywords woven into the prompt for a category. */
export function keywordsForCategory(category: string): string {
  const keywordMap: Record<string, string> = {
    "ai-tools":
      "AI website builder, no-code development, automated web design, AI-powered tools, machine learning",
    marketing:
      "content marketing, conversion optimization, A/B testing, user engagement, digital marketing, website optimization",
    freelancing:
      "freelance web development, client management, website maintenance, remote work, freelancer tools",
    development:
      "web development, JavaScript, API development, headless CMS, modern web architecture, developer tools",
    design:
      "web design, UX/UI design, design systems, responsive design, user experience, visual design",
    business:
      "startup tools, business growth, digital transformation, content strategy, website ROI, business automation",
  };

  return (
    keywordMap[category] ||
    "website management, content management, web development, digital tools"
  );
}
