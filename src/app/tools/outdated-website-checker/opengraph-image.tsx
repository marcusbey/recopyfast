import { renderToolOgImage } from "@/lib/tools/og-image";

export const alt = "Is your website out of date? — a free tool from ReCopyFast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Fixed copy only: scanned page text never reaches a social card. */
export default function OutdatedCheckerOpenGraphImage() {
  return renderToolOgImage({
    eyebrow: "Free tool · ReCopyFast",
    title: "Is your website out of date?",
    line: "Find dates, prices and promotions that may have passed on up to ten pages.",
  });
}
