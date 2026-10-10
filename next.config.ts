import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { SENTRY_TUNNEL_ROUTE } from "./src/lib/monitoring/sentry-tunnel";
import { resolveBuildRelease } from "./src/lib/monitoring/sentry-release";

// The one Sentry release (s84): the build's commit SHA, inlined below for the
// browser, server and Edge inits and handed to `withSentryConfig` for the
// source-map upload. See src/lib/monitoring/sentry-release.ts.
const sentryRelease = resolveBuildRelease(process.env);

const nextConfig: NextConfig = {
  ...(sentryRelease
    ? { env: { NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease } }
    : {}),

  // Enable experimental features for better monitoring
  experimental: {
    // instrumentationHook is enabled by default in Next.js 15
  },

  // Turbopack configuration (required in Next.js 16 when webpack config is present)
  turbopack: {},

  // Configure webpack for Node.js compatibility
  webpack: (config, { isServer }) => {
    // Handle Node.js modules that don't work in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "fs": false,
        "net": false,
        "tls": false,
        "crypto": false,
        "stream": false,
        "url": false,
        "zlib": false,
        "http": false,
        "https": false,
        "assert": false,
        "os": false,
        "path": false,
        "timers": false,
        "util": false,
        "dns": false,
      };
    }

    // Handle Redis and other Node.js modules
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'redis': 'commonjs redis',
        'ioredis': 'commonjs ioredis',
      });
    }

    return config;
  },
  
  // Configure headers for security and monitoring
  async headers() {
    return [
      {
        source: "/try/rcf-try.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            // Bookmarklets save this exact URL. A one-year immutable response
            // pinned early preview defects in every already-saved bookmark, so
            // the permanent URL must revalidate just like the production embed.
            value: "public, max-age=0, must-revalidate",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
      {
        // s88. The dashboard's layout also exports `robots: noindex, nofollow`
        // (s88 review), so its HTML and this header say the same thing
        // (src/__tests__/app/seo-canonicals.test.ts); the header is read
        // without parsing the page. The auth redirect and robots.txt already
        // keep crawlers out; this is for the one that ignores robots.txt and
        // reaches a page anyway.
        // `:path*` also matches the bare `/dashboard`
        // (src/__tests__/next-config-robots-headers.test.ts).
        source: "/dashboard/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // Apply to all routes
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
  
  // Configure redirects for better UX
  async redirects() {
    return [
      // The 2026-09-25 launch audit found /pricing answering 404: pricing is a
      // section of the landing page (Pricing.tsx, id="pricing"), yet /pricing
      // is the URL people type. Permanent (308) because there is no plan for a
      // standalone page; the sitemap deliberately does not list /pricing.
      // Config redirects run before middleware, so src/middleware.ts never
      // sees this path.
      { source: "/pricing", destination: "/#pricing", permanent: true },
      // s70b: the Content page became Changes. The old URL is in bookmarks
      // and in every tab the old sidebar opened, so it answers 308 rather
      // than 404; the session gate in src/middleware.ts then applies to
      // /dashboard/changes like any dashboard page.
      {
        source: "/dashboard/content",
        destination: "/dashboard/changes",
        permanent: true,
      },
    ];
  },

  // Configure rewrites for API optimization
  async rewrites() {
    return [
      // Add any production rewrites here
    ];
  },
  
  // Optimize images
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  
  // Enable build optimizations
  poweredByHeader: false,
  
  // Build configuration
  // Type errors now FAIL the build (no more silent masking). The build uses
  // tsconfig.build.json, which excludes test files — production app code is fully
  // type-checked; broken test mocks are caught separately by `npm run type-check`.
  typescript: {
    ignoreBuildErrors: false,
    tsconfigPath: "./tsconfig.build.json",
  },
  
  // Configure output for production deployment
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
};

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  
  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,
  
  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
  
  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,
  
  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,
  
  // Hides source maps from generated client bundles
  hideSourceMaps: true,

  // Browser events go to this app's own origin and are rewritten to Sentry's
  // ingest server-side (s46). Same-origin keeps them inside the CSP's
  // `connect-src 'self'` and out of reach of ad blockers keyed on sentry.io.
  // A fixed path, not `true` (random per build): src/middleware.ts has to name
  // it to let it through without a session lookup.
  tunnelRoute: SENTRY_TUNNEL_ROUTE,

  // Source maps are uploaded under the same release the inits report (s84).
  // Without an explicit name the SDK guesses, and reads SENTRY_RELEASE and
  // GITHUB_SHA before VERCEL_GIT_COMMIT_SHA.
  ...(sentryRelease ? { release: { name: sentryRelease } } : {}),
};

// Make sure adding Sentry options is the last code to run before exporting
export default process.env.NEXT_PUBLIC_SENTRY_DSN 
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;
