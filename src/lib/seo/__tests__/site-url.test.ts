import { resolveSiteUrl } from "../site-url";

describe("resolveSiteUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses the configured public URL before Vercel fallbacks", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st/";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "stable.vercel.app";
    process.env.VERCEL_URL = "preview.vercel.app";

    expect(resolveSiteUrl()).toBe("https://www.recopyfa.st");
  });

  it("uses the stable Vercel production URL before the deployment URL", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "stable.vercel.app";
    process.env.VERCEL_URL = "preview.vercel.app";

    expect(resolveSiteUrl()).toBe("https://stable.vercel.app");
  });

  it("accepts scheme-prefixed deployment URLs and falls back to localhost", () => {
    process.env.VERCEL_URL = "http://preview.local/";
    expect(resolveSiteUrl()).toBe("http://preview.local");

    delete process.env.VERCEL_URL;
    expect(resolveSiteUrl()).toBe("http://localhost:3000");
  });
});
