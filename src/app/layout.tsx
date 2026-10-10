import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OPEN_GRAPH,
  SITE_TITLE,
} from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";

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
 * Site-wide defaults. Every key set here is inherited by every page that does
 * not set the same key itself — Next merges metadata per top-level key, and a
 * page that omits `alternates` gets its parent's whole `alternates`.
 *
 * So nothing page-specific belongs here. Until s88 this object carried
 * `alternates: { canonical: "/" }` and `openGraph.url: "/"`, and every page
 * without its own — /blog, each blog post, /privacy, /terms, /demo, and /edit
 * on top of its noindex — told search engines it was a duplicate of the
 * homepage and pointed shared links at it. A page names its own canonical;
 * one that does not gets none, which search engines resolve themselves, rather
 * than a wrong one. The homepage sets its own in `src/app/page.tsx`.
 * src/__tests__/app/seo-canonicals.test.ts resolves every public route through
 * Next's own merge and fails if a page inherits the homepage again.
 */
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
    "website editing",
    "content management",
    "no-code",
    "script tag",
    "live editing",
  ],
  openGraph: SITE_OPEN_GRAPH,
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
      /* Attribute-level only, and only on this element. Two things legitimately
         mutate <html> before hydration: the theme script below writes
         data-theme, and browser extensions (UI.Vision's data-kantu, Grammarly,
         password managers) inject their own markers. React 19 diffs server
         attributes against the extension-modified DOM and logs a hydration
         error for attributes this app never rendered. Suppressing here does
         not extend to children, so real hydration bugs still surface. */
      suppressHydrationWarning
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
