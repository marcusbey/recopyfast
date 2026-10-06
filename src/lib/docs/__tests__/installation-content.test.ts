import { buildEmbedScript } from "@/lib/sites/embed-script";
import {
  AGENT_INSTALLATION_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_DOWNLOAD_PATH,
  INSTALLATION_EXAMPLE,
  INSTALLATION_GUIDE,
} from "@/lib/docs/installation-content";

describe("installation documentation content", () => {
  it("builds the public example through the real snippet builder", () => {
    expect(INSTALLATION_EXAMPLE.snippet).toBe(
      buildEmbedScript({
        siteId: INSTALLATION_EXAMPLE.siteId,
        siteToken: INSTALLATION_EXAMPLE.siteToken,
        appUrl: INSTALLATION_EXAMPLE.appUrl,
        wsUrl: INSTALLATION_EXAMPLE.wsUrl,
      }),
    );
    expect(INSTALLATION_EXAMPLE.snippet).toContain(
      'data-site-id="YOUR_SITE_ID"',
    );
    expect(INSTALLATION_EXAMPLE.snippet).toContain(
      'data-site-token="YOUR_SITE_TOKEN"',
    );
    expect(INSTALLATION_EXAMPLE.snippet).toContain(
      'data-api-url="https://www.recopyfa.st/api"',
    );
  });

  it("formats the generated tag one attribute per line for reading", () => {
    const lines = INSTALLATION_EXAMPLE.displaySnippet.split("\n");

    expect(lines[0]).toBe("<script");
    expect(lines.at(-1)).toBe("></script>");
    expect(
      lines.filter((line) => line.trimStart().startsWith("data-")),
    ).toHaveLength(4);
    expect(INSTALLATION_EXAMPLE.displaySnippet).toContain(
      '  src="https://www.recopyfa.st/embed/recopyfast.js"',
    );
  });

  it("explains that realtime is optional without changing the generated tag", () => {
    const webSocketPart = INSTALLATION_GUIDE.copySnippet.snippetParts.find(
      (part) => part.attribute === "data-ws-url",
    );

    expect(webSocketPart?.purpose).toMatch(/some deployments omit it/i);
    expect(webSocketPart?.purpose).toMatch(
      /preserve what the dashboard generated/i,
    );
  });

  it("keeps the approved SPA and analytics constraints in both handoff formats", () => {
    const guideText = JSON.stringify(INSTALLATION_GUIDE);

    for (const requiredText of [
      "after the page has hydrated",
      "does not provide a complete lifecycle",
      "rcf_handoff",
      "A Referrer-Policy header alone",
    ]) {
      expect(guideText).toContain(requiredText);
    }

    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain(
      "inspect hydration and navigation first",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain(
      "no complete SPA teardown/reinitialization contract",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain("rcf_handoff");
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain(
      "A referrer header alone is insufficient",
    );
  });

  it("states that snippet installation does not guarantee a zero-flash first paint", () => {
    expect(INSTALLATION_GUIDE.install.renderingTitle).toBe(
      "Rendering at first paint",
    );
    expect(INSTALLATION_GUIDE.install.renderingGuidance).toContain(
      "after the widget starts and fetches published content",
    );
    expect(INSTALLATION_GUIDE.install.renderingGuidance).toContain(
      "does not guarantee zero-flash initial rendering",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain(
      "Do not claim zero-flash rendering or seamless SSR",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain("critical hero copy");
  });

  it("documents the invited-editor email-code flow without promising a magic link", () => {
    expect(INSTALLATION_GUIDE.invite.steps.join(" ")).toMatch(/emailed code/i);
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain(
      "six-digit emailed sign-in code",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).not.toMatch(/\bmagic link\b/i);
  });

  it("publishes one stable Markdown download path and no live credentials", () => {
    expect(AGENT_INSTRUCTIONS_DOWNLOAD_PATH).toBe(
      "/docs/install/agent-instructions.md",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).toContain(
      "[paste complete script tag]",
    );
    expect(AGENT_INSTALLATION_INSTRUCTIONS).not.toMatch(
      /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/,
    );
  });
});
