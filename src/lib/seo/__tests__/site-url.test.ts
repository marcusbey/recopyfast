import { resolveSiteUrl } from "../site-url";

const ORIGINAL_ENV = { ...process.env };

describe("resolveSiteUrl", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("prefers the configured public app URL and removes trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st///";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "preview.example.com";

    expect(resolveSiteUrl()).toBe("https://www.recopyfa.st");
  });

  it("adds HTTPS to a bare Vercel production hostname", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "recopyfast.example.com";

    expect(resolveSiteUrl()).toBe("https://recopyfast.example.com");
  });
});
