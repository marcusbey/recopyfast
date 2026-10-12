import { renderToolOgImage } from "@/lib/tools/og-image";

export const alt = "Free website tools from ReCopyFast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The /tools hub's social card. Fixed copy only (`og-image.tsx`). */
export default function ToolsOpenGraphImage() {
  return renderToolOgImage({
    eyebrow: "ReCopyFast",
    title: "Free website tools",
    line: "Check your site's copy for typos and more. No account needed.",
  });
}
