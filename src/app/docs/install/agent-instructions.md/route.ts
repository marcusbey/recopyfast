import { AGENT_INSTALLATION_INSTRUCTIONS } from "@/lib/docs/installation-content";

export function GET() {
  return new Response(AGENT_INSTALLATION_INSTRUCTIONS, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="recopyfast-agent-installation.md"',
    },
  });
}
