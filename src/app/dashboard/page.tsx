'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart3, Globe, Users, Zap, Plus, ArrowRight, FileText, Settings as SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { SiteRegistrationModal } from '@/components/dashboard/SiteRegistrationModal';

export default function DashboardPage() {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSiteRegistrationSuccess = () => {
    // TODO: Refresh the sites list when we implement it
  };

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Welcome back{user?.user_metadata?.name ? `, ${user.user_metadata.name}` : ''}!
        </h1>
        <p className="text-gray-600">
          Manage your sites and view analytics from your dashboard.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { icon: Globe, label: 'Active Sites', value: '0', color: 'from-blue-500 to-cyan-500', href: '/dashboard/sites' },
          { icon: Users, label: 'Total Edits', value: '0', color: 'from-purple-500 to-pink-500', href: '/dashboard/content' },
          { icon: Zap, label: 'AI Suggestions', value: '0', color: 'from-yellow-500 to-orange-500', href: '/dashboard/content' },
          { icon: BarChart3, label: 'This Month', value: '0', color: 'from-green-500 to-emerald-500', href: '/dashboard/analytics' },
        ].map((stat, index) => (
          <Link key={index} href={stat.href}>
            <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  </div>
                  <div className={`w-12 h-12 bg-gradient-to-r ${stat.color} rounded-xl flex items-center justify-center`}>
                    <stat.icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Sites Section */}
      <Card className="border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Sites</CardTitle>
              <CardDescription>Manage your connected websites</CardDescription>
            </div>
            <Button
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add New Site
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Empty State */}
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Globe className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No sites yet</h3>
            <p className="text-gray-600 mb-6 max-w-sm mx-auto">
              Add your first site to start making your content editable with AI assistance.
            </p>
            <Button
              variant="outline"
              onClick={() => setIsModalOpen(true)}
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions - Navigate to different sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link href="/dashboard/sites">
          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center mb-4">
                <Globe className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Manage Sites</h3>
              <p className="text-sm text-gray-600">View and configure your registered websites.</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/content">
          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Content Library</h3>
              <p className="text-sm text-gray-600">Browse and edit your site content.</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/analytics">
          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">View Analytics</h3>
              <p className="text-sm text-gray-600">Monitor performance and engagement.</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/settings">
          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl flex items-center justify-center mb-4">
                <SettingsIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Settings</h3>
              <p className="text-sm text-gray-600">Customize your account preferences.</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <SiteRegistrationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSiteRegistrationSuccess}
      />
    </div>
  );
}