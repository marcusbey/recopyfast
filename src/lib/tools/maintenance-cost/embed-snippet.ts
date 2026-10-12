import { describeTerms, type CostResult } from "./calculate";
import { serializeParams } from "./params";

/**
 * The copyable result card (s98).
 *
 * The brief asked for an embeddable card. An `<iframe>` of our page cannot be
 * one: every response carries `frame-ancestors 'none'` and `X-Frame-Options:
 * DENY` (content-security-policy.ts, middleware.ts), so every browser refuses
 * it. Loosening that for a marketing card would need an ADR 059 amendment, so
 * the card is plain HTML the visitor pastes into their own page, built here in
 * the browser from the numbers they typed. No server route, no image.
 *
 * What goes on a stranger's page is held to the least it can do: one anchor,
 * inline styles, no `<script>`, no `<style>`, no class, no event attribute.
 * Every interpolation is escaped even though the values are numbers and an
 * enum, so the guarantee does not depend on how the caller built the result.
 */

export const CALCULATOR_PATH = "/tools/website-maintenance-cost";

const EMBED_UTM = "utm_source=embed&utm_medium=card&utm_campaign=free_tools";

/** The text on the card, shared by the snippet and the on-page preview. */
export type CardText = {
  eyebrow: string;
  figure: string;
  inputs: string;
  cta: string;
};

export function buildCardText(result: CostResult): CardText {
  const { inputs, formatted } = result;
  return {
    eyebrow: "Free copy changes cost us",
    figure: `${formatted.unbilledYearly} a year`,
    inputs: `${describeTerms(inputs)} at ${formatted.hourlyRate} an hour, ${inputs.billedPercent}% billed`,
    cta: "Calculate yours · ReCopyFast",
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";

const CARD_STYLE = [
  "display:block",
  "box-sizing:border-box",
  "max-width:360px",
  "padding:16px 20px",
  "border:1px solid #cbd5d9",
  "border-radius:12px",
  "background:#ffffff",
  "color:#14191c",
  `font-family:${FONT}`,
  "line-height:1.4",
  "text-decoration:none",
].join(";");

const EYEBROW_STYLE =
  "display:block;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#4d5b61";
const FIGURE_STYLE =
  "display:block;margin:4px 0;font-size:32px;font-weight:700;color:#14191c";
const INPUTS_STYLE = "display:block;font-size:13px;color:#4d5b61";
const CTA_STYLE =
  "display:block;margin-top:10px;font-size:13px;font-weight:600;color:#1d6560";

/**
 * `siteOrigin` comes from the server page (`resolveSiteUrl()`), never from
 * `window.location`: a preview deployment must not hand out its own host in a
 * snippet that will live on someone's site for years.
 */
export function buildEmbedSnippet(
  result: CostResult,
  siteOrigin: string,
): string {
  const text = buildCardText(result);
  const href = `${siteOrigin}${CALCULATOR_PATH}?${serializeParams(result.inputs)}&${EMBED_UTM}`;

  return [
    `<a href="${escapeHtml(href)}" style="${CARD_STYLE}">`,
    `  <span style="${EYEBROW_STYLE}">${escapeHtml(text.eyebrow)}</span>`,
    `  <span style="${FIGURE_STYLE}">${escapeHtml(text.figure)}</span>`,
    `  <span style="${INPUTS_STYLE}">${escapeHtml(text.inputs)}</span>`,
    `  <span style="${CTA_STYLE}">${escapeHtml(text.cta)}</span>`,
    "</a>",
  ].join("\n");
}
