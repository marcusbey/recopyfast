'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  BulkOperation, 
  BulkImportPayload,
  BulkUpdatePayload,
  Site 
} from '@/types';
import {
  Upload,
  Download,
  FileText,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Trash2,
  Edit3,
  Plus,
  Loader2
} from 'lucide-react';

interface BulkOperationsProps {
  siteId: string;
  sites: Site[];
}

export function BulkOperations({ siteId, sites }: BulkOperationsProps) {
  const [activeTab, setActiveTab] = useState('import');
  const [operations, setOperations] = useState<BulkOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFormat, setImportFormat] = useState<'json' | 'csv' | 'xml'>('json');
  const [importOptions, setImportOptions] = useState({
    overwrite_existing: false,
    create_missing_elements: true,
    validate_content: true
  });

  // Export state
  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'xml'>('json');
  const [exportFilters, setExportFilters] = useState({
    language: '',
    variant: '',
    element_ids: '',
    updated_since: ''
  });

  // Batch update state
  const [batchOperations, setBatchOperations] = useState<BulkUpdatePayload['operations']>([
    { element_id: '', operation: 'find_replace', find: '', replace: '' }
  ]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
    }
  }, []);

  const processImport = async () => {
    if (!importFile) return;

    setLoading(true);
    try {
      const fileContent = await readFileContent(importFile);
      
      let data: any;
      switch (importFormat) {
        case 'json':
          data = JSON.parse(fileContent);
          break;
        case 'csv':
          data = fileContent;
          break;
        case 'xml':
          data = fileContent;
          break;
        default:
          throw new Error('Unsupported format');
      }

      const payload: BulkImportPayload = {
        site_id: siteId,
        format: importFormat,
        data,
        options: importOptions
      };

      const response = await fetch('/api/bulk/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }

      const result = await response.json();
      
      // Poll for operation status
      await pollOperationStatus(result.operation_id);
      
      setImportFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Import error:', error);
      alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const processExport = async () => {
    setLoading(true);
    try {
      const filters = Object.fromEntries(
        Object.entries(exportFilters).filter(([_, value]) => value !== '')
      );

      const payload = {
        site_id: siteId,
        format: exportFormat,
        filters: Object.keys(filters).length > 0 ? {
          ...filters,
          element_ids: filters.element_ids ? filters.element_ids.split(',').map(id => id.trim()) : undefined
        } : undefined
      };

      const response = await fetch('/api/bulk/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `content-export-${siteId}-${Date.now()}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const processBatchUpdate = async () => {
    const validOperations = batchOperations.filter(op => 
      op.element_id && op.operation && (
        (op.operation === 'find_replace' && op.find !== undefined) ||
        (op.operation !== 'find_replace' && op.content)
      )
    );

    if (validOperations.length === 0) {
      alert('Please add at least one valid operation');
      return;
    }

    setLoading(true);
    try {
      const payload: BulkUpdatePayload = {
        site_id: siteId,
        operations: validOperations
      };

      const response = await fetch('/api/bulk/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Batch update failed');
      }

      const result = await response.json();
      
      // Poll for operation status
      await pollOperationStatus(result.operation_id);
      
      // Reset operations
      setBatchOperations([{ element_id: '', operation: 'find_replace', find: '', replace: '' }]);
    } catch (error) {
      console.error('Batch update error:', error);
      alert(`Batch update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const pollOperationStatus = async (operationId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`/api/bulk/import?operationId=${operationId}`);
        if (!response.ok) break;

        const operation = await response.json();
        
        if (operation.status === 'completed' || operation.status === 'failed') {
          // Refresh operations list
          fetchOperations();
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      } catch (error) {
        console.error('Polling error:', error);
        break;
      }
    }
  };

  const fetchOperations = async () => {
    try {
      const response = await fetch(`/api/bulk/import?siteId=${siteId}`);
      if (response.ok) {
        const ops = await response.json();
        setOperations(ops);
      }
    } catch (error) {
      console.error('Failed to fetch operations:', error);
    }
  };

  const addBatchOperation = () => {
    setBatchOperations(prev => [
      ...prev,
      { element_id: '', operation: 'find_replace', find: '', replace: '' }
    ]);
  };

  const removeBatchOperation = (index: number) => {
    setBatchOperations(prev => prev.filter((_, i) => i !== index));
  };

  const updateBatchOperation = (index: number, field: string, value: string) => {
    setBatchOperations(prev => prev.map((op, i) => 
      i === index ? { ...op, [field]: value } : op
    ));
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

  React.useEffect(() => {
    fetchOperations();
  }, [siteId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Bulk Operations</h2>
        <p className="text-gray-600">Import, export, and batch update content efficiently</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="batch">Batch Update</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Import Content</h3>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="import-format">Format</Label>
                <select
                  id="import-format"
                  value={importFormat}
                  onChange={(e) => setImportFormat(e.target.value as 'json' | 'csv' | 'xml')}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="xml">XML</option>
                </select>
              </div>

              <div>
                <Label htmlFor="import-file">Select File</Label>
                <input
                  ref={fileInputRef}
                  id="import-file"
                  type="file"
                  accept={`.${importFormat},.txt`}
                  onChange={handleFileUpload}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                />
                {importFile && (
                  <p className="text-sm text-gray-600 mt-1">
                    Selected: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Options</Label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={importOptions.overwrite_existing}
                      onChange={(e) => setImportOptions(prev => ({
                        ...prev,
                        overwrite_existing: e.target.checked
                      }))}
                      className="mr-2"
                    />
                    Overwrite existing content
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={importOptions.create_missing_elements}
                      onChange={(e) => setImportOptions(prev => ({
                        ...prev,
                        create_missing_elements: e.target.checked
                      }))}
                      className="mr-2"
                    />
                    Create missing elements
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={importOptions.validate_content}
                      onChange={(e) => setImportOptions(prev => ({
                        ...prev,
                        validate_content: e.target.checked
                      }))}
                      className="mr-2"
                    />
                    Validate content
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
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing Import...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import Content
                  </>
                )}
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Export Content</h3>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="export-format">Format</Label>
                <select
                  id="export-format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as 'json' | 'csv' | 'xml')}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="xml">XML</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="export-language">Language (optional)</Label>
                  <Input
                    id="export-language"
                    value={exportFilters.language}
                    onChange={(e) => setExportFilters(prev => ({
                      ...prev,
                      language: e.target.value
                    }))}
                    placeholder="e.g., en, es, fr"
                  />
                </div>

                <div>
                  <Label htmlFor="export-variant">Variant (optional)</Label>
                  <Input
                    id="export-variant"
                    value={exportFilters.variant}
                    onChange={(e) => setExportFilters(prev => ({
                      ...prev,
                      variant: e.target.value
                    }))}
                    placeholder="e.g., default, mobile"
                  />
                </div>

                <div>
                  <Label htmlFor="export-elements">Element IDs (optional)</Label>
                  <Input
                    id="export-elements"
                    value={exportFilters.element_ids}
                    onChange={(e) => setExportFilters(prev => ({
                      ...prev,
                      element_ids: e.target.value
                    }))}
                    placeholder="Comma-separated IDs"
                  />
                </div>

                <div>
                  <Label htmlFor="export-since">Updated Since (optional)</Label>
                  <Input
                    id="export-since"
                    type="datetime-local"
                    value={exportFilters.updated_since}
                    onChange={(e) => setExportFilters(prev => ({
                      ...prev,
                      updated_since: e.target.value
                    }))}
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
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export Content
                  </>
                )}
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="batch" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Batch Update Operations</h3>
            
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
                        onChange={(e) => updateBatchOperation(index, 'element_id', e.target.value)}
                        placeholder="Element ID to update"
                      />
                    </div>

                    <div>
                      <Label>Operation</Label>
                      <select
                        value={operation.operation}
                        onChange={(e) => updateBatchOperation(index, 'operation', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      >
                        <option value="find_replace">Find & Replace</option>
                        <option value="append">Append</option>
                        <option value="prepend">Prepend</option>
                        <option value="set">Set Content</option>
                      </select>
                    </div>

                    {operation.operation === 'find_replace' ? (
                      <>
                        <div>
                          <Label>Find</Label>
                          <Input
                            value={operation.find || ''}
                            onChange={(e) => updateBatchOperation(index, 'find', e.target.value)}
                            placeholder="Text to find"
                          />
                        </div>
                        <div>
                          <Label>Replace</Label>
                          <Input
                            value={operation.replace || ''}
                            onChange={(e) => updateBatchOperation(index, 'replace', e.target.value)}
                            placeholder="Replacement text"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-2">
                        <Label>Content</Label>
                        <Input
                          value={operation.content || ''}
                          onChange={(e) => updateBatchOperation(index, 'content', e.target.value)}
                          placeholder="Content to add/set"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={addBatchOperation}
                >
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
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Operation History</h3>
            
            <div className="space-y-3">
              {operations.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="mx-auto h-12 w-12 mb-2" />
                  <p>No operations found</p>
                </div>
              ) : (
                operations.map((operation) => (
                  <div key={operation.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(operation.status)}
                      <div>
                        <p className="font-medium capitalize">
                          {operation.operation_type.replace('_', ' ')}
                        </p>
                        <p className="text-sm text-gray-600">
                          {new Date(operation.created_at).toLocaleDateString()} at{' '}
                          {new Date(operation.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {operation.processed_items}/{operation.total_items} processed
                      </p>
                      {operation.failed_items > 0 && (
                        <p className="text-sm text-red-600">
                          {operation.failed_items} failed
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}