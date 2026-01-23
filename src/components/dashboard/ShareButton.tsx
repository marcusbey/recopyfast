"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { ShareSiteDialog } from "./ShareSiteDialog";
import type { Site } from "@/types";

interface ShareButtonProps {
  site: Site;
  variant?: "icon" | "default";
  className?: string;
}

export function ShareButton({
  site,
  variant = "icon",
  className,
}: ShareButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDialogOpen(true)}
          className={className}
          title="Share preview link"
        >
          <Share2 className="w-4 h-4" />
          <span className="sr-only">Share</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className={className}
        >
          <Share2 className="w-4 h-4 mr-2" />
          Share
        </Button>
      )}

      <ShareSiteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        site={site}
      />
    </>
  );
}
