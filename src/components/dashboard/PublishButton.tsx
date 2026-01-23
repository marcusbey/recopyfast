"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowUpCircle,
  RefreshCw,
  Check,
  AlertTriangle,
  Clock,
} from "lucide-react";

interface PublishButtonProps {
  siteId: string;
  onPublishComplete?: () => void;
  variant?: "default" | "compact";
}

export function PublishButton({
  siteId,
  onPublishComplete,
  variant = "default",
}: PublishButtonProps) {
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [lastPublished, setLastPublished] = useState<string | null>(null);

  const fetchPendingCount = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/staging/publish?siteId=${siteId}`);
      const data = await response.json();

      if (response.ok) {
        setPendingCount(data.pendingChanges || 0);
      }
    } catch {
      // Silently fail - don't show error for count fetch
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchPendingCount();
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchPendingCount, 30000);
    return () => clearInterval(interval);
  }, [fetchPendingCount]);

  const handlePublish = async () => {
    if (pendingCount === 0) return;

    try {
      setPublishing(true);
      setError(null);
      setSuccess(false);

      const response = await fetch("/api/staging/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to publish");
      }

      setSuccess(true);
      setLastPublished(data.publishedAt);
      setPendingCount(0);

      onPublishComplete?.();

      // Reset success state after 3 seconds
      setTimeout(() => setSuccess(false), 3000);

      // Refresh count
      await fetchPendingCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
      setTimeout(() => setError(null), 5000);
    } finally {
      setPublishing(false);
    }
  };

  if (variant === "compact") {
    return (
      <Button
        onClick={handlePublish}
        disabled={pendingCount === 0 || publishing}
        variant={pendingCount > 0 ? "default" : "outline"}
        size="sm"
        className="relative"
      >
        {publishing ? (
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
        ) : success ? (
          <Check className="w-4 h-4 mr-2 text-green-500" />
        ) : (
          <ArrowUpCircle className="w-4 h-4 mr-2" />
        )}
        Publish
        {pendingCount > 0 && (
          <Badge className="ml-2 bg-orange-500 text-white text-xs px-1.5 py-0">
            {pendingCount}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handlePublish}
        disabled={pendingCount === 0 || publishing}
        variant={pendingCount > 0 ? "default" : "outline"}
        className="w-full flex items-center justify-center gap-2"
        size="lg"
      >
        {publishing ? (
          <>
            <RefreshCw className="w-5 h-5 animate-spin" />
            Publishing...
          </>
        ) : success ? (
          <>
            <Check className="w-5 h-5 text-green-500" />
            Published!
          </>
        ) : (
          <>
            <ArrowUpCircle className="w-5 h-5" />
            Publish to Live
            {pendingCount > 0 && (
              <Badge className="ml-2 bg-orange-500 text-white">
                {pendingCount} change{pendingCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </>
        )}
      </Button>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {lastPublished && !error && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          Last published: {new Date(lastPublished).toLocaleString()}
        </div>
      )}

      {pendingCount === 0 && !loading && !success && (
        <p className="text-sm text-gray-500 text-center">
          No pending changes to publish
        </p>
      )}
    </div>
  );
}
