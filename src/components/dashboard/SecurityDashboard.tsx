'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { 
  Shield,
  AlertTriangle,
  Activity,
  Globe,
  Key,
  TrendingUp,
  Clock,
  Users,
  Ban,
  RefreshCw,
  Filter,
  Download
} from 'lucide-react';

interface SecurityEvent {
  id: string;
  eventType: string;
  severity: string;
  ipAddress?: string;
  userAgent?: string;
  endpoint?: string;
  createdAt: string;
  sites?: { domain: string };
}

interface SecurityStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  recentEvents: SecurityEvent[];
  rateLimitStats: {
    total: number;
    uniqueIPs: number;
    uniqueEndpoints: number;
  };
  topIPs: Array<{ ip: string; count: number }>;
  domainVerificationStats: {
    total: number;
    verified: number;
    pending: number;
    byMethod: Record<string, number>;
  };
  apiKeyStats: {
    total: number;
    active: number;
    inactive: number;
    recentlyUsed: number;
  };
}

interface SecurityDashboardProps {
  siteId?: string;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  rate_limit_exceeded: 'Rate Limit Exceeded',
  invalid_domain: 'Invalid Domain',
  xss_attempt: 'XSS Attempt',
  suspicious_activity: 'Suspicious Activity'
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800'
};

