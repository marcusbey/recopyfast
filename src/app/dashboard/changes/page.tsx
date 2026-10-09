import { ChangesView } from "@/components/dashboard/changes/ChangesView";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Changes (s70b): what changed on the owner's sites, page by page.
 *
 * This was the Content page at /dashboard/content, which listed every string
 * the embed had ever discovered as a tall card titled with its element id and
 * CSS selector, after waiting on GET /api/sites and downloading every row of
 * every site. The owner's verdict: "what is the content page about ??"
 * (2026-10-08). The old URL redirects here (next.config.ts, 308).
 *
 * A server component: the view below is the client part, and it reads only
 * GET /api/content/changes.
 */
export default function ChangesPage() {
  return (
    <PageShell
      title="Changes"
      description="What changed on your sites, page by page."
    >
      <ChangesView />
    </PageShell>
  );
}
