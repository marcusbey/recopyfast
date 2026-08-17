"use client";

import React, { useState, useRef, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentValue } from "@/components/ui/content-value";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_IMPORT_BYTES, MAX_IMPORT_LABEL } from "@/lib/bulk/constants";
import {
  BulkOperation,
  BulkImportPayload,
  BulkImportResults,
  BulkImportRowResult,
  BulkUpdatePayload,
} from "@/types";
import {
  Upload,
  Download,
  FileDown,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Edit3,
  PencilLine,
  Plus,
  SkipForward,
  Loader2,
  type LucideIcon,
} from "lucide-react";

interface BulkOperationsProps {
  siteId: string;
}

export function BulkOperations({ siteId }: BulkOperationsProps) {
  const [activeTab, setActiveTab] = useState("export");
  const [operations, setOperations] = useState<BulkOperation[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  // XML is exportable and not importable — the picker only offers what the
  // route can actually read.
  const [importFormat, setImportFormat] = useState<"json" | "csv">("json");
  const [importOptions, setImportOptions] = useState({
    overwrite_existing: false,
    create_missing_elements: true,
  });
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importForbidden, setImportForbidden] = useState(false);
  const [importResults, setImportResults] = useState<BulkImportResults | null>(
    null,
  );
  const [showAllRows, setShowAllRows] = useState(false);

  // Export state
  const [exportFormat, setExportFormat] = useState<"json" | "csv" | "xml">(
    "json",
  );
  const [exportFilters, setExportFilters] = useState({
    language: "",
    variant: "",
    element_ids: "",
    updated_since: "",
  });
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedFilename, setExportedFilename] = useState<string | null>(null);

  // Batch update state
  const [batchOperations, setBatchOperations] = useState<
    BulkUpdatePayload["operations"]
  >([{ element_id: "", operation: "find_replace", find: "", replace: "" }]);

  /**
   * The exact request body this import would send.
   *
   * Sharing `MAX_IMPORT_BYTES` with the route only guarantees anything if both
   * sides measure the *same quantity*, and they did not: the route measures the
   * body (`req.text()`, then `Buffer.byteLength`) while this card measured
   * `file.size`. The body is strictly the larger of the two — a CSV travels as
   * a JSON string, so every `"` and every newline in it is escaped to two
   * bytes — so a file could pass here and be refused there, which is the drift
   * the shared constant exists to prevent.
   *
   * Returns null when the file is JSON that does not parse: there is no
   * envelope to measure, and that failure is already reported on submit.
   */
  const measureImportBody = useCallback(
    (content: string): number | null => {
      let data: unknown = content;

      if (importFormat === "json") {
        try {
          data = JSON.parse(content);
        } catch {
          return null;
        }
      }

      const payload: BulkImportPayload = {
        site_id: siteId,
        format: importFormat,
        data,
        options: importOptions,
      };

      return new Blob([JSON.stringify(payload)]).size;
    },
    [siteId, importFormat, importOptions],
  );

  /**
   * The size limit is enforced the moment a file is chosen, before a single
   * byte is uploaded — the same `MAX_IMPORT_BYTES` the route refuses on, now
   * against the same quantity. The input clears itself so the submit button
   * cannot re-arm on a file already refused.
   */
  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;

      const refuse = (bytes: number) => {
        setImportFile(null);
        setSizeError(describeSizeRefusal(bytes));
        input.value = "";
      };

      // Cheap first, and it is not redundant: escaping only ever grows a body,
      // so a file already over the limit cannot produce an envelope under it —
      // no reason to read a gigabyte into memory to find that out.
      if (file.size > MAX_IMPORT_BYTES) {
        refuse(file.size);
        return;
      }

      const bodyBytes = measureImportBody(await readFileContent(file));
      if (bodyBytes !== null && bodyBytes > MAX_IMPORT_BYTES) {
        refuse(bodyBytes);
        return;
      }

      setSizeError(null);
      setImportError(null);
      setImportFile(file);
    },
    [measureImportBody],
  );

  const processImport = async () => {
    if (!importFile) return;

    setLoading(true);
    setImportError(null);
    setImportResults(null);
    setShowAllRows(false);
    try {
      const fileContent = await readFileContent(importFile);

      // Measured again here, not only when the file was chosen: the format
      // picker and the option checkboxes both change the body, and both can be
      // touched after the file is picked. This is the measurement that matches
      // the request actually about to leave.
      const bodyBytes = measureImportBody(fileContent);
      if (bodyBytes !== null && bodyBytes > MAX_IMPORT_BYTES) {
        setImportFile(null);
        setSizeError(describeSizeRefusal(bodyBytes));
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // XML export exists; XML import does not (`parseXMLImport` throws), so
      // the picker never offers it and this stays a guard, not a path.
      const data: unknown =
        importFormat === "json" ? JSON.parse(fileContent) : fileContent;

      const payload: BulkImportPayload = {
        site_id: siteId,
        format: importFormat,
        data,
        options: importOptions,
      };

      const response = await fetch("/api/bulk/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.status === 403) {
        // Not a per-file problem: the whole tab is refused, so the form goes
        // away rather than inviting a retry that cannot succeed.
        setImportForbidden(true);
        return;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import failed");
      }

      const result = await response.json();
      setImportResults(result.results as BulkImportResults);

      // Poll for operation status
      await pollOperationStatus(result.operation_id);

      setImportFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Import error:", error);
      setImportError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const processExport = async () => {
    setLoading(true);
    setExportError(null);
    setExportedFilename(null);
    try {
      const filters = Object.fromEntries(
        Object.entries(exportFilters).filter(([, value]) => value !== ""),
      );

      const payload = {
        site_id: siteId,
        format: exportFormat,
        filters:
          Object.keys(filters).length > 0
            ? {
                ...filters,
                element_ids: filters.element_ids
                  ? filters.element_ids.split(",").map((id) => id.trim())
                  : undefined,
              }
            : undefined,
      };

      const response = await fetch("/api/bulk/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Export failed");
      }

      // Download the file
      const blob = await response.blob();
      const filename = `content-export-${siteId}-${Date.now()}.${exportFormat}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportedFilename(filename);
      // An export is a bulk operation too, so the history tab should show it
      // without waiting for a reload.
      fetchOperations();
    } catch (error) {
      console.error("Export error:", error);
      setExportError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const processBatchUpdate = async () => {
    const validOperations = batchOperations.filter(
      (op) =>
        op.element_id &&
        op.operation &&
        ((op.operation === "find_replace" && op.find !== undefined) ||
          (op.operation !== "find_replace" && op.content)),
    );

    if (validOperations.length === 0) {
      alert("Please add at least one valid operation");
      return;
    }

    setLoading(true);
    try {
      const payload: BulkUpdatePayload = {
        site_id: siteId,
        operations: validOperations,
      };

      const response = await fetch("/api/bulk/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Batch update failed");
      }

      const result = await response.json();

      // Poll for operation status
      await pollOperationStatus(result.operation_id);

      // Reset operations
      setBatchOperations([
        { element_id: "", operation: "find_replace", find: "", replace: "" },
      ]);
    } catch (error) {
      console.error("Batch update error:", error);
      alert(
        `Batch update failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const pollOperationStatus = async (operationId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(
          `/api/bulk/import?operationId=${operationId}`,
        );
        if (!response.ok) break;

        const operation = await response.json();

        if (operation.status === "completed" || operation.status === "failed") {
          // Refresh operations list
          fetchOperations();
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
      } catch (error) {
        console.error("Polling error:", error);
        break;
      }
    }
  };

  const fetchOperations = useCallback(async () => {
    setHistoryError(null);
    try {
      // `GET /api/bulk/import` only ever understood `operationId`; asking it for
      // a site listing answered 400, the `if (response.ok)` guard swallowed it,
      // and the tab rendered "no operations" — an outage shown as an empty
      // account. `GET /api/bulk/export` is the endpoint that takes a siteId, and
      // it returns every operation type, not just exports.
      const response = await fetch(`/api/bulk/export?siteId=${siteId}`);
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "You do not have access to this site's operation history."
            : `Failed to load operation history (${response.status})`,
        );
      }

      const ops = await response.json();
      // Empty is never how an error renders: a body that is not a list means
      // something answered that was not this endpoint.
      if (!Array.isArray(ops)) {
        throw new Error("Failed to load operation history");
      }
      setOperations(ops);
    } catch (error) {
      console.error("Failed to fetch operations:", error);
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Failed to load operation history",
      );
    }
  }, [siteId]);

  const addBatchOperation = () => {
    setBatchOperations((prev) => [
      ...prev,
      { element_id: "", operation: "find_replace", find: "", replace: "" },
    ]);
  };

  const removeBatchOperation = (index: number) => {
    setBatchOperations((prev) => prev.filter((_, i) => i !== index));
  };

  const updateBatchOperation = (
    index: number,
    field: string,
    value: string,
  ) => {
    setBatchOperations((prev) =>
      prev.map((op, i) => (i === index ? { ...op, [field]: value } : op)),
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-5 w-5 text-tone-success-text" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-tone-danger-text" />;
      case "running":
        return <Loader2 className="h-5 w-5 text-tone-info-text animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  React.useEffect(() => {
    fetchOperations();
  }, [fetchOperations]);

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconTile tone="neutral">
            <FileDown aria-hidden="true" />
          </IconTile>
          <div>
            {/* "Bulk Operations" is an admin word. What this card is for is
                the owner keeping their own copy, so that is what it says. */}
            <CardTitle>Content portability</CardTitle>
            <CardDescription>
              Export this site&apos;s content as a file, and import it back.
              Your copy is yours — take it with you whenever you want.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="export">Export</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
            <TabsTrigger value="batch">Batch Update</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-4">
            {importForbidden ? (
              // A refusal that applies to the whole tab, not to one field:
              // rendering the form underneath would invite a retry that cannot
              // succeed.
              <Alert variant="destructive">
                <AlertTitle>You cannot import to this site</AlertTitle>
                <AlertDescription>
                  You need edit access on this site to import content. Ask a
                  site admin to grant it.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="import-format">Format</Label>
                  {/* Native select: there is no `Select` primitive in
                      `src/components/ui/` — recorded as gap 6 in the design
                      system, to be built once, not freelanced here. */}
                  <select
                    id="import-format"
                    value={importFormat}
                    onChange={(e) =>
                      setImportFormat(e.target.value as "json" | "csv")
                    }
                    className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="import-file">Select file</Label>
                  <input
                    ref={fileInputRef}
                    id="import-file"
                    type="file"
                    accept={`.${importFormat},.txt`}
                    onChange={handleFileUpload}
                    className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                  />
                  {importFile && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {importFile.name} ({formatFileSize(importFile.size)})
                    </p>
                  )}
                </div>

                {sizeError && (
                  <Alert variant="destructive">
                    <AlertTitle>File too large</AlertTitle>
                    <AlertDescription>{sizeError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label>Options</Label>
                  <div className="space-y-2 text-sm">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={importOptions.overwrite_existing}
                        onChange={(e) =>
                          setImportOptions((prev) => ({
                            ...prev,
                            overwrite_existing: e.target.checked,
                          }))
                        }
                        className="mr-2"
                      />
                      Overwrite existing content
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={importOptions.create_missing_elements}
                        onChange={(e) =>
                          setImportOptions((prev) => ({
                            ...prev,
                            create_missing_elements: e.target.checked,
                          }))
                        }
                        className="mr-2"
                      />
                      Create missing elements
                    </label>
                  </div>
                </div>

                <Button
                  onClick={processImport}
                  disabled={!importFile || loading}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Import content
                    </>
                  )}
                </Button>

                {importError && (
                  <Alert variant="destructive">
                    <AlertTitle>Import failed</AlertTitle>
                    <AlertDescription>{importError}</AlertDescription>
                  </Alert>
                )}

                {loading && <ImportReportSkeleton />}

                {!loading && importResults && (
                  <ImportReport
                    results={importResults}
                    showAllRows={showAllRows}
                    onToggleRows={() => setShowAllRows((prev) => !prev)}
                  />
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="export" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="export-format">Format</Label>
                  <select
                    id="export-format"
                    value={exportFormat}
                    onChange={(e) =>
                      setExportFormat(e.target.value as "json" | "csv" | "xml")
                    }
                    className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                    <option value="xml">XML</option>
                  </select>
                </div>

                {/* Always shown: what is in the file is not data-dependent, and
                    an owner deciding whether they are locked in should not have
                    to run an export to find out what they would get.

                    Every column, not a selection. A panel naming five of the
                    eleven leaves an owner writing an import file without the
                    six it never mentioned — and `original_content` was one of
                    them, the column the site falls back to serving when
                    `published_content` is null. */}
                <div className="rounded-lg border border-border bg-surface-1 p-4">
                  <p className="text-sm font-medium text-foreground">
                    What&apos;s in the file
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <li>Row id — ReCopyFast&apos;s own key for this row</li>
                    <li>Site id — which site the row belongs to</li>
                    <li>Element id — the identifier ReCopyFast matches on</li>
                    <li>Selector — where it sits on the page</li>
                    <li>
                      Original content — the copy as ReCopyFast first read it
                    </li>
                    <li>Current content — the copy as it is live today</li>
                    <li>Language — the locale this copy belongs to</li>
                    <li>Variant — which variant of the element it is</li>
                    <li>
                      Metadata — what ReCopyFast recorded about it, as JSON
                    </li>
                    <li>Created — when ReCopyFast first saw the element</li>
                    <li>Last updated — when its copy last changed</li>
                  </ul>
                  <p className="mt-2 text-sm text-muted-foreground">
                    A JSON export carries the whole row, so it holds these and
                    any other column the element has.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="export-language">Language (optional)</Label>
                    <Input
                      id="export-language"
                      value={exportFilters.language}
                      onChange={(e) =>
                        setExportFilters((prev) => ({
                          ...prev,
                          language: e.target.value,
                        }))
                      }
                      placeholder="e.g., en, es, fr"
                    />
                  </div>

                  <div>
                    <Label htmlFor="export-variant">Variant (optional)</Label>
                    <Input
                      id="export-variant"
                      value={exportFilters.variant}
                      onChange={(e) =>
                        setExportFilters((prev) => ({
                          ...prev,
                          variant: e.target.value,
                        }))
                      }
                      placeholder="e.g., default, mobile"
                    />
                  </div>

                  <div>
                    <Label htmlFor="export-elements">
                      Element IDs (optional)
                    </Label>
                    <Input
                      id="export-elements"
                      value={exportFilters.element_ids}
                      onChange={(e) =>
                        setExportFilters((prev) => ({
                          ...prev,
                          element_ids: e.target.value,
                        }))
                      }
                      placeholder="Comma-separated IDs"
                    />
                  </div>

                  <div>
                    <Label htmlFor="export-since">
                      Updated Since (optional)
                    </Label>
                    <Input
                      id="export-since"
                      type="datetime-local"
                      value={exportFilters.updated_since}
                      onChange={(e) =>
                        setExportFilters((prev) => ({
                          ...prev,
                          updated_since: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <Button
                  onClick={processExport}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Exporting…
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Export content
                    </>
                  )}
                </Button>

                {/* Inline, next to what it concerns — the product has no toast
                    and a story is not the place to invent one. */}
                {exportedFilename && (
                  <Alert variant="success">
                    <AlertTitle>Export ready</AlertTitle>
                    <AlertDescription>
                      {exportedFilename} downloaded.
                    </AlertDescription>
                  </Alert>
                )}

                {exportError && (
                  <Alert variant="destructive">
                    <AlertTitle>Export failed</AlertTitle>
                    <AlertDescription>
                      {exportError} Try again.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="batch" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                Batch Update Operations
              </h3>

              <div className="space-y-4">
                {batchOperations.map((operation, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium">Operation {index + 1}</h4>
                      {batchOperations.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeBatchOperation(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label>Element ID</Label>
                        <Input
                          value={operation.element_id}
                          onChange={(e) =>
                            updateBatchOperation(
                              index,
                              "element_id",
                              e.target.value,
                            )
                          }
                          placeholder="Element ID to update"
                        />
                      </div>

                      <div>
                        <Label>Operation</Label>
                        <select
                          value={operation.operation}
                          onChange={(e) =>
                            updateBatchOperation(
                              index,
                              "operation",
                              e.target.value,
                            )
                          }
                          className="w-full px-3 py-2 border border-input rounded-md"
                        >
                          <option value="find_replace">Find & Replace</option>
                          <option value="append">Append</option>
                          <option value="prepend">Prepend</option>
                          <option value="set">Set Content</option>
                        </select>
                      </div>

                      {operation.operation === "find_replace" ? (
                        <>
                          <div>
                            <Label>Find</Label>
                            <Input
                              value={operation.find || ""}
                              onChange={(e) =>
                                updateBatchOperation(
                                  index,
                                  "find",
                                  e.target.value,
                                )
                              }
                              placeholder="Text to find"
                            />
                          </div>
                          <div>
                            <Label>Replace</Label>
                            <Input
                              value={operation.replace || ""}
                              onChange={(e) =>
                                updateBatchOperation(
                                  index,
                                  "replace",
                                  e.target.value,
                                )
                              }
                              placeholder="Replacement text"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="md:col-span-2">
                          <Label>Content</Label>
                          <Input
                            value={operation.content || ""}
                            onChange={(e) =>
                              updateBatchOperation(
                                index,
                                "content",
                                e.target.value,
                              )
                            }
                            placeholder="Content to add/set"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={addBatchOperation}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Operation
                  </Button>

                  <Button
                    onClick={processBatchUpdate}
                    disabled={loading}
                    className="flex-1"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Execute Batch Update
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <div className="space-y-3">
              {/* Empty is never how an error renders. This tab used to swallow
                  a 400 into "No operations found", which reads to an owner as
                  "you have never exported anything". */}
              {historyError ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not load history</AlertTitle>
                  <AlertDescription>{historyError}</AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {operations.length === 0 ? (
                    <EmptyState
                      icon={FileText}
                      title="No imports or exports yet"
                      description="Every export and import you run on this site is listed here, with what it changed."
                    />
                  ) : (
                    operations.map((operation) => (
                      <div
                        key={operation.id}
                        className="flex items-center justify-between p-4 bg-surface-1 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(operation.status)}
                          <div>
                            <p className="font-medium capitalize">
                              {operation.operation_type.replace("_", " ")}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(
                                operation.created_at,
                              ).toLocaleDateString()}{" "}
                              at{" "}
                              {new Date(
                                operation.created_at,
                              ).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {operation.processed_items}/{operation.total_items}{" "}
                            processed
                          </p>
                          {operation.failed_items > 0 && (
                            <p className="text-sm text-tone-danger-text">
                              {operation.failed_items} failed
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** Bytes as the owner reads them, for a limit stated in megabytes. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One wording for the refusal, whether it was the file or the body that was too
 * big — the owner's next move is the same either way, and it is the only thing
 * the message needs to get across.
 */
function describeSizeRefusal(bytes: number): string {
  return `This import is ${formatFileSize(bytes)}. The import limit is ${MAX_IMPORT_LABEL} — split the file into smaller ones and try again.`;
}

function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Outcome tones are fixed by the design brief: colour signals state, never
 * category. `skipped` is neutral on purpose — it is a decision the owner's own
 * options made, not something that went wrong.
 */
const OUTCOME_STATUS: Record<
  BulkImportRowResult["outcome"],
  { label: string; tone: StatusTone; icon: LucideIcon; description: string }
> = {
  created: {
    label: "Created",
    tone: "success",
    icon: Plus,
    description: "The element did not exist and was created",
  },
  updated: {
    label: "Updated",
    tone: "info",
    icon: PencilLine,
    description: "The element existed and its content was replaced",
  },
  skipped: {
    label: "Skipped",
    tone: "neutral",
    icon: SkipForward,
    description: "Nothing was written for this row",
  },
  failed: {
    label: "Failed",
    tone: "danger",
    icon: XCircle,
    description: "This row could not be applied",
  },
};

/** The report's own shape while it loads — not a bare spinner. */
function ImportReportSkeleton() {
  return (
    <div className="space-y-3" data-testid="import-report-skeleton">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["created", "updated", "skipped", "failed"].map((key) => (
          <Skeleton key={key} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

interface ImportReportProps {
  results: BulkImportResults;
  showAllRows: boolean;
  onToggleRows: () => void;
}

/**
 * 394 created, 3 updated, 0 skipped, 3 failed has to read as "three things to
 * look at", not as an incident — so the summary is a warning rather than a
 * destructive alert, and the rows that need a human come first. Nobody should
 * scroll past 394 identical green rows to find the three that matter.
 */
function ImportReport({
  results,
  showAllRows,
  onToggleRows,
}: ImportReportProps) {
  const applied = results.created + results.updated;
  const needsAttention = results.rows.filter(
    (row) => row.outcome !== "created",
  );
  const hiddenCount = results.rows.length - needsAttention.length;
  const visibleRows = showAllRows ? results.rows : needsAttention;

  const summary =
    applied === 0
      ? {
          variant: "destructive" as const,
          title: "Import failed",
          body: `0 of ${results.total} rows applied.`,
        }
      : results.failed + results.skipped > 0
        ? {
            variant: "warning" as const,
            title: `Import complete with ${results.failed + results.skipped} ${
              results.failed + results.skipped === 1
                ? "row that needs"
                : "rows that need"
            } attention`,
            body: `${applied} of ${results.total} rows applied (${results.created} created, ${results.updated} updated).`,
          }
        : {
            variant: "success" as const,
            title: "Import complete",
            body: `${applied} of ${results.total} rows applied (${results.created} created, ${results.updated} updated).`,
          };

  return (
    <div className="space-y-4">
      <Alert variant={summary.variant}>
        <AlertTitle>{summary.title}</AlertTitle>
        <AlertDescription>{summary.body}</AlertDescription>
      </Alert>

      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        data-testid="import-metrics"
      >
        {(["created", "updated", "skipped", "failed"] as const).map(
          (outcome) => (
            <Metric
              key={outcome}
              label={OUTCOME_STATUS[outcome].label}
              value={String(results[outcome])}
              state="ready"
              icon={OUTCOME_STATUS[outcome].icon}
              tone={OUTCOME_STATUS[outcome].tone}
            />
          ),
        )}
      </div>

      {hiddenCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onToggleRows}>
          {showAllRows
            ? `Hide the ${hiddenCount} created rows`
            : `${hiddenCount} created rows hidden — show all ${results.total}`}
        </Button>
      )}

      {visibleRows.length > 0 && (
        // Semantic table composed from tokens: there is no `Table` primitive,
        // and one story is not where a shared one gets invented (design system
        // gap 8).
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Element</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={`${row.row}-${row.elementId}`}
                  className="border-t border-border"
                >
                  <td className="tabular px-3 py-2">{row.row}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.elementId || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={OUTCOME_STATUS[row.outcome]} />
                  </td>
                  <td className="px-3 py-2">
                    {row.detail ? (
                      <ContentValue
                        value={row.detail}
                        label={`Row ${row.row} detail`}
                        className="text-muted-foreground"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Every applied row is saved to version history like a normal edit —
        review or revert it from the site&apos;s history panel.
      </p>
    </div>
  );
}
