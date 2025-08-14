/**
 * Global Error Boundary Component
 * Catches React errors and displays user-friendly error messages
 */

'use client';

import React, { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import { logger } from '@/lib/monitoring/logger';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
  isolate?: boolean;
  level?: 'page' | 'section' | 'component';
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  errorId?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null;
  private previousResetKeys: Array<string | number> = [];

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
    this.previousResetKeys = props.resetKeys || [];
  }

  static getDerivedStateFromError(error: Error): State {
    const errorId = Math.random().toString(36).substring(7);
    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidUpdate() {
    const { resetKeys = [], resetOnPropsChange = true } = this.props;
    const hasResetKeysChanged = resetKeys.some(
      (key, index) => key !== this.previousResetKeys[index]
    );

    if (resetOnPropsChange && hasResetKeysChanged) {
      this.resetErrorBoundary();
      this.previousResetKeys = resetKeys;
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { onError, level = 'component' } = this.props;
    const { errorId } = this.state;

    // Log error
    logger.error('React Error Boundary caught error', error, undefined, {
      component: 'ErrorBoundary',
      errorId,
      level,
      componentStack: errorInfo.componentStack,
    });

    // Report to Sentry
    Sentry.withScope((scope) => {
      scope.setTag('error_boundary', true);
      scope.setTag('error_boundary_level', level);
      scope.setContext('error_info', {
        componentStack: errorInfo.componentStack,
        errorId,
      });
      Sentry.captureException(error);
    });

    // Call custom error handler
    onError?.(error, errorInfo);

    // Update state with error info
    this.setState({ errorInfo });

    // Auto-recover for component-level errors after 10 seconds
    if (level === 'component' && !this.props.isolate) {
      this.resetTimeoutId = window.setTimeout(() => {
        this.resetErrorBoundary();
      }, 10000);
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }
  }

  resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    const { hasError, error, errorId } = this.state;
    const { children, fallback, level = 'component' } = this.props;

    if (hasError && error) {
      // Custom fallback
      if (fallback) {
        return <>{fallback}</>;
      }

      // Default error UI based on level
      return (
        <div className={`
          flex flex-col items-center justify-center
          ${level === 'page' ? 'min-h-screen' : ''}
          ${level === 'section' ? 'min-h-[400px]' : ''}
          ${level === 'component' ? 'min-h-[200px]' : ''}
          p-8 text-center
        `}>
          <div className="max-w-md mx-auto">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              {level === 'page' && 'Something went wrong'}
              {level === 'section' && 'This section encountered an error'}
              {level === 'component' && 'Component error'}
            </h2>
            
            <p className="text-gray-600 mb-6">
              {level === 'page' && 'We apologize for the inconvenience. The error has been reported and we\'re working on fixing it.'}
              {level === 'section' && 'This section couldn\'t load properly. You can try refreshing or continue using other parts of the app.'}
              {level === 'component' && 'This component encountered an issue but the rest of the page should work fine.'}
            </p>

            {/* Error details in development */}
            {process.env.NODE_ENV === 'development' && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Error details
                </summary>
                <div className="mt-2 p-4 bg-gray-100 rounded-md">
                  <p className="text-xs font-mono text-gray-700 break-all">
                    {error.message}
                  </p>
                  {errorId && (
                    <p className="text-xs text-gray-500 mt-2">
                      Error ID: {errorId}
                    </p>
                  )}
                </div>
              </details>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                onClick={this.resetErrorBoundary}
                className="flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                Try again
              </Button>
              
              {level === 'page' && (
                <Button
                  variant="default"
                  onClick={() => window.location.href = '/'}
                  className="flex items-center gap-2"
                >
                  <Home className="w-4 h-4" />
                  Go home
                </Button>
              )}
            </div>

            {/* Error ID for support */}
            {errorId && level !== 'component' && (
              <p className="text-xs text-gray-500 mt-6">
                If the problem persists, please contact support with error ID: {errorId}
              </p>
            )}
          </div>
        </div>
      );
    }

    return children;
  }
}

// Async Error Boundary for handling async errors
export function AsyncErrorBoundary({ 
  children, 
  fallback 
}: { 
  children: ReactNode; 
  fallback?: ReactNode;
}) {
  return (
    <ErrorBoundary 
      fallback={fallback}
      level="component"
      onError={(error) => {
        // Check if it's an async error
        if (error.message.includes('async')) {
          logger.error('Async error in component', error);
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

// HOC for wrapping components with error boundary
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}