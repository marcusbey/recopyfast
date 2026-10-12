import { renderToolOgImage } from "@/lib/tools/og-image";

export const alt = "Website Typo Finder — a free tool from ReCopyFast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The Website Typo Finder's social card. Fixed copy only (`og-image.tsx`). */
export default function TypoFinderOpenGraphImage() {
  return renderToolOgImage({
    eyebrow: "Free tool · ReCopyFast",
    title: "Website Typo Finder",
    line: "Find likely typos on up to ten pages of your site, each in its sentence.",
  });
}
