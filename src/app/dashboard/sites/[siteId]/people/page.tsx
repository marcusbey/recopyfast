"use client";

import { useId, useState } from "react";
import { Link2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { PageShell } from "@/components/ui/page-shell";
import {
  ADD_EDITOR_EXPLAINER,
  AddEditorDialog,
} from "@/components/dashboard/AddEditorDialog";
import { PreviewLinksList } from "@/components/dashboard/PreviewLinksList";
import {
  SHARE_PREVIEW_EXPLAINER,
  ShareSiteDialog,
} from "@/components/dashboard/ShareSiteDialog";
import { SiteEditorsCard } from "@/components/dashboard/SiteEditorsCard";
import { useSiteContext } from "@/components/dashboard/site/SiteProvider";
import { useSitePageShell } from "@/components/dashboard/site/useSitePageShell";

/**
 * People & access: exactly two ways to give someone access, each with the one
 * line that says when to use it, then the two lists they add to (s66c1 AC 6).
 *
 * The owner, 2026-10-07: "invite a client, and editors are confusing. which
 * one to use and when?" Two mechanisms wore three labels ("Add editor",
 * "Invite a client", "Share preview link") over field-for-field identical
 * forms, and nothing on screen said one is permanent and the other expires.
 * The explainers are the owner's approved copy (AC 6), verbatim.
 */
export default function SitePeoplePage() {
  const { shell, editWebsiteAlert } = useSitePageShell();
  const { site, isAdmin } = useSiteContext();
  const [isAddEditorOpen, setIsAddEditorOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [editorsReload, setEditorsReload] = useState(0);
  const [linksReload, setLinksReload] = useState(0);

  return (
    <PageShell {...shell}>
      {editWebsiteAlert}
      <section aria-label="Give someone access" className="space-y-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AccessOption
            icon={<UserPlus />}
            eyebrow="Ongoing access"
            explainer={ADD_EDITOR_EXPLAINER}
            action={
              <Button
                disabled={!isAdmin}
                onClick={() => setIsAddEditorOpen(true)}
              >
                Add editor
              </Button>
            }
          />
          <AccessOption
            icon={<Link2 />}
            eyebrow="One-off review"
            explainer={SHARE_PREVIEW_EXPLAINER}
            action={
              <Button
                variant="outline"
                disabled={!isAdmin}
                onClick={() => setIsShareOpen(true)}
              >
                Share preview link
              </Button>
            }
          />
        </div>
        {/* `GET /api/sites` mints install credentials for admins only, and
            both actions are admin-only on the server: a member who is not an
            admin is told why, rather than handed a form that will 403. */}
        {!isAdmin && (
          <p className="text-sm text-muted-foreground">
            Only this site&apos;s admins can give access.
          </p>
        )}
      </section>

      <SiteEditorsCard
        siteId={site.id}
        siteName={site.name}
        reloadKey={editorsReload}
      />

      <PreviewLinksList
        siteId={site.id}
        domain={site.domain}
        reloadKey={linksReload}
      />

      <AddEditorDialog
        open={isAddEditorOpen}
        onOpenChange={setIsAddEditorOpen}
        siteId={site.id}
        siteName={site.name}
        onAdded={() => setEditorsReload((count) => count + 1)}
      />
      <ShareSiteDialog
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        site={site}
        onCreated={() => setLinksReload((count) => count + 1)}
      />
    </PageShell>
  );
}

interface AccessOptionProps {
  icon: React.ReactNode;
  eyebrow: string;
  explainer: string;
  action: React.ReactNode;
}

/**
 * One way to give access: its eyebrow, the one line that says when to use
 * it, and its one button. The block is a group named by its eyebrow, so a
 * screen reader entering it hears "Ongoing access" before the button, and
 * the line and the button cannot drift into different blocks unnoticed
 * (s66c1 review m1: swapping the two explainers left every test green).
 */
function AccessOption({ icon, eyebrow, explainer, action }: AccessOptionProps) {
  const eyebrowId = useId();
  return (
    <Card
      role="group"
      aria-labelledby={eyebrowId}
      className="flex flex-col gap-3 p-4 sm:px-6 sm:py-5"
    >
      <div className="flex items-center gap-3">
        <IconTile>{icon}</IconTile>
        <p id={eyebrowId} className="text-eyebrow">
          {eyebrow}
        </p>
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{explainer}</p>
      <div>{action}</div>
    </Card>
  );
}
