'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Globe, Users, Zap, Plus, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="container mx-auto px-6 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome back{user?.user_metadata?.name ? `, ${user.user_metadata.name}` : ''}!
          </h1>
          <p className="text-gray-600">
            Manage your sites and view analytics from your dashboard.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[
            { icon: Globe, label: 'Active Sites', value: '0', color: 'from-blue-500 to-cyan-500' },
            { icon: Users, label: 'Total Edits', value: '0', color: 'from-purple-500 to-pink-500' },
            { icon: Zap, label: 'AI Suggestions', value: '0', color: 'from-yellow-500 to-orange-500' },
            { icon: BarChart3, label: 'This Month', value: '0', color: 'from-green-500 to-emerald-500' },
          ].map((stat, index) => (
            <Card key={index} className="border-gray-200">
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
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
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
              <Button variant="outline">
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Badge className="mb-4 bg-blue-100 text-blue-700 border-blue-200">Documentation</Badge>
              <h3 className="font-semibold text-gray-900 mb-2">Integration Guide</h3>
              <p className="text-sm text-gray-600">Learn how to integrate ReCopyFast into your website.</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Badge className="mb-4 bg-purple-100 text-purple-700 border-purple-200">AI Features</Badge>
              <h3 className="font-semibold text-gray-900 mb-2">AI Configuration</h3>
              <p className="text-sm text-gray-600">Configure AI suggestions and translation settings.</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Badge className="mb-4 bg-green-100 text-green-700 border-green-200">Support</Badge>
              <h3 className="font-semibold text-gray-900 mb-2">Need Help?</h3>
              <p className="text-sm text-gray-600">Contact our support team or browse FAQs.</p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}