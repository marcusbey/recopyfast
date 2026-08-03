import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

/**
 * Instrument Sans carries the UI. It is a grotesque with more character than
 * the Inter default it replaces — narrower, with a distinctive single-storey
 * `g` and open apertures that hold up at 12–13px in dense tables.
 *
 * Bricolage Grotesque is the display voice: marketing headlines only. It has
 * the weight range (up to 800) and the slightly off-kilter cuts that let a
 * hero headline carry a page without a container doing the work for it.
 *
 * JetBrains Mono is reserved for machine-generated strings: site tokens,
 * element IDs, embed snippets. It is never used for prose.
 */
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

/**
 * Canonical origin used to build absolute SEO URLs.
 *
 * Resolution order: the explicitly configured app URL, then Vercel's stable
 * production domain, then the per-deployment URL, then the dev fallback.
 * Vercel exposes its URL vars as bare hostnames, but this project's `.env`
 * sets `VERCEL_URL` with a scheme, so both shapes are accepted.
 */
function resolveSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  return withScheme.replace(/\/+$/, "");
}

const SITE_NAME = "ReCopyFast";
const SITE_TITLE = "ReCopyFast - Universal CMS Layer";
const SITE_DESCRIPTION =
  "Transform any website into an editable platform with a simple script tag";

export const metadata: Metadata = {
  // Without this, every relative OG/Twitter image URL resolves against
  // localhost in production.
  metadataBase: new URL(resolveSiteUrl()),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "CMS",
    "headless CMS",
    "website editing",
    "content management",
    "no-code",
    "script tag",
    "live editing",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // NOTE: do not add an `icons` field here. Next.js skips the file-based
  // `icon.tsx` / `apple-icon.tsx` routes whenever `metadata.icons` is set
  // (see the `if (!resolvedMetadata.icons)` guard in Next's resolve-metadata),
  // which would silently drop the generated icons.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${bricolageGrotesque.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/*
          Applies the stored theme before first paint. Without this the page
          renders with the OS theme and then snaps to the user's choice on
          hydration — a visible flash on every navigation. Kept inline and
          synchronous for that reason; it must run before the body paints.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("recopyfast-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
