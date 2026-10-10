import { SiteProvider } from "@/components/dashboard/site/SiteProvider";

/**
 * Every page under `/dashboard/sites/<id>` shares one site record (ADR 052).
 *
 * `key={siteId}` is the guard against a credential crossing sites: moving
 * from one site to another remounts the provider, so site A's snippet and
 * token cannot survive into site B's pages, whatever the router decides to
 * keep mounted for a shared segment.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;

  return (
    <SiteProvider key={siteId} siteId={siteId}>
      {children}
    </SiteProvider>
  );
}
