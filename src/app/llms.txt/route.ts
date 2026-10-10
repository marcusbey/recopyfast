import { buildLlmsTxt } from "@/lib/seo/llms-txt";
import { resolveSiteUrl } from "@/lib/seo/site-url";

/**
 * `/llms.txt` — the site map AI search reads (s88). Static: its inputs are
 * typed content and the configured origin, both fixed at build time. Served as
 * plain text, as llmstxt.org files are; the body is Markdown.
 *
 * Sessionless in `src/middleware.ts`, like robots.txt and sitemap.xml: no
 * caller of this file can have a session, so a GoTrue round trip per fetch
 * would buy nothing.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsTxt(resolveSiteUrl()), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
