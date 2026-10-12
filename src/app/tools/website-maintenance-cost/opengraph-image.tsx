import { ImageResponse } from "next/og";

export const alt =
  "What free copy changes cost you - a free calculator from ReCopyFast.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social card for the calculator. The palette is `src/app/opengraph-image.tsx`'s,
 * solid, no gradient. Only fixed strings are drawn: no query value ever reaches
 * an image, so a crafted link cannot put its own words on a ReCopyFast card.
 *
 * s96's shared tool renderer folds this in when it merges; until then this is
 * a local copy (s98 plan, merge points).
 */
export default function OpenGraphImage() {
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
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "hsl(174 48% 58%)",
            marginBottom: 32,
          }}
        >
          Free calculator
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            maxWidth: 960,
          }}
        >
          What free copy changes cost you
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 40,
            color: "#cbd5e1",
          }}
        >
          ReCopyFast
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            width: 240,
            height: 10,
            borderRadius: 999,
            backgroundColor: "hsl(174 48% 58%)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
