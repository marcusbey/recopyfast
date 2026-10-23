import type { Metadata } from "next";
import OwnersPage from "@/components/landing/owners/OwnersPage";
import { SITE_NAME } from "@/lib/seo/site-identity";

const PATH = "/for/owners";
const TITLE = "Edit your own hours, prices and specials";
const DESCRIPTION =
  "For business owners whose website someone else built: your developer adds one line once, then you change hours, prices and specials yourself.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    type: "website",
    url: PATH,
    siteName: SITE_NAME,
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    images: ["/twitter-image"],
  },
};

export default function ForOwnersPage() {
  return <OwnersPage />;
}
