"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, Loader2, AlertCircle, FileText } from "lucide-react";
import type { MappedContentElement } from "@/hooks/useContentElements";

interface ABTestElementPickerProps {
  elements: MappedContentElement[];
  selectedElement: string | null;
  loading?: boolean;
  error?: string | null;
  onSelect: (elementId: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onRetry?: () => void;
}

export function ABTestElementPicker({
  elements,
  selectedElement,
  loading = false,
  error = null,
  onSelect,
  onGenerate,
  onCancel,
  onRetry,
}: ABTestElementPickerProps) {
  const hasElements = elements.length > 0;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Select the copy element you want to test:
      </p>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading content elements...
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="rounded-lg border border-tone-danger-border bg-tone-danger-surface p-4 text-center"
        >
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-tone-danger-text" />
          <p className="text-sm text-tone-danger-text">{error}</p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
        </div>
      )}

      {/* Without this the step renders an empty box and the wizard looks broken
          rather than simply having nothing to offer yet. */}
      {!loading && !error && !hasElements && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            No content elements yet
          </h3>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Install the ReCopyFast script on this site and load a page. The
            widget registers editable elements automatically, and they will
            appear here.
          </p>
        </div>
      )}

      {!loading && !error && hasElements && (
        // radiogroup semantics: exactly one element can be under test at a
        // time, and the list must be reachable without a mouse.
        <div
          role="radiogroup"
          aria-label="Content elements available for testing"
          className="max-h-96 space-y-2 overflow-y-auto"
        >
          {elements.map((el) => {
            const isDisabled = el.hasActiveTest;
            const isSelected = selectedElement === el.elementId;
            const select = () => {
              if (!isDisabled) onSelect(el.elementId);
            };

            return (
              <Card
                key={el.elementId}
                role="radio"
                aria-checked={isSelected}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : 0}
                className={`transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isDisabled
                    ? "cursor-not-allowed opacity-60"
                    : isSelected
                      ? "cursor-pointer border-primary bg-tone-info-surface"
                      : "cursor-pointer hover:bg-surface-1"
                }`}
                onClick={select}
                onKeyDown={(event) => {
                  // Space and Enter are the expected activation keys for a
                  // radio; Space would otherwise scroll the list.
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    select();
                  }
                }}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs">
                          {el.type}
                        </Badge>
                        {isDisabled && (
                          <Badge className="bg-tone-warning-surface text-xs text-tone-warning-text">
                            Active test running
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-sm">{el.content}</p>
                    </div>
                    {isSelected && !isDisabled && (
                      <Check className="mt-1 h-4 w-4 shrink-0 text-tone-info-text" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!selectedElement} onClick={onGenerate}>
          <Sparkles className="mr-1 h-4 w-4" />
          Generate Variants
        </Button>
      </div>
    </div>
  );
}
