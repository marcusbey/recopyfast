'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Globe,
  FileText,
  BarChart3,
  Users,
  Settings,
  CreditCard,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  requiresPlan?: 'pro' | 'enterprise';
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Sites',
    href: '/dashboard/sites',
    icon: Globe,
  },
  {
    label: 'Content',
    href: '/dashboard/content',
    icon: FileText,
  },
  {
    label: 'Analytics',
    href: '/dashboard/analytics',
    icon: BarChart3,
  },
  {
    label: 'Teams',
    href: '/dashboard/teams',
    icon: Users,
    badge: 'Pro',
    badgeVariant: 'secondary',
    requiresPlan: 'pro',
  },
  {
    label: 'Settings',
    href: '/dashboard/settings',
    icon: Settings,
  },
  {
    label: 'Billing',
    href: '/dashboard/billing',
    icon: CreditCard,
  },
];

interface DashboardNavigationProps {
  userPlan?: 'free' | 'pro' | 'enterprise';
  className?: string;
}

export function DashboardNavigation({ userPlan = 'free', className }: DashboardNavigationProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const canAccessItem = (item: NavItem) => {
    if (!item.requiresPlan) return true;
    if (userPlan === 'enterprise') return true;
    if (item.requiresPlan === 'pro' && (userPlan === 'pro' || userPlan === 'enterprise')) return true;
    return false;
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href);
    const accessible = canAccessItem(item);
    const Icon = item.icon;

    return (
      <Link
        href={accessible ? item.href : '#'}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
          'hover:bg-gray-100',
          active && 'bg-gradient-to-r from-blue-50 to-purple-50 text-blue-600 hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50',
          !active && 'text-gray-700 hover:text-gray-900',
          !accessible && 'opacity-50 cursor-not-allowed'
        )}
        onClick={(e) => {
          if (!accessible) {
            e.preventDefault();
          }
          if (isMobileMenuOpen) {
            setIsMobileMenuOpen(false);
          }
        }}
      >
        <Icon className={cn('w-5 h-5', active && 'text-blue-600')} />
        <span className="flex-1">{item.label}</span>
        {item.badge && (
          <Badge variant={item.badgeVariant || 'default'} className="text-xs">
            {item.badge}
          </Badge>
        )}
        {active && <ChevronRight className="w-4 h-4" />}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden fixed top-4 left-4 z-50"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </Button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <nav
        className={cn(
          'fixed left-0 top-0 h-screen bg-white border-r border-gray-200 z-40 transition-transform duration-300',
          'lg:translate-x-0 lg:w-64',
          isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full',
          className
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo/Brand */}
          <div className="p-6 border-b border-gray-200">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">RF</span>
              </div>
              <span className="font-bold text-xl text-gray-900">ReCopyFast</span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>

          {/* Plan Badge */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="text-xs text-gray-600">Current Plan</p>
                <p className="text-sm font-semibold text-gray-900 capitalize">{userPlan}</p>
              </div>
              {userPlan === 'free' && (
                <Link href="/dashboard/billing">
                  <Button size="sm" variant="outline" className="text-xs">
                    Upgrade
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}