'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Globe,
  MoreVertical,
  Eye,
  Settings,
  Trash2,
  Copy,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Site } from '@/types';

export type SiteStatus = 'active' | 'inactive' | 'verifying';

interface SiteWithStats extends Site {
  stats?: {
    edits_count?: number;
    views?: number;
    last_activity?: string;
  };
  status?: SiteStatus;
}

interface SiteCardProps {
  site: SiteWithStats;
  onViewDetails: (siteId: string) => void;
  onEdit: (siteId: string) => void;
  onDelete: (siteId: string) => void;
}

const statusConfig = {
  active: {
    label: 'Active',
    icon: CheckCircle2,
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  inactive: {
    label: 'Inactive',
    icon: AlertCircle,
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  verifying: {
    label: 'Verifying',
    icon: Clock,
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
};

export function SiteCard({ site, onViewDetails, onEdit, onDelete }: SiteCardProps) {
  const [copied, setCopied] = useState(false);
  const status = site.status || 'active';
  const StatusIcon = statusConfig[status].icon;

  const handleCopyDomain = async () => {
    await navigator.clipboard.writeText(site.domain);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lastEdited = site.updated_at
    ? formatDistanceToNow(new Date(site.updated_at), { addSuffix: true })
    : 'Never';

  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 border-gray-200">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start space-x-3 flex-1 min-w-0">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-lg truncate">{site.name}</h3>
              <div className="flex items-center space-x-2 mt-1">
                <p className="text-sm text-gray-600 truncate">{site.domain}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={handleCopyDomain}
                  title="Copy domain"
                >
                  {copied ? (
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="w-4 h-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onViewDetails(site.id)}>
                <Eye className="w-4 h-4 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(site.id)}>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(site.id)}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Site
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center space-x-2 mb-4">
          <Badge className={statusConfig[status].className}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {statusConfig[status].label}
          </Badge>
          <span className="text-xs text-gray-500">Last edited {lastEdited}</span>
        </div>

        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500 mb-1">Edits</p>
            <p className="text-lg font-semibold text-gray-900">
              {site.stats?.edits_count || 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Views</p>
            <p className="text-lg font-semibold text-gray-900">{site.stats?.views || 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Activity</p>
            <p className="text-lg font-semibold text-gray-900">
              {site.stats?.last_activity
                ? formatDistanceToNow(new Date(site.stats.last_activity), { addSuffix: false })
                : 'None'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onViewDetails(site.id)}
          >
            <Eye className="w-4 h-4 mr-2" />
            View Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onEdit(site.id)}
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}