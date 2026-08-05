import { ImageResponse } from "next/og";

export const alt =
  "ReCopyFast - Transform any website into an editable platform with a simple script tag";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Default social preview card, shared by Open Graph and Twitter (see
 * `twitter-image.tsx`). Uses the brand's solid teal mark on a dark ground so
 * the card stays legible in both light and dark timelines. Literals match the
 * globals.css palette — CSS variables are unavailable inside ImageResponse.
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
          backgroundImage:
            "linear-gradient(135deg, hsl(200 18% 7%) 0%, hsl(200 15% 12%) 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            marginBottom: 48,
          }}
        >
          <div
            style={{
              width: 104,
              height: 104,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 26,
              backgroundColor: "hsl(174 48% 58%)",
            }}
          >
            <svg
              width="60"
              height="60"
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
              fontSize: 64,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: "-0.02em",
            }}
          >
            ReCopyFast
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 40,
            lineHeight: 1.35,
            color: "#cbd5e1",
            maxWidth: 880,
          }}
        >
          Transform any website into an editable platform with a simple script
          tag
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 56,
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
