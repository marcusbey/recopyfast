"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, FileText, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import type { Version } from "./VersionTimelineItem";

interface ContentElement {
  element_id: string;
  selector: string;
  current_content: string;
  original_content: string;
  metadata?: {
    type?: string;
  };
}

interface VersionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: Version | null;
  stagingToken: string;
  onRestore: (version: Version) => Promise<void>;
}

export function VersionPreviewDialog({
  open,
  onOpenChange,
  version,
  stagingToken,
  onRestore,
}: VersionPreviewDialogProps) {
  const [snapshot, setSnapshot] = useState<ContentElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVersionDetail = async () => {
      if (!open || !version) return;

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/edit-board/history/${version.id}?rcf_token=${stagingToken}`,
        );
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch version");
        }

        setSnapshot(data.version?.snapshot || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load version");
      } finally {
        setLoading(false);
      }
    };

    fetchVersionDetail();
  }, [open, version, stagingToken]);

  const handleRestore = async () => {
    if (!version) return;

    try {
      setRestoring(true);
      await onRestore(version);
      onOpenChange(false);
      setShowConfirm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to restore version",
      );
    } finally {
      setRestoring(false);
    }
  };

  if (!version) return null;

  const createdDate = new Date(version.createdAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Version {version.versionNumber} Preview
          </DialogTitle>
          <DialogDescription>
            {format(createdDate, "MMMM d, yyyy")} at{" "}
            {format(createdDate, "h:mm a")} by {version.createdBy}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg border border-tone-danger-border bg-tone-danger-surface text-tone-danger-text text-sm">
              {error}
            </div>
          ) : (
            <>
              {/* Version Info */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="bg-surface-1">
                  <FileText className="w-3 h-3 mr-1" />
                  {snapshot.length} elements in this snapshot
                </Badge>
                {version.description && (
                  <span className="text-sm text-muted-foreground italic">
                    &ldquo;{version.description}&rdquo;
                  </span>
                )}
              </div>

              {/* Content Elements Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {snapshot.map((element) => (
                  <div
                    key={element.element_id}
                    className="bg-surface-1 rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs text-muted-foreground truncate">
                        {element.element_id}
                      </span>
                      {element.metadata?.type && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-card border-border"
                        >
                          {element.metadata.type}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-foreground line-clamp-3">
                      {element.current_content || element.original_content}
                    </p>
                  </div>
                ))}
              </div>

              {snapshot.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No content elements in this snapshot
                </div>
              )}

              {/* Restore Confirmation */}
              {showConfirm ? (
                <div className="bg-tone-warning-surface border border-tone-warning-border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-tone-warning-text flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-medium text-tone-warning-text">
                        Confirm Restore
                      </h4>
                      <p className="text-sm text-tone-warning-text mt-1">
                        This will replace all current staging content with the
                        content from version {version.versionNumber}. This
                        action can be undone by restoring another version.
                      </p>
                      <div className="flex items-center gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowConfirm(false)}
                          disabled={restoring}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleRestore}
                          disabled={restoring}
                          className="bg-warning text-warning-foreground hover:bg-warning/90"
                        >
                          {restoring ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Restoring...
                            </>
                          ) : (
                            <>
                              <RotateCcw className="w-4 h-4 mr-2" />
                              Yes, Restore
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                  <Button onClick={() => setShowConfirm(true)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restore This Version
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
