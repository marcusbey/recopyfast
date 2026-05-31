"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FlaskConical, Loader2 } from "lucide-react";

interface ABTestConfigFormProps {
  minSampleSize: number;
  onMinSampleSizeChange: (value: number) => void;
  confidenceThreshold: number;
  onConfidenceThresholdChange: (value: number) => void;
  autoComplete: boolean;
  onAutoCompleteChange: (value: boolean) => void;
  activating: boolean;
  onActivate: () => void;
  onBack: () => void;
}

export function ABTestConfigForm({
  minSampleSize,
  onMinSampleSizeChange,
  confidenceThreshold,
  onConfidenceThresholdChange,
  autoComplete,
  onAutoCompleteChange,
  activating,
  onActivate,
  onBack,
}: ABTestConfigFormProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Minimum Sample Size
            </label>
            <input
              type="number"
              className="w-full rounded border p-2 text-sm"
              value={minSampleSize}
              onChange={(e) =>
                onMinSampleSizeChange(parseInt(e.target.value) || 100)
              }
              min={30}
            />
            <p className="mt-1 text-xs text-gray-500">
              Minimum views per variant before declaring a winner
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Confidence Threshold
            </label>
            <select
              className="w-full rounded border p-2 text-sm"
              value={confidenceThreshold}
              onChange={(e) =>
                onConfidenceThresholdChange(parseFloat(e.target.value))
              }
            >
              <option value={0.9}>90%</option>
              <option value={0.95}>95% (Recommended)</option>
              <option value={0.99}>99%</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="auto-complete"
              checked={autoComplete}
              onChange={(e) => onAutoCompleteChange(e.target.checked)}
            />
            <label htmlFor="auto-complete" className="text-sm">
              Auto-complete when significance is reached
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onActivate} disabled={activating}>
          {activating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="mr-1 h-4 w-4" />
          )}
          Activate Test
        </Button>
      </div>
    </div>
  );
}
