import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/seo/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = resolveSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/auth/` covers the OAuth callback, the magic-link confirmation and
        // the auth error page: they carry tokens or codes in the query string,
        // /auth/confirm spends a one-time token, and none has search value.
        //
        // `/dashboard`, not `/dashboard/`: rules are prefix matches, and until
        // s88 the trailing slash left the bare `/dashboard` crawlable. Its pages
        // also send `X-Robots-Tag: noindex` (next.config.ts).
        //
        // Pages whose protection is a noindex — /login, /signup, /edit — are
        // deliberately NOT listed: a disallowed page is never fetched, so its
        // noindex would never be read. Nothing the sitemap submits may be
        // blocked either (src/__tests__/app/robots.test.ts).
        disallow: ["/api/", "/dashboard", "/auth/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
