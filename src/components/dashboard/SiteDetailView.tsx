'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
  ExternalLink,
  Code,
  BarChart3,
  FileText,
  Activity,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Site } from '@/types';

export type SiteStatus = 'active' | 'inactive' | 'verifying';

interface SiteWithDetails extends Site {
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

interface SiteDetailViewProps {
  site: SiteWithDetails;
  onClose?: () => void;
}

const statusConfig = {
  active: {
    label: 'Active',
    icon: CheckCircle2,
    className: 'bg-green-100 text-green-700 border-green-200',
    description: 'Site is verified and operational',
  },
  inactive: {
    label: 'Inactive',
    icon: AlertCircle,
    className: 'bg-gray-100 text-gray-700 border-gray-200',
    description: 'Site is not currently active',
  },
  verifying: {
    label: 'Verifying',
    icon: Clock,
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    description: 'Site verification in progress',
  },
};

export function SiteDetailView({ site, onClose }: SiteDetailViewProps) {
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const status = site.status || 'active';
  const StatusIcon = statusConfig[status].icon;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const embedScript =
    site.embedScript ||
    `<script src="${appUrl}/embed/recopyfast.js" data-site-id="${site.id}" data-site-token="${site.siteToken || 'YOUR_SITE_TOKEN'}"></script>`;

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(embedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleCopyToken = async () => {
    if (site.siteToken) {
      await navigator.clipboard.writeText(site.siteToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const lastActivity = site.stats?.last_activity
    ? formatDistanceToNow(new Date(site.stats.last_activity), { addSuffix: true })
    : 'No recent activity';

  return (
    <div className="space-y-6">
      {/* Site Information */}
      <Card className="border-gray-200">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{site.name}</CardTitle>
              <CardDescription className="flex items-center space-x-2 mt-2">
                <span>{site.domain}</span>
                <a
                  href={`https://${site.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </CardDescription>
            </div>
            <Badge className={statusConfig[status].className}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusConfig[status].label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Status Description</p>
              <p className="text-sm text-gray-900">{statusConfig[status].description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Created</p>
                <p className="text-sm text-gray-900">
                  {formatDistanceToNow(new Date(site.created_at), { addSuffix: true })}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Last Updated</p>
                <p className="text-sm text-gray-900">
                  {formatDistanceToNow(new Date(site.updated_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Edits</p>
                <p className="text-2xl font-bold text-gray-900">
                  {site.stats?.edits_count || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                <FileText className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Page Views</p>
                <p className="text-2xl font-bold text-gray-900">{site.stats?.views || 0}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Content Elements</p>
                <p className="text-2xl font-bold text-gray-900">
                  {site.stats?.content_elements_count || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl flex items-center justify-center">
                <Code className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Last Activity</p>
                <p className="text-sm font-semibold text-gray-900 mt-2">{lastActivity}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
                <Activity className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Embed Script */}
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle>Embed Script</CardTitle>
          <CardDescription>
            Add this script to your website to enable ReCopyFast features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <code className="text-sm text-gray-800 break-all">{embedScript}</code>
            </div>
            <Button onClick={handleCopyScript} className="w-full">
              {copiedScript ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Embed Script
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Site Token */}
      {site.siteToken && (
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle>Site Token</CardTitle>
            <CardDescription>
              Use this token for API requests (keep it secure and never expose it publicly)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <code className="text-sm text-gray-800 break-all font-mono">
                  {site.siteToken}
                </code>
              </div>
              <Button onClick={handleCopyToken} variant="outline" className="w-full">
                {copiedToken ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Site Token
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Integration Status */}
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle>Integration Status</CardTitle>
          <CardDescription>Current integration health and setup status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-700">Script Installation</span>
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Verified
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-700">API Connection</span>
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Connected
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-700">Content Elements</span>
              <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                {site.stats?.content_elements_count || 0} Found
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}