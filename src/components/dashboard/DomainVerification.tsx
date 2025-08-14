'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Copy, 
  Trash2, 
  Plus,
  Download,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

interface DomainVerification {
  id: string;
  domain: string;
  verificationMethod: 'dns' | 'file';
  verificationToken: string;
  verificationCode: string;
  isVerified: boolean;
  verifiedAt?: string;
  expiresAt: string;
  createdAt: string;
}

interface VerificationInstructions {
  type: 'dns' | 'file';
  record?: string;
  filename?: string;
  content?: string;
}

interface DomainVerificationProps {
  siteId: string;
}

export function DomainVerification({ siteId }: DomainVerificationProps) {
  const [verifications, setVerifications] = useState<DomainVerification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<'dns' | 'file'>('dns');
  const [instructions, setInstructions] = useState<VerificationInstructions | null>(null);

  useEffect(() => {
    fetchVerifications();
  }, [siteId]);

  const fetchVerifications = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/domains/verify?siteId=${siteId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch verifications');
      }

      setVerifications(data.verifications || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const createVerification = async () => {
    if (!newDomain.trim()) {
      setError('Domain is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/domains/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          domain: newDomain.trim(),
          method: verificationMethod
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create verification');
      }

      setInstructions(data.instructions);
      setNewDomain('');
      setShowAddForm(false);
      await fetchVerifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const verifyDomain = async (verificationId: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/domains/verify', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      if (data.success) {
        await fetchVerifications();
      } else {
        setError(data.error || 'Verification failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const deleteVerification = async (verificationId: string) => {
    if (!confirm('Are you sure you want to delete this verification?')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/domains/verify?verificationId=${verificationId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete verification');
      }

      await fetchVerifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (verification: DomainVerification) => {
    if (verification.isVerified) {
      return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Verified</Badge>;
    }
    
    const isExpired = new Date(verification.expiresAt) <= new Date();
    if (isExpired) {
      return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Expired</Badge>;
    }
    
    return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) <= new Date();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Domain Verification</h2>
          <p className="text-gray-600">Verify domain ownership to enable secure embeds</p>
        </div>
        <Button 
          onClick={() => setShowAddForm(true)}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Domain
        </Button>
      </div>

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <div className="text-red-800">{error}</div>
        </Alert>
      )}

      {instructions && (
        <Card className="p-6 bg-blue-50 border-blue-200">
          <h3 className="text-lg font-semibold text-blue-900 mb-4">
            Verification Instructions
          </h3>
          
          {instructions.type === 'dns' ? (
            <div className="space-y-3">
              <p className="text-blue-800">
                Add the following TXT record to your domain's DNS settings:
              </p>
              <div className="bg-blue-100 p-3 rounded font-mono text-sm flex items-center justify-between">
                <span>{instructions.record}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(instructions.record!)}
                  className="flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </Button>
              </div>
              <p className="text-sm text-blue-700">
                DNS changes may take up to 24 hours to propagate. You can check verification status after making the changes.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-blue-800">
                Upload the verification file to your domain's web server:
              </p>
              <div className="bg-blue-100 p-3 rounded">
                <div className="flex items-center justify-between mb-2">
                  <strong>File: /.well-known/{instructions.filename}</strong>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadFile(instructions.filename!, instructions.content!)}
                    className="flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </Button>
                </div>
                <pre className="text-xs bg-white p-2 rounded">{instructions.content}</pre>
              </div>
              <p className="text-sm text-blue-700">
                Make sure the file is accessible at: https://yourdomain.com/.well-known/{instructions.filename}
              </p>
            </div>
          )}
          
          <Button 
            onClick={() => setInstructions(null)}
            variant="outline" 
            className="mt-4"
          >
            Close Instructions
          </Button>
        </Card>
      )}

      {showAddForm && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Add New Domain</h3>
          <div className="space-y-4">
            <div>
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                className="mt-1"
              />
            </div>
            
            <div>
              <Label>Verification Method</Label>
              <Tabs value={verificationMethod} onValueChange={(v) => setVerificationMethod(v as 'dns' | 'file')}>
                <TabsList className="grid w-full grid-cols-2 mt-1">
                  <TabsTrigger value="dns">DNS Record</TabsTrigger>
                  <TabsTrigger value="file">File Upload</TabsTrigger>
                </TabsList>
                <TabsContent value="dns" className="mt-3">
                  <p className="text-sm text-gray-600">
                    Add a TXT record to your domain's DNS settings. This method is recommended for most users.
                  </p>
                </TabsContent>
                <TabsContent value="file" className="mt-3">
                  <p className="text-sm text-gray-600">
                    Upload a verification file to your website. Requires access to your web server.
                  </p>
                </TabsContent>
              </Tabs>
            </div>
            
            <div className="flex gap-2">
              <Button 
                onClick={createVerification}
                disabled={loading || !newDomain.trim()}
                className="flex items-center gap-2"
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                Create Verification
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4">
        {verifications.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-gray-500">No domain verifications yet.</p>
            <Button 
              onClick={() => setShowAddForm(true)}
              className="mt-4"
            >
              Add Your First Domain
            </Button>
          </Card>
        ) : (
          verifications.map((verification) => (
            <Card key={verification.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold">{verification.domain}</h3>
                    {getStatusBadge(verification)}
                    <Badge variant="outline">{verification.verificationMethod.toUpperCase()}</Badge>
                  </div>
                  
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Created: {new Date(verification.createdAt).toLocaleDateString()}</p>
                    {verification.isVerified ? (
                      <p>Verified: {new Date(verification.verifiedAt!).toLocaleDateString()}</p>
                    ) : (
                      <p>Expires: {new Date(verification.expiresAt).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {!verification.isVerified && !isExpired(verification.expiresAt) && (
                    <Button
                      size="sm"
                      onClick={() => verifyDomain(verification.id)}
                      disabled={loading}
                      className="flex items-center gap-1"
                    >
                      {loading ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3 h-3" />
                      )}
                      Verify
                    </Button>
                  )}
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteVerification(verification.id)}
                    disabled={loading}
                    className="flex items-center gap-1 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </Button>
                </div>
              </div>
              
              {isExpired(verification.expiresAt) && !verification.isVerified && (
                <Alert className="mt-4 border-orange-200 bg-orange-50">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <div className="text-orange-800">
                    This verification has expired. Please create a new verification to verify this domain.
                  </div>
                </Alert>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}