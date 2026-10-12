import {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  FIXTURE_SITE_TOKEN,
  FIXTURE_TEXT,
} from "./stub-api";

interface FixturePageOptions {
  servingOrigin: string;
  hostOrigin: string;
  widget: boolean;
}

/**
 * The same authored page is used for every flow and for both sides of the CLS
 * comparison. Only the classic script tag is conditional; layout, assets and
 * copy stay byte-for-byte the same so the baseline measures the widget alone.
 */
export function fixturePage({
  servingOrigin,
  hostOrigin,
  widget,
}: FixturePageOptions): string {
  const embed = widget
    ? `<script
        src="${servingOrigin}/embed/recopyfast.js"
        data-site-id="${FIXTURE_SITE_ID}"
        data-site-token="${FIXTURE_SITE_TOKEN}"
        data-api-url="${servingOrigin}/api"
      ></script>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ReCopyFast built-artifact fixture</title>
    <style>
      * { box-sizing: border-box; }
      html { background: #f6f3ec; }
      body { margin: 0; color: #18201f; font: 18px/1.5 Arial, sans-serif; }
      main { width: min(760px, calc(100% - 48px)); margin: 72px auto; }
      h1 { margin: 0 0 18px; font-size: 48px; line-height: 1.05; }
      p { width: 620px; max-width: 100%; margin: 0 0 28px; }
      img { display: block; width: 320px; height: 180px; object-fit: cover; }
    </style>
    ${embed}
  </head>
  <body>
    <main>
      <h1 data-rcf-id="${FIXTURE_ELEMENT_IDS.heading}">${FIXTURE_TEXT.heading}</h1>
      <p data-rcf-id="${FIXTURE_ELEMENT_IDS.copy}">${FIXTURE_TEXT.copy}</p>
      <img
        data-rcf-id="${FIXTURE_ELEMENT_IDS.image}"
        src="${hostOrigin}/fixture-image.svg"
        width="320"
        height="180"
        alt="Fixture landscape"
      />
    </main>
  </body>
</html>`;
}
