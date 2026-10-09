/**
 * The model call behind every AI blog draft, moved out of
 * src/app/api/blog/generate/route.ts in s89. Prompt, model and parameters are
 * unchanged.
 *
 * It returns markdown and nothing else. Whatever the model writes — front
 * matter claiming `status: published` included — is the post's body; it never
 * decides whether the post is live. That is `drafts.ts`'s row, and a person's
 * publish (ADR 057).
 */

export interface PostRequest {
  topic: string;
  category: string;
  keywords: string;
}

export type GeneratePost = (request: PostRequest) => Promise<string>;

const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";
const BLOG_MODEL = "gpt-4o-mini";
const BLOG_TEMPERATURE = 0.7;
const BLOG_MAX_TOKENS = 2000;

const SYSTEM_PROMPT =
  "You are a skilled content writer who creates engaging, naturally flowing blog posts that provide real value to readers. Write in a conversational tone that feels like a knowledgeable friend sharing insights.";

function promptFor({ topic, keywords }: PostRequest): string {
  return `Write a compelling, naturally flowing blog post about "${topic}" for web developers, marketers, freelancers, and founders.

CONTENT REQUIREMENTS:
- Target audience: Developers, marketers, designers, freelancers, founders using AI website builders
- Tone: Conversational, engaging, and naturally flowing like Medium articles
- Length: 800-1200 words with smooth narrative flow
- Include real-world examples and stories woven throughout
- Naturally mention ReCopyFast as a helpful tool where contextually appropriate (don't force it)
- Focus on practical value and actionable insights

SEO KEYWORDS TO NATURALLY INCLUDE: ${keywords}

STRUCTURE:
- Compelling headline that hooks the reader
- Engaging introduction with a relatable scenario or question
- 3-4 main sections with practical insights and examples
- Real-world use cases and stories
- Actionable takeaways
- Natural conclusion that ties everything together

Please write the complete blog post in markdown format with proper headings, and make it genuinely valuable to read.`;
}

/** `choices[0].message.content`, or null when the answer is not that shape. */
function readContent(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const { choices } = result as { choices?: unknown };
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}

export const generatePostMarkdown: GeneratePost = async (request) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // It used to send "Bearer undefined" and fail at OpenAI; say what is
    // missing instead (AGENTS.md, non-negotiable 8).
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BLOG_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: promptFor(request) },
      ],
      temperature: BLOG_TEMPERATURE,
      max_tokens: BLOG_MAX_TOKENS,
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI API call failed");
  }

  const content = readContent(await response.json());
  if (!content || !content.trim()) {
    throw new Error("OpenAI returned no content");
  }
  return content;
};
