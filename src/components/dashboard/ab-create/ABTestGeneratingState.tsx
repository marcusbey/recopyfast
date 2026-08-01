"use client";

import { Loader2 } from "lucide-react";

export function ABTestGeneratingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader2 className="mb-3 h-8 w-8 animate-spin text-tone-info-text" />
      <p className="text-sm font-medium">AI is generating copy variants...</p>
      <p className="text-xs text-muted-foreground">
        Creating conversion-optimized alternatives
      </p>
    </div>
  );
}
