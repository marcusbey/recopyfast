"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  ArrowRight,
  Check,
  AlertTriangle,
  RefreshCw,
  Eye,
  FileText,
  ChevronDown,
  ChevronUp,
  History,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface StagingElement {
  id: string;
  elementId: string;
  selector: string;
  stagingContent: string | null;
  publishedContent: string | null;
  stagingUpdatedAt: string | null;
  metadata: Record<string, unknown> | null;
}

interface StagingDiffProps {
  siteId: string;
  onPublish?: (elementIds: string[]) => Promise<void>;
  canPublish?: boolean;
}

export function StagingDiff({
  siteId,
  onPublish,
  canPublish = false,
}: StagingDiffProps) {
  const [elements, setElements] = useState<StagingElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(
    new Set(),
  );
  const [expandedElements, setExpandedElements] = useState<Set<string>>(
    new Set(),
  );
  const [publishing, setPublishing] = useState(false);

  const fetchStagingChanges = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/staging/publish?siteId=${siteId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch staging changes");
      }

      setElements(data.elements || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchStagingChanges();
  }, [fetchStagingChanges]);

  const toggleElementSelection = (elementId: string) => {
    const newSelected = new Set(selectedElements);
    if (newSelected.has(elementId)) {
      newSelected.delete(elementId);
    } else {
      newSelected.add(elementId);
    }
    setSelectedElements(newSelected);
  };

  const toggleElementExpansion = (elementId: string) => {
    const newExpanded = new Set(expandedElements);
    if (newExpanded.has(elementId)) {
      newExpanded.delete(elementId);
    } else {
      newExpanded.add(elementId);
    }
    setExpandedElements(newExpanded);
  };

  const selectAll = () => {
    setSelectedElements(new Set(elements.map((e) => e.elementId)));
  };

  const deselectAll = () => {
    setSelectedElements(new Set());
  };

  const handlePublish = async () => {
    if (selectedElements.size === 0 || !onPublish) return;

    try {
      setPublishing(true);
      setError(null);

      await onPublish(Array.from(selectedElements));

      // Refresh the list after publishing
      await fetchStagingChanges();
      setSelectedElements(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  const truncateContent = (content: string | null, maxLength = 150) => {
    if (!content) return "(empty)";
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Unknown";
    return new Date(dateStr).toLocaleString();
  };

  const highlightDifferences = (
    oldText: string | null,
    newText: string | null,
  ) => {
    // Simple word-level diff visualization
    const oldWords = (oldText || "").split(/\s+/);
    const newWords = (newText || "").split(/\s+/);

    // Create a basic diff output
    const oldSet = new Set(oldWords);
    const newSet = new Set(newWords);

    const removed = oldWords.filter((w) => !newSet.has(w));
    const added = newWords.filter((w) => !oldSet.has(w));

    return { removed, added };
  };

  if (loading && elements.length === 0) {
    return (
      <Card className="p-8 text-center">
        <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-4 animate-spin" />
        <p className="text-muted-foreground">Loading staging changes...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Staging Changes</h2>
          <p className="text-muted-foreground">
            Review changes before publishing to live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={fetchStagingChanges}
            disabled={loading}
            size="sm"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert className="border-tone-danger-border bg-tone-danger-surface">
          <AlertTriangle className="h-4 w-4 text-tone-danger-text" />
          <div className="text-tone-danger-text">{error}</div>
        </Alert>
      )}

      {elements.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-tone-success-text mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            All caught up!
          </h3>
          <p className="text-muted-foreground">
            No pending staging changes to publish.
          </p>
        </Card>
      ) : (
        <>
          {/* Selection Controls */}
          <div className="flex items-center justify-between bg-surface-1 p-4 rounded-lg">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {selectedElements.size} of {elements.length} selected
              </span>
              <Button variant="link" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="link" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>

            {canPublish && onPublish && (
              <Button
                onClick={handlePublish}
                disabled={selectedElements.size === 0 || publishing}
                className="flex items-center gap-2"
              >
                {publishing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                Publish{" "}
                {selectedElements.size > 0 && `(${selectedElements.size})`}
              </Button>
            )}
          </div>

          {/* Changes List */}
          <div className="space-y-4">
            {elements.map((element) => {
              const isSelected = selectedElements.has(element.elementId);
              const isExpanded = expandedElements.has(element.elementId);
              const diff = highlightDifferences(
                element.publishedContent,
                element.stagingContent,
              );

              return (
                <Card
                  key={element.id}
                  className={`overflow-hidden ${isSelected ? "ring-2 ring-ring" : ""}`}
                >
                  {/* Header */}
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-surface-1"
                    onClick={() => toggleElementExpansion(element.elementId)}
                  >
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleElementSelection(element.elementId);
                        }}
                        className="w-4 h-4 rounded border-input"
                      />

                      <div>
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <code className="text-sm font-mono bg-surface-2 px-2 py-0.5 rounded">
                            {element.selector}
                          </code>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          ID: {element.elementId}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {element.stagingUpdatedAt && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <History className="w-3 h-3" />
                          {formatDate(element.stagingUpdatedAt)}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {diff.removed.length > 0 && (
                          <Badge className="bg-tone-danger-surface text-tone-danger-text">
                            -{diff.removed.length} words
                          </Badge>
                        )}
                        {diff.added.length > 0 && (
                          <Badge className="bg-tone-success-surface text-tone-success-text">
                            +{diff.added.length} words
                          </Badge>
                        )}
                      </div>

                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="border-t">
                      <div className="grid grid-cols-2 divide-x">
                        {/* Published Version */}
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Badge
                              variant="outline"
                              className="text-muted-foreground border-input"
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              Published
                            </Badge>
                          </div>
                          <div className="bg-surface-1 p-3 rounded text-sm whitespace-pre-wrap">
                            {element.publishedContent || (
                              <span className="text-muted-foreground italic">
                                (empty)
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Staging Version */}
                        <div className="p-4 bg-tone-info-surface/30">
                          <div className="flex items-center gap-2 mb-3">
                            <Badge className="bg-tone-info-surface text-tone-info-text">
                              <ArrowRight className="w-3 h-3 mr-1" />
                              Staging
                            </Badge>
                          </div>
                          <div className="bg-card p-3 rounded text-sm whitespace-pre-wrap border border-tone-info-border">
                            {element.stagingContent || (
                              <span className="text-muted-foreground italic">
                                (empty)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Actions */}
                      <div className="px-4 py-3 bg-surface-1 border-t flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleElementSelection(element.elementId);
                          }}
                        >
                          {isSelected ? (
                            <>
                              <XCircle className="w-3 h-3 mr-1" />
                              Deselect
                            </>
                          ) : (
                            <>
                              <Check className="w-3 h-3 mr-1" />
                              Select for Publishing
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Collapsed Preview */}
                  {!isExpanded && (
                    <div className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="text-muted-foreground truncate">
                          <span className="font-medium">Published:</span>{" "}
                          {truncateContent(element.publishedContent, 60)}
                        </div>
                        <div className="text-tone-info-text truncate">
                          <span className="font-medium">Staging:</span>{" "}
                          {truncateContent(element.stagingContent, 60)}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
