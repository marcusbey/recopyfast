import { ImageResponse } from "next/og";

/**
 * The free tools' social card (s96, plan decision 12): the brand's `<>` mark
 * on a solid teal tile, the tool's name and one line — the shape of the root
 * card, without its gradient (design system: "No gradient, ever — including
 * logos, favicons and OG images").
 *
 * Only these fixed strings are ever drawn. No page text, URL or finding from a
 * scan reaches an image: an image is a channel a stranger's text must not get.
 * Literals match the globals.css palette; CSS variables are unavailable here.
 */

export const TOOL_OG_SIZE = { width: 1200, height: 630 };
export const TOOL_OG_CONTENT_TYPE = "image/png";

export function renderToolOgImage({
  eyebrow,
  title,
  line,
}: {
  eyebrow: string;
  title: string;
  line: string;
}): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          backgroundColor: "hsl(200 18% 7%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              backgroundColor: "hsl(174 48% 58%)",
            }}
          >
            <svg
              width="46"
              height="46"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m16 18 6-6-6-6" />
              <path d="m8 6-6 6 6 6" />
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              fontWeight: 600,
              color: "#cbd5e1",
            }}
          >
            {eyebrow}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 36,
            lineHeight: 1.35,
            color: "#cbd5e1",
            maxWidth: 960,
          }}
        >
          {line}
        </div>
      </div>
    ),
    { ...TOOL_OG_SIZE },
  );
}
