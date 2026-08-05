import { ImageResponse } from "next/og";

/**
 * 32px covers the browser tab; 192px and 512px are the sizes Chrome requires
 * before it will offer to install the PWA (referenced from `manifest.ts`).
 */
const ICON_SIZES = [32, 192, 512] as const;

const FAVICON_SIZE = 32;

export function generateImageMetadata() {
  return ICON_SIZES.map((dimension) => ({
    id: String(dimension),
    size: { width: dimension, height: dimension },
    contentType: "image/png",
  }));
}

/**
 * The ReCopyFast brand mark: a lucide `Code` glyph on the solid teal accent
 * tile used by the site header and auth pages. The literal matches
 * `--accent-solid` (light) in globals.css — CSS variables are unavailable
 * inside ImageResponse.
 */
export default async function Icon({ id }: { id: Promise<string> }) {
  const dimension = Number(await id);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: dimension * 0.22,
          backgroundColor: "hsl(176 54% 28%)",
        }}
      >
        <svg
          width={dimension * 0.62}
          height={dimension * 0.62}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          // The glyph is scaled from a 24-unit viewBox, so stroke width stays
          // visually proportional. Thicken it slightly at favicon size, where
          // a 2.5-unit stroke renders under 2 physical pixels.
          strokeWidth={dimension <= FAVICON_SIZE ? 3 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </svg>
      </div>
    ),
    { width: dimension, height: dimension },
  );
}
