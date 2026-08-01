"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { SiteCard, SiteStatus } from "@/components/dashboard/SiteCard";
import { SiteDetailView } from "@/components/dashboard/SiteDetailView";
import { SiteRegistrationModal } from "@/components/dashboard/SiteRegistrationModal";
import EditWebsiteButton from "@/components/dashboard/EditWebsiteButton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import {
  Globe,
  Plus,
  Search,
  SearchX,
  ArrowUpDown,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import type { Site } from "@/types";

interface SiteWithStats extends Site {
  stats?: {
    edits_count?: number;
    views?: number;
    content_elements_count?: number;
    last_activity?: string;
  };
  status?: SiteStatus;
  embedScript?: string;
  siteToken?: string;
}

type SortOption = "name" | "date" | "activity";
type FilterOption = "all" | SiteStatus;

const STATUS_FILTERS: ReadonlyArray<{ value: FilterOption; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "verifying", label: "Verifying" },
  { value: "inactive", label: "Inactive" },
];

const SORT_LABELS: Record<SortOption, string> = {
  name: "Name",
  date: "Date added",
  activity: "Last activity",
};

export default function SitesPage() {
  const { user } = useAuth();
  const [sites, setSites] = useState<SiteWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("date");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modal state
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);

  // Delete confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Edit dialog state
  const [editTargetSite, setEditTargetSite] = useState<SiteWithStats | null>(
    null,
  );

  // Fetch sites
  const fetchSites = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/sites");

      if (!response.ok) {
        throw new Error("Failed to fetch sites");
      }

      const data = await response.json();
      setSites(data.sites || []);
    } catch (err) {
      console.error("Error fetching sites:", err);
      setError(err instanceof Error ? err.message : "Failed to load sites");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSites();
    }
  }, [user]);

  // Filter and sort sites
  const filteredAndSortedSites = useMemo(() => {
    let result = [...sites];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (site) =>
          site.name.toLowerCase().includes(query) ||
          site.domain.toLowerCase().includes(query),
      );
    }

    // Apply status filter
    if (filterBy !== "all") {
      result = result.filter((site) => site.status === filterBy);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "date":
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        case "activity": {
          const aActivity = a.stats?.last_activity
            ? new Date(a.stats.last_activity).getTime()
            : 0;
          const bActivity = b.stats?.last_activity
            ? new Date(b.stats.last_activity).getTime()
            : 0;
          return bActivity - aActivity;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [sites, searchQuery, sortBy, filterBy]);

  // Handlers
  const handleViewDetails = (siteId: string) => {
    setSelectedSiteId(siteId);
  };

  const handleEdit = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId) ?? null;
    setEditTargetSite(site);
  };

  const handleDeleteRequest = (siteId: string) => {
    setDeleteError(null);
    setDeleteTargetId(siteId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;

    try {
      setIsDeleting(true);
      setDeleteError(null);
      const response = await fetch(`/api/sites/${deleteTargetId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data: unknown = await response.json();
        const errData = data as { error?: string };
        throw new Error(errData.error ?? "Failed to delete site");
      }

      setSites((prev) => prev.filter((site) => site.id !== deleteTargetId));
      if (selectedSiteId === deleteTargetId) {
        setSelectedSiteId(null);
      }
      setDeleteTargetId(null);
    } catch (err) {
      console.error("Error deleting site:", err);
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete site",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRegistrationSuccess = () => {
    setIsRegistrationModalOpen(false);
    fetchSites();
  };

  const selectedSite = selectedSiteId
    ? sites.find((site) => site.id === selectedSiteId)
    : null;

  const statusCounts = useMemo(() => {
    return {
      all: sites.length,
      active: sites.filter((s) => s.status === "active").length,
      inactive: sites.filter((s) => s.status === "inactive").length,
      verifying: sites.filter((s) => s.status === "verifying").length,
    };
  }, [sites]);

  // If viewing site details
  if (selectedSite) {
    return (
      <div>
        <div className="mb-6">
          <Button variant="outline" onClick={() => setSelectedSiteId(null)}>
            <X className="w-4 h-4 mr-2" />
            Back to Sites
          </Button>
        </div>
        <SiteDetailView
          site={selectedSite}
          onClose={() => setSelectedSiteId(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Every domain you have connected to ReCopyFast."
        actions={
          <Button onClick={() => setIsRegistrationModalOpen(true)}>
            <Plus aria-hidden="true" />
            Add site
          </Button>
        }
      />

      {/* These were four metric cards. They never were metrics — clicking one
          filtered the list. Presented as a segmented filter they say what they
          actually do, and the counts still read at a glance. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Filter sites by status"
        >
          {STATUS_FILTERS.map((option) => {
            const selected = filterBy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilterBy(option.value)}
                aria-pressed={selected}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm",
                  "transition-[color,background-color,box-shadow] duration-200 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "bg-card font-medium text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
                <span
                  className={cn(
                    "tabular rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                    selected
                      ? "bg-surface-3 text-foreground"
                      : "bg-card/60 text-muted-foreground",
                  )}
                >
                  {statusCounts[option.value]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search by name or domain"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search sites"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The label is hidden below `sm`, and the icon is aria-hidden —
                  without an explicit name this button is unlabelled for screen
                  readers on mobile. */}
              <Button
                variant="outline"
                className="shrink-0"
                aria-label={`Sort sites (currently ${SORT_LABELS[sortBy].toLowerCase()})`}
              >
                <ArrowUpDown aria-hidden="true" />
                <span className="hidden sm:inline">{SORT_LABELS[sortBy]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("name")}>
                Sort by name
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("date")}>
                Sort by date added
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("activity")}>
                Sort by last activity
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        // Cards, not a spinner: the grid keeps its shape while it fills.
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          role="status"
          aria-label="Loading sites"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="space-y-4 rounded-xl border border-border p-5"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
              <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-5 w-10" />
                    <Skeleton className="h-2.5 w-12" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Could not load your sites</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            <Button onClick={fetchSites} variant="outline" size="sm">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : filteredAndSortedSites.length === 0 ? (
        <Card variant="outline">
          <CardContent className="p-0">
            {searchQuery || filterBy !== "all" ? (
              <EmptyState
                icon={SearchX}
                title="Nothing matches those filters"
                description={
                  searchQuery
                    ? `No site matches “${searchQuery}”${filterBy === "all" ? "" : ` with status ${filterBy}`}.`
                    : `You have no ${filterBy} sites.`
                }
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterBy("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Globe}
                title="No sites connected yet"
                description="ReCopyFast turns a site you already have into one your team can edit in place."
                action={
                  <Button onClick={() => setIsRegistrationModalOpen(true)}>
                    <Plus aria-hidden="true" />
                    Add your first site
                  </Button>
                }
                steps={[
                  "Register the domain you want to make editable.",
                  "Paste the one-line script tag into that site's HTML.",
                  "Open your site and edit any text in place — changes appear here.",
                ]}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAndSortedSites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              onViewDetails={handleViewDetails}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
            />
          ))}
        </div>
      )}

      {/* Site Registration Modal */}
      <SiteRegistrationModal
        isOpen={isRegistrationModalOpen}
        onClose={() => setIsRegistrationModalOpen(false)}
        onSuccess={handleRegistrationSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetId(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Site</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this site? This action cannot be
              undone and will remove all associated data.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2">
              {deleteError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTargetId(null);
                setDeleteError(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Site"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Website Dialog */}
      <Dialog
        open={editTargetSite !== null}
        onOpenChange={(open) => {
          if (!open) setEditTargetSite(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Website</DialogTitle>
            <DialogDescription>
              Start an edit session for{" "}
              <span className="font-medium">{editTargetSite?.name}</span>. This
              opens your site with in-line editing enabled.
            </DialogDescription>
          </DialogHeader>
          {editTargetSite && (
            <div className="flex justify-end pt-2">
              <EditWebsiteButton
                site={{
                  id: editTargetSite.id,
                  domain: editTargetSite.domain,
                  name: editTargetSite.name,
                }}
                userPermissions={["edit", "admin"]}
                variant="primary"
                size="md"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
