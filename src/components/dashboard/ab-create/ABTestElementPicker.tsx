"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check } from "lucide-react";
import type { MappedContentElement } from "@/hooks/useContentElements";

interface ABTestElementPickerProps {
  elements: MappedContentElement[];
  selectedElement: string | null;
  onSelect: (elementId: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
}

export function ABTestElementPicker({
  elements,
  selectedElement,
  onSelect,
  onGenerate,
  onCancel,
}: ABTestElementPickerProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Select the copy element you want to test:
      </p>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {elements.map((el) => {
          const isDisabled = el.hasActiveTest;
          return (
            <Card
              key={el.elementId}
              className={`transition-colors ${
                isDisabled
                  ? "cursor-not-allowed opacity-60"
                  : selectedElement === el.elementId
                    ? "cursor-pointer border-primary bg-tone-info-surface"
                    : "cursor-pointer hover:bg-surface-1"
              }`}
              onClick={() => {
                if (!isDisabled) onSelect(el.elementId);
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
                  {selectedElement === el.elementId && !isDisabled && (
                    <Check className="mt-1 h-4 w-4 shrink-0 text-tone-info-text" />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
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
