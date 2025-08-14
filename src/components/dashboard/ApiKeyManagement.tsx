'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { 
  Key, 
  Copy, 
  Trash2, 
  Plus,
  Eye,
  EyeOff,
  AlertTriangle,
  Settings,
  Activity,
  RefreshCw
} from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  lastUsedAt?: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  isActive: boolean;
  createdAt: string;
}

interface ApiKeyWithSecret extends ApiKey {
  key?: string;
}

interface ApiKeyManagementProps {
  siteId: string;
}

export function ApiKeyManagement({ siteId }: ApiKeyManagementProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [rateLimits, setRateLimits] = useState({
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000
  });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  useEffect(() => {
    fetchApiKeys();
  }, [siteId]);

  const fetchApiKeys = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/api-keys?siteId=${siteId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch API keys');
      }

      setApiKeys(data.apiKeys || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) {
      setError('API key name is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          name: newKeyName.trim(),
          requestsPerMinute: rateLimits.requestsPerMinute,
          requestsPerHour: rateLimits.requestsPerHour,
          requestsPerDay: rateLimits.requestsPerDay
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create API key');
      }

      setNewKey(data.apiKey.key);
      setNewKeyName('');
      setShowCreateForm(false);
      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const updateApiKey = async (keyId: string, updates: Partial<ApiKey>) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeyId: keyId,
          ...updates
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update API key');
      }

      setEditingKey(null);
      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const deleteApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/api-keys?apiKeyId=${keyId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete API key');
      }

      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatLastUsed = (lastUsedAt?: string) => {
    if (!lastUsedAt) return 'Never';
    const date = new Date(lastUsedAt);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">API Key Management</h2>
          <p className="text-gray-600">Create and manage API keys for your site</p>
        </div>
        <Button 
          onClick={() => setShowCreateForm(true)}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create API Key
        </Button>
      </div>

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <div className="text-red-800">{error}</div>
        </Alert>
      )}

      {newKey && (
        <Card className="p-6 bg-green-50 border-green-200">
          <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center gap-2">
            <Key className="w-5 h-5" />
            API Key Created Successfully
          </h3>
          
          <Alert className="border-orange-200 bg-orange-50 mb-4">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <div className="text-orange-800">
              <strong>Important:</strong> Store this API key securely. It will not be shown again.
            </div>
          </Alert>

          <div className="space-y-3">
            <div className="flex items-center justify-between bg-white p-3 rounded border">
              <code className="font-mono text-sm flex-1">
                {showKey ? newKey : '●'.repeat(newKey.length)}
              </code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowKey(!showKey)}
                  className="flex items-center gap-1"
                >
                  {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showKey ? 'Hide' : 'Show'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(newKey)}
                  className="flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </Button>
              </div>
            </div>
          </div>
          
          <Button 
            onClick={() => setNewKey(null)}
            variant="outline" 
            className="mt-4"
          >
            Close
          </Button>
        </Card>
      )}

      {showCreateForm && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Create New API Key</h3>
          <div className="space-y-4">
            <div>
              <Label htmlFor="keyName">API Key Name</Label>
              <Input
                id="keyName"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="My API Key"
                className="mt-1"
              />
              <p className="text-sm text-gray-500 mt-1">
                Choose a descriptive name to identify this key later.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="perMinute">Requests per Minute</Label>
                <Input
                  id="perMinute"
                  type="number"
                  value={rateLimits.requestsPerMinute}
                  onChange={(e) => setRateLimits({
                    ...rateLimits,
                    requestsPerMinute: parseInt(e.target.value) || 0
                  })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="perHour">Requests per Hour</Label>
                <Input
                  id="perHour"
                  type="number"
                  value={rateLimits.requestsPerHour}
                  onChange={(e) => setRateLimits({
                    ...rateLimits,
                    requestsPerHour: parseInt(e.target.value) || 0
                  })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="perDay">Requests per Day</Label>
                <Input
                  id="perDay"
                  type="number"
                  value={rateLimits.requestsPerDay}
                  onChange={(e) => setRateLimits({
                    ...rateLimits,
                    requestsPerDay: parseInt(e.target.value) || 0
                  })}
                  className="mt-1"
                />
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button 
                onClick={createApiKey}
                disabled={loading || !newKeyName.trim()}
                className="flex items-center gap-2"
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                Create API Key
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4">
        {apiKeys.length === 0 ? (
          <Card className="p-8 text-center">
            <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No API keys created yet.</p>
            <Button 
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Your First API Key
            </Button>
          </Card>
        ) : (
          apiKeys.map((apiKey) => (
            <Card key={apiKey.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold">{apiKey.name}</h3>
                    <Badge className={apiKey.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {apiKey.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Key: <code className="bg-gray-100 px-1 rounded">{apiKey.keyPreview}</code></p>
                    <p>Created: {new Date(apiKey.createdAt).toLocaleDateString()}</p>
                    <p>Last used: {formatLastUsed(apiKey.lastUsedAt)}</p>
                    
                    {editingKey === apiKey.id ? (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <Label className="text-xs">Per Minute</Label>
                          <Input
                            type="number"
                            defaultValue={apiKey.requestsPerMinute}
                            className="h-8 text-sm"
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 0;
                              setRateLimits({ ...rateLimits, requestsPerMinute: value });
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Per Hour</Label>
                          <Input
                            type="number"
                            defaultValue={apiKey.requestsPerHour}
                            className="h-8 text-sm"
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 0;
                              setRateLimits({ ...rateLimits, requestsPerHour: value });
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Per Day</Label>
                          <Input
                            type="number"
                            defaultValue={apiKey.requestsPerDay}
                            className="h-8 text-sm"
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 0;
                              setRateLimits({ ...rateLimits, requestsPerDay: value });
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p>Rate limits: {apiKey.requestsPerMinute}/min, {apiKey.requestsPerHour}/hour, {apiKey.requestsPerDay}/day</p>
                    )}
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {editingKey === apiKey.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => updateApiKey(apiKey.id, rateLimits)}
                        disabled={loading}
                        className="flex items-center gap-1"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingKey(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateApiKey(apiKey.id, { isActive: !apiKey.isActive })}
                        disabled={loading}
                        className={`flex items-center gap-1 ${
                          apiKey.isActive ? 'text-orange-600' : 'text-green-600'
                        }`}
                      >
                        <Activity className="w-3 h-3" />
                        {apiKey.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingKey(apiKey.id)}
                        className="flex items-center gap-1"
                      >
                        <Settings className="w-3 h-3" />
                        Edit
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteApiKey(apiKey.id)}
                        disabled={loading}
                        className="flex items-center gap-1 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}