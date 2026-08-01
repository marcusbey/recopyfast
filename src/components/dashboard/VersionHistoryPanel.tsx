"use client";

import { useState, useEffect, useCallback, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X, Loader2, History, ChevronDown } from "lucide-react";
import { VersionTimelineItem, type Version } from "./VersionTimelineItem";
import { VersionPreviewDialog } from "./VersionPreviewDialog";

interface VersionHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  siteId: string;
  stagingToken: string;
}

export function VersionHistoryPanel({
  open,
  onClose,
  siteId,
  stagingToken,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const LIMIT = 20;

  const fetchVersions = useCallback(
    async (newOffset: number = 0, append: boolean = false) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const res = await fetch(
          `/api/edit-board/history?siteId=${siteId}&limit=${LIMIT}&offset=${newOffset}&rcf_token=${stagingToken}`,
        );
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch versions");
        }

        const mappedVersions: Version[] = (data.versions || []).map(
          (v: Record<string, unknown>) => ({
            id: v.id as string,
            versionNumber: v.version_number as number,
            createdBy: v.created_by as string,
            description: v.description as string | null,
            elementsChanged: v.elements_changed as number,
            changeType: v.change_type as Version["changeType"],
            createdAt: v.created_at as string,
          }),
        );

        if (append) {
          setVersions((prev) => [...prev, ...mappedVersions]);
        } else {
          setVersions(mappedVersions);
        }

        setHasMore(data.hasMore || false);
        setOffset(newOffset);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load versions",
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [siteId, stagingToken],
  );

  useEffect(() => {
    if (open) {
      setOffset(0);
      fetchVersions(0, false);
    }
  }, [open, fetchVersions]);

  // The panel is a modal drawer, so it owes keyboard users an Escape route and
  // a sensible starting focus — neither of which came for free here the way
  // they do from the Radix Dialog used elsewhere.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleLoadMore = () => {
    fetchVersions(offset + LIMIT, true);
  };

  const handleRestore = async (version: Version) => {
    const res = await fetch(`/api/edit-board/history/${version.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${stagingToken}`,
      },
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to restore version");
    }

    // Refresh versions list after restore
    await fetchVersions(0, false);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop — Escape provides the keyboard equivalent of clicking it. */}
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-card shadow-2xl duration-300 animate-in slide-in-from-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <History
              className="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 id={titleId} className="font-semibold text-foreground">
              Version History
            </h2>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Close version history</span>
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg border border-tone-danger-border bg-tone-danger-surface text-tone-danger-text text-sm">
              {error}
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <History className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-foreground mb-2">
                No version history yet
              </h3>
              <p className="text-sm text-muted-foreground">
                Version history will appear here as you make changes to your
                content.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {versions.map((version, index) => (
                <VersionTimelineItem
                  key={version.id}
                  version={version}
                  isFirst={index === 0}
                  isLast={index === versions.length - 1 && !hasMore}
                  onView={setPreviewVersion}
                  onRestore={
                    index > 0 ? () => setPreviewVersion(version) : undefined
                  }
                />
              ))}

              {hasMore && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        Load More
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Version Preview Dialog */}
      <VersionPreviewDialog
        open={!!previewVersion}
        onOpenChange={(open) => !open && setPreviewVersion(null)}
        version={previewVersion}
        stagingToken={stagingToken}
        onRestore={handleRestore}
      />
    </>
  );
}
