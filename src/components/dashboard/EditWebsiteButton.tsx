/**
 * Edit Website Button Component
 * Enables secure edit session creation from dashboard
 */

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Site {
  id: string;
  domain: string;
  name: string;
}

interface EditWebsiteButtonProps {
  site: Site;
  userPermissions: ('view' | 'edit' | 'admin')[];
  className?: string;
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export default function EditWebsiteButton({ 
  site, 
  userPermissions,
  className = '',
  variant = 'primary',
  size = 'md'
}: EditWebsiteButtonProps) {
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user has edit permissions
  const canEdit = userPermissions.includes('edit') || userPermissions.includes('admin');

  const createEditSession = async () => {
    if (!canEdit) {
      setError('You do not have edit permissions for this site');
      return;
    }

    setIsCreatingSession(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('Please log in to create an edit session');
        return;
      }

      // Create edit session
      const response = await fetch('/api/edit-sessions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          siteId: site.id,
          permissions: userPermissions.filter(p => p !== 'view'),
          durationHours: 2
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create edit session');
      }

      // Success! Open website with edit token
      const editUrl = `https://${site.domain}?rcf_edit_token=${data.session.token}`;
      
      // Show success message
      showSuccessNotification(data.session);
      
      // Open in new tab
      window.open(editUrl, '_blank');

    } catch (err: any) {
      console.error('Edit session creation error:', err);
      setError(err.message || 'Failed to create edit session');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const showSuccessNotification = (session: any) => {
    // Create a temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #10b981;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      transform: translateX(100%);
      transition: transform 0.3s ease;
      max-width: 400px;
    `;
    
    notification.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">✅ Edit Session Created!</div>
      <div style="font-size: 12px; opacity: 0.9;">
        Session expires: ${new Date(session.expiresAt).toLocaleString()}<br>
        Permissions: ${session.permissions.join(', ')}
      </div>
    `;
    
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 5000);
  };

  // Style variants
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white focus:ring-gray-500',
    outline: 'border border-blue-600 text-blue-600 hover:bg-blue-50 focus:ring-blue-500'
  };

  return (
    <div className="relative">
      <button
        onClick={createEditSession}
        disabled={isCreatingSession || !canEdit}
        className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
        title={canEdit ? 'Create secure edit session' : 'Insufficient permissions'}
      >
        {isCreatingSession ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Creating Session...
          </>
        ) : (
          <>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Website
          </>
        )}
      </button>

      {/* Error display */}
      {error && (
        <div className="absolute top-full left-0 mt-2 p-3 bg-red-50 border border-red-200 rounded-md shadow-sm z-10 min-w-max">
          <div className="flex items-center">
            <svg className="w-4 h-4 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-red-600">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="absolute top-1 right-1 text-red-400 hover:text-red-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Permission indicator for non-editors */}
      {!canEdit && (
        <div className="absolute top-full left-0 mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md shadow-sm z-10">
          <div className="flex items-center">
            <svg className="w-4 h-4 text-yellow-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-xs text-yellow-600">View-only access</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for displaying active sessions
export function ActiveEditSessions({ siteId }: { siteId: string }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActiveSessions = async () => {
    try {
      const response = await fetch('/api/edit-sessions/active');
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions.filter((s: any) => s.siteId === siteId));
      }
    } catch (error) {
      console.error('Failed to load active sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-32"></div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No active edit sessions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-gray-700">
        Active Edit Sessions ({sessions.length})
      </div>
      {sessions.map((session) => (
        <div key={session.id} className="flex items-center justify-between p-2 bg-green-50 border border-green-200 rounded">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            <span className="text-sm text-green-700">
              Expires in {session.timeRemainingMinutes} minutes
            </span>
          </div>
          <div className="text-xs text-green-600">
            {session.permissions.join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
}