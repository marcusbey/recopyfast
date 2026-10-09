import nextConfig from "../../next.config";

/**
 * s79 (s69 L19) — HSTS covers subdomains, and every response says the same.
 *
 * Production answered with Vercel's custom-domain default,
 * `max-age=63072000`, which Vercel applies to the one host only. The app now
 * sets its own. It lives in `next.config.ts`'s catch-all block rather than the
 * middleware because the middleware matcher skips `_next/static`: a browser
 * keeps the LAST policy it received, so a static asset answering without
 * `includeSubDomains` would switch it off again. `preload` is deliberately
 * absent — it is a submission to browser vendors that cannot be quickly
 * undone, and nobody has decided to make it.
 */

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

async function catchAllHeader(key: string): Promise<string | undefined> {
  const blocks = (await nextConfig.headers?.()) ?? [];
  const catchAll = blocks.find((block) => block.source === "/(.*)");
  return catchAll?.headers.find(
    (header) => header.key.toLowerCase() === key.toLowerCase(),
  )?.value;
}

describe("Strict-Transport-Security", () => {
  it("is sent on every route, subdomains included", async () => {
    expect(await catchAllHeader("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("asks for at least a year and is not a preload submission", async () => {
    const value = (await catchAllHeader("Strict-Transport-Security")) ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(value)?.[1]);

    expect(maxAge).toBeGreaterThanOrEqual(ONE_YEAR_SECONDS);
    expect(value.toLowerCase()).not.toContain("preload");
  });

  it("is set in exactly one place", async () => {
    const blocks = (await nextConfig.headers?.()) ?? [];
    const setters = blocks.filter((block) =>
      block.headers.some(
        (header) => header.key.toLowerCase() === "strict-transport-security",
      ),
    );

    expect(setters.map((block) => block.source)).toEqual(["/(.*)"]);
  });
});
