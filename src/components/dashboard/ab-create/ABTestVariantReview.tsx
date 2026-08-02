"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Edit } from "lucide-react";
import type { GeneratedVariant } from "@/hooks/useABTestCreation";

interface ABTestVariantReviewProps {
  selectedContent: string;
  variants: GeneratedVariant[];
  rationales: Array<{ name: string; rationale: string }>;
  editingIndex: number | null;
  editContent: string;
  onEditContentChange: (value: string) => void;
  onStartEditing: (index: number) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onBack: () => void;
  onNext: () => void;
}

export function ABTestVariantReview({
  selectedContent,
  variants,
  rationales,
  editingIndex,
  editContent,
  onEditContentChange,
  onStartEditing,
  onSaveEdit,
  onCancelEdit,
  onBack,
  onNext,
}: ABTestVariantReviewProps) {
  return (
    <div className="space-y-4">
      {/* Original (control) */}
      <Card className="border-input">
        <CardContent className="p-4">
          <div className="mb-1 flex items-center gap-2">
            <Badge className="bg-surface-2 text-foreground">
              Control (Original)
            </Badge>
          </div>
          <p className="text-sm">{selectedContent}</p>
        </CardContent>
      </Card>

      {/* AI variants */}
      {variants.map((variant, index) => {
        const rationale = rationales.find((r) => r.name === variant.name);
        return (
          <Card key={index} className="border-tone-info-border">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <Badge className="bg-tone-info-surface text-tone-info-text">
                  {variant.name}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${variant.name}`}
                  onClick={() => onStartEditing(index)}
                >
                  <Edit className="h-3 w-3" />
                </Button>
              </div>
              {editingIndex === index ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded border p-2 text-sm"
                    value={editContent}
                    onChange={(e) => onEditContentChange(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={onSaveEdit}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={onCancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm">{variant.content}</p>
              )}
              {rationale && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {rationale.rationale}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext}>
          Configure Test
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
