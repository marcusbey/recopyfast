import nextConfig from "../../../next.config";

describe("the public try runtime response", () => {
  it("is delivered as cacheable cross-origin JavaScript with nosniff", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const runtime = rules.find((rule) => rule.source === "/try/rcf-try.js");

    expect(runtime).toBeDefined();
    expect(runtime?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ]),
    );
  });
});
