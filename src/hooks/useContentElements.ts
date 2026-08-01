"use client";

import { useState, useEffect, useCallback } from "react";

interface ContentElementRaw {
  id: string;
  element_id: string;
  original_content: string;
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

  const fetchElements = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const [contentRes, testsRes] = await Promise.all([
        fetch(`/api/content/${siteId}`),
        fetch(`/api/ab-tests?siteId=${siteId}`),
      ]);

      const data = contentRes.ok ? await contentRes.json() : [];
      const tests = testsRes.ok ? await testsRes.json() : [];

      const activeElementIds = new Set(
        (Array.isArray(tests) ? tests : [])
          .filter(
            (t: { status: string }) =>
              t.status === "active" || t.status === "running",
          )
          .map((t: { target_element_id?: string }) => t.target_element_id)
          .filter(Boolean),
      );

      const mapped = (Array.isArray(data) ? data : []).map(
        (el: ContentElementRaw) => ({
          elementId: el.element_id,
          content: el.original_content,
          type: el.metadata?.type || "text",
          hasActiveTest: activeElementIds.has(el.element_id),
        }),
      );
      setElements(mapped);
    } catch (error) {
      console.error("Error fetching content elements:", error);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchElements();
  }, [fetchElements]);

  return { elements, setElements, loading, refetch: fetchElements };
}
