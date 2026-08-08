"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
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

/** One site's content read that was refused, kept beside the ones that worked. */
interface SiteContentFailure {
  siteId: string;
  siteLabel: string;
  message: string;
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

/**
 * The sites whose content could not be read, named and scoped to themselves.
 *
 * Deliberately an inline notice rather than a page state: everything else on
 * this page still works, and the content that did load is right below it.
 */
function SiteFailureNotice({
  failures,
  onRetry,
}: {
  failures: SiteContentFailure[];
  onRetry: () => void;
}) {
  return (
    <Card className="border-tone-danger-border">
      <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle
              className="h-4 w-4 text-tone-danger-text"
              aria-hidden="true"
            />
            {failures.length === 1
              ? "One site's content could not be loaded"
              : `${failures.length} sites' content could not be loaded`}
          </h2>
          <ul className="space-y-1">
            {failures.map((failure) => (
              <li
                key={failure.siteId}
                className="text-sm text-muted-foreground"
              >
                {failure.siteLabel} — {failure.message}
              </li>
            ))}
          </ul>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ContentPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteContents, setSiteContents] = useState<
    Map<string, ContentElement[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [siteFailures, setSiteFailures] = useState<SiteContentFailure[]>([]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<
    "all" | "original" | "edited" | "pending"
  >("all");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch user's sites
  //
  // Throws on anything that is not a site list. An empty array here means "you
  // have registered no sites", which is what the page says when it renders the
  // empty state — so a refused or malformed read must not be able to produce
  // one. Swallowing the failure told a customer with sites that they had none,
  // and offered them no way to retry.
  const fetchSites = useCallback(async (): Promise<Site[]> => {
    const res = await fetch("/api/sites");

    if (!res.ok) {
      const detail = await res
        .json()
        .then((body) => body?.error)
        .catch(() => null);
      throw new Error(detail || `Could not load your sites (${res.status})`);
    }

    const body: unknown = await res.json();
    const siteList = (body as { sites?: unknown } | null)?.sites;
    if (!Array.isArray(siteList)) {
      throw new Error("Could not load your sites: unexpected response");
    }

    const fetchedSites = siteList as Site[];
    setSites(fetchedSites);
    return fetchedSites;
  }, []);

  // Fetch content for a specific site
  const fetchSiteContent = useCallback(async (site: Site) => {
    // The content route is site-token authenticated for the embed widget, but
    // also recognizes this dashboard as a first-party caller: with a signed-in
    // session and a site_permissions row it authorizes on that instead of the
    // token/Origin check (see authorizeFirstPartySiteRequest in site-auth.ts).
    // The token query param below is kept as a fallback for that widget path.
    // A failure here must surface, not read as "no content" — see fetchAllContent.
    const res = await fetch(
      `/api/content/${site.id}?token=${encodeURIComponent(site.siteToken ?? "")}`,
    );

    if (!res.ok) {
      const detail = await res
        .json()
        .then((body) => body?.error)
        .catch(() => null);
      // The reason only. Which site it belongs to is the caller's to record,
      // because the caller is what still has the other sites in hand.
      throw new Error(detail || `request failed (${res.status})`);
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
      setSiteFailures([]);

      const fetchedSites = await fetchSites();
      if (fetchedSites.length === 0) {
        setLoading(false);
        return;
      }

      // `allSettled`, not `all`. `Promise.all` rejects on the first failure and
      // discards the results that had already resolved, and the catch below set
      // a page-level error that replaced the whole view — so one site whose
      // read was refused took every other site's content down with it. A
      // customer with two sites, one broken, could not reach the one that
      // worked. Each site now succeeds or fails on its own terms.
      const results = await Promise.allSettled(
        fetchedSites.map((site) => fetchSiteContent(site)),
      );

      const contentMap = new Map<string, ContentElement[]>();
      const failures: SiteContentFailure[] = [];

      results.forEach((result, index) => {
        const site: Site = fetchedSites[index];

        if (result.status === "fulfilled") {
          if (result.value.length > 0) {
            contentMap.set(site.id, result.value);
          }
          return;
        }

        failures.push({
          siteId: site.id,
          siteLabel: site.domain || site.name,
          message:
            result.reason instanceof Error
              ? result.reason.message
              : "Failed to load content",
        });
      });

      setSiteContents(contentMap);
      setSiteFailures(failures);
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

  // Keep the current page inside the pages that exist.
  //
  // Filters are not the only thing that can shrink the list: a retry that comes
  // back with fewer elements than the last read does too, and that path sets no
  // filter state. Without this, page 3 of a list that is now one page long
  // renders no cards under the words "Page 3 of 1". Clamped rather than reset,
  // so a retry that changes nothing leaves the reader where they were.
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, totalPages)));
  }, [totalPages]);

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

  // Error state. Reserved for a failure that leaves nothing to show — a
  // per-site content refusal is reported inline by SiteFailureNotice instead,
  // so it can sit beside the sites that loaded.
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

      {/* Sites whose content could not be read, beside the ones that could */}
      {siteFailures.length > 0 && (
        <SiteFailureNotice failures={siteFailures} onRetry={fetchAllContent} />
      )}

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
                {allContent.length > 0
                  ? "No content matches your current filters. Try adjusting your search or filters."
                  : siteFailures.length > 0 &&
                      siteFailures.length === sites.length
                    ? // Not "you have none" — we do not know that. Every site we
                      // asked refused, and the reasons are listed above.
                      "None of your sites' content could be read. See the reasons above."
                    : siteFailures.length > 0
                      ? // Some sites answered and are genuinely empty; others
                        // refused. Claiming a total failure here would describe
                        // an account state that is not the one they are in.
                        "The sites we could read have no content yet. The rest are listed above with their reasons."
                      : "Register a site and add content elements to see them here."}
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
