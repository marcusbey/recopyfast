import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/seo/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = resolveSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/auth/` covers the OAuth callback and the auth error page: both can
        // carry tokens or codes in the query string and have no search value.
        disallow: ["/api/", "/dashboard/", "/auth/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
