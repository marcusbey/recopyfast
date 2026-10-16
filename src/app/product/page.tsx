import type { Metadata } from "next";
import HomePage from "@/components/landing/HomePage";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/site-identity";

export const metadata: Metadata = {
  title: "Product overview",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/product" },
  openGraph: {
    type: "website",
    url: "/product",
    siteName: SITE_NAME,
    title: `Product overview | ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: `Product overview | ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    images: ["/twitter-image"],
  },
};

export default function ProductPage() {
  return <HomePage />;
}
