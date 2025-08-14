'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AnalyticsDashboardData, 
  Site,
  PerformanceMetric 
} from '@/types';
import {
  BarChart3,
  Users,
  MousePointer,
  Clock,
  TrendingUp,
  Download,
  Calendar,
  Eye,
  Edit3,
  Globe,
  Activity
} from 'lucide-react';

interface AnalyticsDashboardProps {
  siteId?: string;
  sites?: Site[];
}

export function AnalyticsDashboard({ siteId, sites }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSite, setSelectedSite] = useState(siteId || 'all');
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchAnalytics();
  }, [selectedSite, dateRange]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end
      });
      
      if (selectedSite !== 'all') {
        params.append('siteId', selectedSite);
      }

      const response = await fetch(`/api/analytics/track?${params}`);
      if (!response.ok) throw new Error('Failed to fetch analytics');
      
      const analyticsData = await response.json();
      setData(analyticsData);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportData = async (format: 'json' | 'csv') => {
    try {
      const params = new URLSearchParams({
        format,
        startDate: dateRange.start,
        endDate: dateRange.end
      });
      
      if (selectedSite !== 'all') {
        params.append('siteId', selectedSite);
      }

      const response = await fetch(`/api/analytics/export?${params}`);
      if (!response.ok) throw new Error('Failed to export data');
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${dateRange.start}-${dateRange.end}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export data:', error);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-6">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-1/2"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">No analytics data</h3>
        <p className="mt-1 text-sm text-gray-500">Start using ReCopyFast to see analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h2>
          <p className="text-gray-600">Monitor your site performance and user engagement</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Site Selector */}
          {sites && sites.length > 0 && (
            <select
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">All Sites</option>
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.domain}
                </option>
              ))}
            </select>
          )}

          {/* Date Range */}
          <div className="flex gap-2">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          {/* Export */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportData('json')}
            >
              <Download className="h-4 w-4 mr-2" />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportData('csv')}
            >
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Sites</p>
              <p className="text-3xl font-bold text-gray-900">{data.overview.total_sites}</p>
            </div>
            <Globe className="h-8 w-8 text-blue-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Users</p>
              <p className="text-3xl font-bold text-gray-900">{data.overview.total_users}</p>
            </div>
            <Users className="h-8 w-8 text-green-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Page Views</p>
              <p className="text-3xl font-bold text-gray-900">{data.overview.total_page_views.toLocaleString()}</p>
            </div>
            <Eye className="h-8 w-8 text-purple-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Content Edits</p>
              <p className="text-3xl font-bold text-gray-900">{data.overview.total_edits.toLocaleString()}</p>
            </div>
            <Edit3 className="h-8 w-8 text-orange-600" />
          </div>
        </Card>
      </div>

      {/* Performance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Load Time</p>
              <p className="text-2xl font-bold text-gray-900">{data.performance.avg_load_time}ms</p>
            </div>
            <Clock className="h-6 w-6 text-blue-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Edit Time</p>
              <p className="text-2xl font-bold text-gray-900">{data.performance.avg_edit_time.toFixed(0)}ms</p>
            </div>
            <Activity className="h-6 w-6 text-green-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Conversion Rate</p>
              <p className="text-2xl font-bold text-gray-900">{(data.overview.conversion_rate * 100).toFixed(1)}%</p>
            </div>
            <TrendingUp className="h-6 w-6 text-purple-600" />
          </div>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="sites">Top Sites</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Page Views Trend</h3>
              <SimpleChart 
                data={data.trends.page_views} 
                color="blue"
                label="Page Views"
              />
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Content Edits Trend</h3>
              <SimpleChart 
                data={data.trends.edits} 
                color="green"
                label="Edits"
              />
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Active Users Trend</h3>
              <SimpleChart 
                data={data.trends.users} 
                color="purple"
                label="Users"
              />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sites" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Top Performing Sites</h3>
            <div className="space-y-4">
              {data.top_sites.map((site, index) => (
                <div key={site.site_id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                    <div>
                      <p className="font-medium">{site.domain}</p>
                      <p className="text-sm text-gray-500">{site.page_views} views • {site.edits} edits</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{site.page_views}</p>
                    <p className="text-sm text-gray-500">page views</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Load Time Distribution</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Average</span>
                  <span>{data.performance.avg_load_time}ms</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Edit Time</span>
                  <span>{data.performance.avg_edit_time.toFixed(0)}ms</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Error Rate</span>
                  <span>{(data.performance.error_rate * 100).toFixed(2)}%</span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Performance Score</h3>
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600">
                    {Math.max(0, Math.min(100, 100 - (data.performance.avg_load_time / 20))).toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-500">Performance Score</div>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Simple Chart Component (would be replaced with actual charting library)
function SimpleChart({ 
  data, 
  color, 
  label 
}: { 
  data: Array<{ date: string; value: number }>;
  color: string;
  label: string;
}) {
  const maxValue = Math.max(...data.map(d => d.value));
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-gray-600">
        <span>{label}</span>
        <span>Last 30 days</span>
      </div>
      <div className="h-32 flex items-end gap-1">
        {data.slice(-30).map((point, index) => (
          <div
            key={index}
            className={`flex-1 bg-${color}-200 rounded-t`}
            style={{
              height: `${maxValue > 0 ? (point.value / maxValue) * 100 : 0}%`,
              minHeight: point.value > 0 ? '4px' : '2px'
            }}
            title={`${point.date}: ${point.value}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{data[data.length - 30]?.date || 'Start'}</span>
        <span>{data[data.length - 1]?.date || 'End'}</span>
      </div>
    </div>
  );
}