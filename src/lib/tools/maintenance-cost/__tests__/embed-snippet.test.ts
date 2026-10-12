import { DEFAULT_INPUTS, calculateCost } from "../calculate";
import { buildCardText, buildEmbedSnippet, escapeHtml } from "../embed-snippet";

const ORIGIN = "https://recopyfa.st";
const result = calculateCost(DEFAULT_INPUTS);

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("buildEmbedSnippet", () => {
  it("builds the exact markup for the defaults", () => {
    expect(buildEmbedSnippet(result, ORIGIN)).toBe(
      [
        '<a href="https://recopyfa.st/tools/website-maintenance-cost?sites=10&amp;changes=2&amp;minutes=20&amp;rate=60&amp;billed=0&amp;currency=USD&amp;utm_source=embed&amp;utm_medium=card&amp;utm_campaign=free_tools" style="display:block;box-sizing:border-box;max-width:360px;padding:16px 20px;border:1px solid #cbd5d9;border-radius:12px;background:#ffffff;color:#14191c;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.4;text-decoration:none">',
        '  <span style="display:block;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#4d5b61">Free copy changes cost us</span>',
        '  <span style="display:block;margin:4px 0;font-size:32px;font-weight:700;color:#14191c">$4,800 a year</span>',
        '  <span style="display:block;font-size:13px;color:#4d5b61">10 sites × 2 changes a month × 20 minutes at $60 an hour, 0% billed</span>',
        '  <span style="display:block;margin-top:10px;font-size:13px;font-weight:600;color:#1d6560">Calculate yours · ReCopyFast</span>',
        "</a>",
      ].join("\n"),
    );
  });

  it("is inert: no script, style element, class, event attribute or javascript: URL", () => {
    const html = buildEmbedSnippet(result, ORIGIN);

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sclass=/i);
    expect(html).not.toMatch(/\son\w+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<(iframe|img|link|form)/i);
  });

  it("holds exactly one anchor, pointing at the calculator with the embed UTMs", () => {
    const doc = parse(buildEmbedSnippet(result, ORIGIN));
    const anchors = doc.querySelectorAll("a");

    expect(anchors).toHaveLength(1);
    const href = new URL(anchors[0].getAttribute("href") ?? "");
    expect(href.origin).toBe(ORIGIN);
    expect(href.pathname).toBe("/tools/website-maintenance-cost");
    expect(href.searchParams.get("sites")).toBe("10");
    expect(href.searchParams.get("currency")).toBe("USD");
    expect(href.searchParams.get("utm_source")).toBe("embed");
    expect(href.searchParams.get("utm_medium")).toBe("card");
    expect(href.searchParams.get("utm_campaign")).toBe("free_tools");
  });

  it("takes the origin from its argument", () => {
    const html = buildEmbedSnippet(result, "https://example.test");

    expect(html).toContain('href="https://example.test/tools/');
    expect(html).not.toContain("recopyfa.st");
  });

  it("escapes hostile text in every interpolated field", () => {
    const hostile = {
      ...result,
      inputs: { ...result.inputs, currency: '"><script>alert(1)</script>' },
      formatted: {
        hoursMonthly: "<b>1</b>",
        unbilledHoursMonthly: "<b>1</b>",
        unbilledMonthly: "<img src=x onerror=alert(1)>",
        unbilledYearly: '"><script>alert(1)</script>',
        hourlyRate: "'&<>",
      },
    } as never;

    const html = buildEmbedSnippet(hostile, ORIGIN);
    const doc = parse(html);

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(doc.querySelectorAll("script, img, b")).toHaveLength(0);
    expect(doc.querySelectorAll("a")).toHaveLength(1);
    expect(doc.body.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("buildCardText", () => {
  it("returns the four lines the snippet and the preview share", () => {
    expect(buildCardText(result)).toEqual({
      eyebrow: "Free copy changes cost us",
      figure: "$4,800 a year",
      inputs:
        "10 sites × 2 changes a month × 20 minutes at $60 an hour, 0% billed",
      cta: "Calculate yours · ReCopyFast",
    });
  });

  it("is the text content of the snippet, in order", () => {
    const doc = parse(buildEmbedSnippet(result, ORIGIN));
    const spans = Array.from(doc.querySelectorAll("a > span"), (node) =>
      node.textContent?.trim(),
    );

    expect(spans).toEqual(Object.values(buildCardText(result)));
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
