import { buildEmbedScript } from "../embed-script";

describe("buildEmbedScript", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("generates the canonical embed script with explicit API and WS URLs", () => {
    const script = buildEmbedScript({
      siteId: "site-123",
      siteToken: "site-token-abc",
      appUrl: "https://app.recopyfast.com",
      wsUrl: "https://ws.recopyfast.com",
    });

    expect(script).toContain(
      'src="https://app.recopyfast.com/embed/recopyfast.js"',
    );
    expect(script).toContain('data-site-id="site-123"');
    expect(script).toContain('data-site-token="site-token-abc"');
    expect(script).toContain('data-api-url="https://app.recopyfast.com/api"');
    expect(script).toContain('data-ws-url="https://ws.recopyfast.com"');
  });

  it("uses public environment defaults when URLs are not provided", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dashboard.example.com/";
    process.env.NEXT_PUBLIC_WS_URL = "wss://socket.example.com/";

    const script = buildEmbedScript({
      siteId: "site-123",
      siteToken: "site-token-abc",
    });

    expect(script).toContain(
      'src="https://dashboard.example.com/embed/recopyfast.js"',
    );
    expect(script).toContain(
      'data-api-url="https://dashboard.example.com/api"',
    );
    expect(script).toContain('data-ws-url="wss://socket.example.com"');
  });
});
