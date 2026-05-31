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
import { Badge } from "@/components/ui/badge";
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
import {
  Globe,
  Plus,
  Search,
  ArrowUpDown,
  Filter,
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
    <div>
      {/* Header Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              My Websites
            </h1>
            <p className="text-gray-600">
              Manage and monitor all your registered websites
            </p>
          </div>
          <Button
            onClick={() => setIsRegistrationModalOpen(true)}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New Site
          </Button>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card
            className={`border-gray-200 cursor-pointer transition-all ${
              filterBy === "all" ? "ring-2 ring-blue-500" : ""
            }`}
            onClick={() => setFilterBy("all")}
          >
            <CardContent className="p-4">
              <p className="text-sm text-gray-600 mb-1">Total Sites</p>
              <p className="text-2xl font-bold text-gray-900">
                {statusCounts.all}
              </p>
            </CardContent>
          </Card>
          <Card
            className={`border-gray-200 cursor-pointer transition-all ${
              filterBy === "active" ? "ring-2 ring-green-500" : ""
            }`}
            onClick={() => setFilterBy("active")}
          >
            <CardContent className="p-4">
              <p className="text-sm text-gray-600 mb-1">Active</p>
              <p className="text-2xl font-bold text-green-600">
                {statusCounts.active}
              </p>
            </CardContent>
          </Card>
          <Card
            className={`border-gray-200 cursor-pointer transition-all ${
              filterBy === "verifying" ? "ring-2 ring-yellow-500" : ""
            }`}
            onClick={() => setFilterBy("verifying")}
          >
            <CardContent className="p-4">
              <p className="text-sm text-gray-600 mb-1">Verifying</p>
              <p className="text-2xl font-bold text-yellow-600">
                {statusCounts.verifying}
              </p>
            </CardContent>
          </Card>
          <Card
            className={`border-gray-200 cursor-pointer transition-all ${
              filterBy === "inactive" ? "ring-2 ring-gray-500" : ""
            }`}
            onClick={() => setFilterBy("inactive")}
          >
            <CardContent className="p-4">
              <p className="text-sm text-gray-600 mb-1">Inactive</p>
              <p className="text-2xl font-bold text-gray-600">
                {statusCounts.inactive}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search sites by name or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <ArrowUpDown className="w-4 h-4 mr-2" />
                  Sort: {sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy("name")}>
                  Sort by Name
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("date")}>
                  Sort by Date
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("activity")}>
                  Sort by Activity
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {filterBy !== "all" && (
              <Badge
                variant="secondary"
                className="cursor-pointer hover:bg-gray-200"
                onClick={() => setFilterBy("all")}
              >
                <Filter className="w-3 h-3 mr-1" />
                {filterBy}
                <X className="w-3 h-3 ml-1" />
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3 text-red-800">
              <AlertCircle className="w-5 h-5" />
              <div>
                <p className="font-semibold">Error loading sites</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
            <Button onClick={fetchSites} variant="outline" className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : filteredAndSortedSites.length === 0 ? (
        <Card className="border-gray-200">
          <CardContent className="p-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Globe className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {searchQuery || filterBy !== "all"
                  ? "No sites found"
                  : "No sites yet"}
              </h3>
              <p className="text-gray-600 mb-6 max-w-sm mx-auto">
                {searchQuery || filterBy !== "all"
                  ? "Try adjusting your search or filter criteria"
                  : "Add your first site to start making your content editable with AI assistance."}
              </p>
              {!searchQuery && filterBy === "all" && (
                <Button
                  onClick={() => setIsRegistrationModalOpen(true)}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Site
                </Button>
              )}
              {(searchQuery || filterBy !== "all") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setFilterBy("all");
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
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
