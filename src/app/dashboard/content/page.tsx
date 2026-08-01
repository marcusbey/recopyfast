"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  ContentElementCard,
  getContentStatus,
  type ContentElement,
} from "@/components/dashboard/ContentElementCard";
import { ContentFilterBar } from "@/components/dashboard/ContentFilterBar";

interface Site {
  id: string;
  name: string;
  domain: string;
  /** Issued by /api/sites; /api/content/[siteId] rejects requests without it. */
  siteToken?: string;
}

interface RawContentElement {
  id: string;
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content?: string;
  published_content?: string;
  staging_content?: string;
  language: string;
  variant: string;
  metadata?: {
    type?: string;
  };
  published_at?: string;
  updated_at?: string;
}

const ITEMS_PER_PAGE = 10;

function PageHeader() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        Content
      </h1>
      <p className="mt-1 text-muted-foreground">
        Manage all editable content across your sites
      </p>
    </div>
  );
}

export default function ContentPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteContents, setSiteContents] = useState<
    Map<string, ContentElement[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<
    "all" | "original" | "edited" | "pending"
  >("all");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch user's sites
  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      const data = await res.json();
      if (data.sites) {
        setSites(data.sites);
        return data.sites;
      }
      return [];
    } catch (err) {
      console.error("Failed to fetch sites:", err);
      return [];
    }
  }, []);

  // Fetch content for a specific site
  const fetchSiteContent = useCallback(async (site: Site) => {
    // The content route is site-token authenticated. Without this it 401s for
    // every site. It also rejects requests whose Origin is not the customer's
    // own domain, which the dashboard can never satisfy — see the note on
    // fetchAllContent. A failure here must surface, not read as "no content".
    const res = await fetch(
      `/api/content/${site.id}?token=${encodeURIComponent(site.siteToken ?? "")}`,
    );

    if (!res.ok) {
      const detail = await res
        .json()
        .then((body) => body?.error)
        .catch(() => null);
      throw new Error(
        `${site.name || site.domain}: ${detail || `request failed (${res.status})`}`,
      );
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: RawContentElement) => ({
      id: item.id,
      siteId: item.site_id,
      siteDomain: site.domain,
      elementId: item.element_id,
      selector: item.selector,
      originalContent: item.original_content || "",
      currentContent: item.current_content || item.original_content || "",
      stagingContent: item.staging_content,
      publishedContent: item.published_content,
      language: item.language,
      variant: item.variant,
      metadata: item.metadata,
      lastModified: item.updated_at || item.published_at || "",
    }));
  }, []);

  // Fetch all content
  const fetchAllContent = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const fetchedSites = await fetchSites();
      if (fetchedSites.length === 0) {
        setLoading(false);
        return;
      }

      const contentMap = new Map<string, ContentElement[]>();

      // A rejected fetch propagates to the catch below and shows the real
      // reason. Previously every failure was swallowed and the page fell
      // through to "Register a site and add content elements to see them
      // here" — telling a customer with content that they have none.
      await Promise.all(
        fetchedSites.map(async (site: Site) => {
          const content = await fetchSiteContent(site);
          if (content.length > 0) {
            contentMap.set(site.id, content);
          }
        }),
      );

      setSiteContents(contentMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch content");
    } finally {
      setLoading(false);
    }
  }, [fetchSites, fetchSiteContent]);

  useEffect(() => {
    fetchAllContent();
  }, [fetchAllContent]);

  // Get all content as a flat array
  const allContent: ContentElement[] = Array.from(siteContents.values()).flat();

  // Filter content
  const filteredContent = allContent.filter((element) => {
    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      element.elementId.toLowerCase().includes(searchLower) ||
      element.originalContent.toLowerCase().includes(searchLower) ||
      element.currentContent.toLowerCase().includes(searchLower) ||
      element.siteDomain.toLowerCase().includes(searchLower);

    // Site filter
    const matchesSite = !selectedSiteId || element.siteId === selectedSiteId;

    // Status filter
    const status = getContentStatus(element);
    const matchesStatus = selectedStatus === "all" || status === selectedStatus;

    return matchesSearch && matchesSite && matchesStatus;
  });

  // Pagination
  const totalPages = Math.ceil(filteredContent.length / ITEMS_PER_PAGE);
  const paginatedContent = filteredContent.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedSiteId, selectedStatus]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div
          className="flex items-center justify-center py-12"
          role="status"
          aria-label="Loading content"
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-tone-danger-surface">
                <FileText
                  className="h-8 w-8 text-tone-danger-text"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                Failed to load content
              </h3>
              <p className="mb-6 text-muted-foreground">{error}</p>
              <Button onClick={fetchAllContent}>Try Again</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader />

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <ContentFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedSiteId={selectedSiteId}
            onSiteChange={setSelectedSiteId}
            selectedStatus={selectedStatus}
            onStatusChange={setSelectedStatus}
            sites={sites}
          />
        </CardContent>
      </Card>

      {/* Content List */}
      {filteredContent.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <FileText
                  className="h-8 w-8 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                No content found
              </h3>
              <p className="mx-auto mb-6 max-w-sm text-muted-foreground">
                {allContent.length === 0
                  ? "Register a site and add content elements to see them here."
                  : "No content matches your current filters. Try adjusting your search or filters."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-4">
            {paginatedContent.map((element) => (
              <ContentElementCard
                key={`${element.siteId}-${element.elementId}`}
                element={element}
                onView={(el) => {
                  window.open(
                    `https://${el.siteDomain}?rcf_highlight=${el.elementId}`,
                    "_blank",
                  );
                }}
                onEdit={(el) => {
                  window.open(
                    `https://${el.siteDomain}?rcf_staging=1&rcf_edit=${el.elementId}`,
                    "_blank",
                  );
                }}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav
              className="flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row"
              aria-label="Content pagination"
            >
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-
                {Math.min(currentPage * ITEMS_PER_PAGE, filteredContent.length)}{" "}
                of {filteredContent.length} elements
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
