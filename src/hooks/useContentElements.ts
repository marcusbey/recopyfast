"use client";

import { useState, useEffect, useCallback } from "react";

interface ContentElementRaw {
  id: string;
  element_id: string;
  original_content: string;
  current_content?: string;
  metadata?: { type?: string };
}

export interface MappedContentElement {
  elementId: string;
  content: string;
  type: string;
  hasActiveTest?: boolean;
}

export function useContentElements(siteId: string) {
  const [elements, setElements] = useState<MappedContentElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchElements = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError(null);
    try {
      // The dashboard is a first-party session caller, so it reads through the
      // permission-gated site route. /api/content/{siteId} requires a site token
      // and would always 401 here.
      const [contentRes, testsRes] = await Promise.all([
        fetch(`/api/sites/${siteId}/content-elements`),
        fetch(`/api/ab-tests?siteId=${siteId}`),
      ]);

      if (!contentRes.ok) {
        throw new Error(
          `Failed to load content elements (${contentRes.status})`,
        );
      }

      const data: { elements?: ContentElementRaw[] } = await contentRes.json();

      // A failed A/B lookup must not block element selection — it only decides
      // which rows are greyed out as already under test.
      const tests: unknown = testsRes.ok ? await testsRes.json() : [];

      const activeElementIds = new Set(
        (Array.isArray(tests) ? tests : [])
          .filter(
            (t: { status: string }) =>
              t.status === "active" || t.status === "running",
          )
          .map((t: { target_element_id?: string }) => t.target_element_id)
          .filter(Boolean),
      );

      const mapped = (data.elements ?? []).map((el) => ({
        elementId: el.element_id,
        content: el.current_content || el.original_content,
        type: el.metadata?.type || "text",
        hasActiveTest: activeElementIds.has(el.element_id),
      }));
      setElements(mapped);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load content elements",
      );
      setElements([]);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchElements();
  }, [fetchElements]);

  return { elements, setElements, loading, error, refetch: fetchElements };
}
