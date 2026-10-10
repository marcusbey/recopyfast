import { GET } from "@/app/docs/install/agent-instructions.md/route";
import { AGENT_INSTALLATION_INSTRUCTIONS } from "@/lib/docs/installation-content";

describe("GET /docs/install/agent-instructions.md", () => {
  it("downloads the exact brief shown and copied on the guide", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="recopyfast-agent-installation.md"',
    );
    expect(await response.text()).toBe(AGENT_INSTALLATION_INSTRUCTIONS);
  });
});
