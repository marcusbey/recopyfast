'use client';

import React, { useState, useEffect } from 'react';
import { CollaborationNotification, NotificationType } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { 
  Bell, 
  MoreHorizontal,
  Check,
  CheckCircle,
  Mail,
  Users,
  Shield,
  Edit,
  AlertCircle,
  Globe
} from 'lucide-react';

interface NotificationCenterProps {
  showAll?: boolean;
  limit?: number;
}

export function NotificationCenter({ showAll = false, limit = 10 }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<CollaborationNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string[]>([]);

  useEffect(() => {
    loadNotifications();
  }, [showAll, limit]);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (!showAll) params.append('unread_only', 'true');
      params.append('limit', limit.toString());
      
      const response = await fetch(`/api/notifications?${params}`);
      if (response.ok) {
        const { notifications } = await response.json();
        setNotifications(notifications);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationIds: string[]) => {
    try {
      setMarking(notificationIds);
      
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notificationIds,
          markAsRead: true,
        }),
      });

      if (response.ok) {
        setNotifications(prev => 
          prev.map(notification => 
            notificationIds.includes(notification.id)
              ? { ...notification, read_at: new Date().toISOString() }
              : notification
          )
        );
      }
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    } finally {
      setMarking([]);
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications
      .filter(n => !n.read_at)
      .map(n => n.id);
    
    if (unreadIds.length > 0) {
      await markAsRead(unreadIds);
    }
  };

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'invitation':
        return <Mail className="h-4 w-4 text-blue-600" />;
      case 'permission_change':
        return <Shield className="h-4 w-4 text-yellow-600" />;
      case 'content_edit':
        return <Edit className="h-4 w-4 text-green-600" />;
      case 'team_update':
        return <Users className="h-4 w-4 text-purple-600" />;
      case 'site_shared':
        return <Globe className="h-4 w-4 text-indigo-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getNotificationColor = (type: NotificationType) => {
    switch (type) {
      case 'invitation':
        return 'bg-blue-50 border-blue-200';
      case 'permission_change':
        return 'bg-yellow-50 border-yellow-200';
      case 'content_edit':
        return 'bg-green-50 border-green-200';
      case 'team_update':
        return 'bg-purple-50 border-purple-200';
      case 'site_shared':
        return 'bg-indigo-50 border-indigo-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const formatNotificationType = (type: NotificationType) => {
    switch (type) {
      case 'invitation':
        return 'Invitation';
      case 'permission_change':
        return 'Permissions';
      case 'content_edit':
        return 'Content Edit';
      case 'team_update':
        return 'Team Update';
      case 'site_shared':
        return 'Site Shared';
      default:
        return 'Notification';
    }
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const unreadCount = notifications.filter(n => !n.read_at).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin h-6 w-6 border-b-2 border-blue-600 rounded-full mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading notifications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-gray-700" />
          <h3 className="font-medium text-gray-900">Notifications</h3>
          {unreadCount > 0 && (
            <Badge variant="secondary">{unreadCount}</Badge>
          )}
        </div>
        
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllAsRead}
            className="text-blue-600 hover:text-blue-700"
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Mark all read
          </Button>
        )}
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <Bell className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600">No notifications</p>
            <p className="text-sm text-gray-500">
              {showAll ? 'You have no notifications.' : 'All caught up!'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <Card
              key={notification.id}
              className={`transition-all ${
                !notification.read_at
                  ? `${getNotificationColor(notification.type)} shadow-sm`
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {getNotificationIcon(notification.type)}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-gray-900 text-sm">
                            {notification.title}
                          </h4>
                          <Badge variant="outline" className="text-xs">
                            {formatNotificationType(notification.type)}
                          </Badge>
                          {!notification.read_at && (
                            <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                          )}
                        </div>
                        <p className="text-gray-600 text-sm">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatRelativeTime(notification.created_at)}
                        </p>
                      </div>
                      
                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!notification.read_at ? (
                            <DropdownMenuItem
                              onClick={() => markAsRead([notification.id])}
                              disabled={marking.includes(notification.id)}
                            >
                              <Check className="h-4 w-4 mr-2" />
                              Mark as read
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => markAsRead([notification.id])}
                              disabled={marking.includes(notification.id)}
                            >
                              <Mail className="h-4 w-4 mr-2" />
                              Mark as unread
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Notification Bell Component for Header
export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<CollaborationNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    loadUnreadCount();
  }, []);

  const loadUnreadCount = async () => {
    try {
      const response = await fetch('/api/notifications?unread_only=true&limit=5');
      if (response.ok) {
        const { notifications } = await response.json();
        setNotifications(notifications);
        setUnreadCount(notifications.length);
      }
    } catch (error) {
      console.error('Error loading unread notifications:', error);
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Notifications</h3>
            {unreadCount > 0 && (
              <Badge variant="secondary">{unreadCount}</Badge>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <NotificationCenter showAll={false} limit={5} />
        </div>
        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setIsOpen(false);
              // Navigate to full notifications page
              window.location.href = '/dashboard?tab=notifications';
            }}
          >
            View all notifications
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}