export function SecurityDashboard({ siteId }: SecurityDashboardProps) {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('24h');
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
    fetchEvents();
  }, [siteId, timeframe, selectedSeverity, selectedEventType]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ timeframe });
      if (siteId) params.set('siteId', siteId);

      const response = await fetch(`/api/security/stats?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch security stats');
      }

      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchEvents = async () => {
    try {
      const params = new URLSearchParams({ 
        limit: '50',
        offset: '0'
      });
      if (siteId) params.set('siteId', siteId);
      if (selectedSeverity) params.set('severity', selectedSeverity);
      if (selectedEventType) params.set('eventType', selectedEventType);

      const response = await fetch(`/api/security/events?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch security events');
      }

      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const formatEventType = (eventType: string) => {
    return EVENT_TYPE_LABELS[eventType] || eventType.replace(/_/g, ' ').toUpperCase();
  };

  const getSeverityBadge = (severity: string) => {
    const colorClass = SEVERITY_COLORS[severity] || 'bg-gray-100 text-gray-800';
    return <Badge className={colorClass}>{severity.toUpperCase()}</Badge>;
  };

  const StatCard = ({ 
    title, 
    value, 
    icon: Icon, 
    trend, 
    description 
  }: {
    title: string;
    value: string | number;
    icon: React.ElementType;
    trend?: 'up' | 'down' | 'neutral';
    description?: string;
  }) => (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {description && (
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {trend && (
            <TrendingUp className={`w-4 h-4 ${
              trend === 'up' ? 'text-red-500' : 
              trend === 'down' ? 'text-green-500' : 
              'text-gray-500'
            }`} />
          )}
          <Icon className="w-8 h-8 text-gray-400" />
        </div>
      </div>
    </Card>
  );

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin" />
        <span className="ml-2">Loading security dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" />
            Security Dashboard
          </h2>
          <p className="text-gray-600">Monitor security events and system health</p>
        </div>
        
        <div className="flex gap-2">
          <select 
            value={timeframe} 
            onChange={(e) => setTimeframe(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
          
          <Button onClick={fetchStats} disabled={loading} size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <div className="text-red-800">{error}</div>
        </Alert>
      )}

      {stats && (
        <>
          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Events"
              value={stats.totalEvents}
              icon={Activity}
              description={`In the last ${timeframe}`}
            />
            <StatCard
              title="Rate Limit Violations"
              value={stats.rateLimitStats.total}
              icon={Ban}
              trend={stats.rateLimitStats.total > 0 ? 'up' : 'neutral'}
            />
            <StatCard
              title="Verified Domains"
              value={`${stats.domainVerificationStats.verified}/${stats.domainVerificationStats.total}`}
              icon={Globe}
              description="Domain verification status"
            />
            <StatCard
              title="Active API Keys"
              value={`${stats.apiKeyStats.active}/${stats.apiKeyStats.total}`}
              icon={Key}
              description="API key usage"
            />
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="events">Recent Events</TabsTrigger>
              <TabsTrigger value="threats">Threat Analysis</TabsTrigger>
              <TabsTrigger value="domains">Domain Status</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Events by Type */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Events by Type</h3>
                  <div className="space-y-2">
                    {Object.entries(stats.eventsByType).map(([type, count]) => (
                      <div key={type} className="flex justify-between items-center">
                        <span className="text-sm">{formatEventType(type)}</span>
                        <Badge variant="outline">{count}</Badge>
                      </div>
                    ))}
                    {Object.keys(stats.eventsByType).length === 0 && (
                      <p className="text-gray-500 text-sm">No events recorded</p>
                    )}
                  </div>
                </Card>

                {/* Events by Severity */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Events by Severity</h3>
                  <div className="space-y-2">
                    {Object.entries(stats.eventsBySeverity).map(([severity, count]) => (
                      <div key={severity} className="flex justify-between items-center">
                        <span className="text-sm capitalize">{severity}</span>
                        {getSeverityBadge(severity)}
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                    ))}
                    {Object.keys(stats.eventsBySeverity).length === 0 && (
                      <p className="text-gray-500 text-sm">No events recorded</p>
                    )}
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="events" className="space-y-4">
              <div className="flex gap-2 mb-4">
                <select 
                  value={selectedSeverity || ''} 
                  onChange={(e) => setSelectedSeverity(e.target.value || null)}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  <option value="">All Severities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                
                <select 
                  value={selectedEventType || ''} 
                  onChange={(e) => setSelectedEventType(e.target.value || null)}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  <option value="">All Event Types</option>
                  {Object.keys(EVENT_TYPE_LABELS).map(type => (
                    <option key={type} value={type}>{EVENT_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {events.map((event) => (
                  <Card key={event.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{formatEventType(event.eventType)}</span>
                          {getSeverityBadge(event.severity)}
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          {event.ipAddress && (
                            <p>IP: <code className="bg-gray-100 px-1 rounded">{event.ipAddress}</code></p>
                          )}
                          {event.endpoint && (
                            <p>Endpoint: <code className="bg-gray-100 px-1 rounded">{event.endpoint}</code></p>
                          )}
                          {event.sites?.domain && (
                            <p>Domain: {event.sites.domain}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {new Date(event.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </Card>
                ))}
                {events.length === 0 && (
                  <Card className="p-8 text-center">
                    <p className="text-gray-500">No security events found for the selected filters.</p>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="threats" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top IPs */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Top Source IPs</h3>
                  <div className="space-y-2">
                    {stats.topIPs.slice(0, 5).map((ipData, index) => (
                      <div key={ipData.ip} className="flex justify-between items-center">
                        <span className="text-sm font-mono">{ipData.ip}</span>
                        <Badge variant="outline">{ipData.count} events</Badge>
                      </div>
                    ))}
                    {stats.topIPs.length === 0 && (
                      <p className="text-gray-500 text-sm">No security events recorded</p>
                    )}
                  </div>
                </Card>

                {/* Rate Limit Analysis */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Rate Limit Analysis</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm">Total Violations</span>
                      <span className="font-medium">{stats.rateLimitStats.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Unique IPs</span>
                      <span className="font-medium">{stats.rateLimitStats.uniqueIPs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Affected Endpoints</span>
                      <span className="font-medium">{stats.rateLimitStats.uniqueEndpoints}</span>
                    </div>
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="domains" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Domain Verification Status */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Domain Verification</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm">Total Domains</span>
                      <span className="font-medium">{stats.domainVerificationStats.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Verified</span>
                      <Badge className="bg-green-100 text-green-800">
                        {stats.domainVerificationStats.verified}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Pending</span>
                      <Badge className="bg-yellow-100 text-yellow-800">
                        {stats.domainVerificationStats.pending}
                      </Badge>
                    </div>
                  </div>
                </Card>

                {/* API Key Status */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">API Key Status</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm">Total Keys</span>
                      <span className="font-medium">{stats.apiKeyStats.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Active</span>
                      <Badge className="bg-green-100 text-green-800">
                        {stats.apiKeyStats.active}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Recently Used</span>
                      <Badge className="bg-blue-100 text-blue-800">
                        {stats.apiKeyStats.recentlyUsed}
                      </Badge>
                    </div>
                  </div>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}