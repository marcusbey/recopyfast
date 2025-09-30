'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Check, Copy, Loader2, AlertCircle, ExternalLink } from 'lucide-react';

interface SiteRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FormData {
  name: string;
  domain: string;
  description: string;
}

interface FormErrors {
  name?: string;
  domain?: string;
  general?: string;
}

interface RegistrationResponse {
  site: {
    id: string;
    domain: string;
    name: string;
    created_at: string;
  };
  apiKey: string;
  siteToken: string;
  embedScript: string;
}

export function SiteRegistrationModal({ isOpen, onClose, onSuccess }: SiteRegistrationModalProps) {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    domain: '',
    description: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<RegistrationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const validateUrl = (url: string): boolean => {
    try {
      const urlString = url.startsWith('http') ? url : `https://${url}`;
      const urlObj = new URL(urlString);
      return !!urlObj.hostname;
    } catch {
      return false;
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Website name is required';
    }

    if (!formData.domain.trim()) {
      newErrors.domain = 'Website URL is required';
    } else if (!validateUrl(formData.domain)) {
      newErrors.domain = 'Please enter a valid domain (e.g., example.com or https://example.com)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const response = await fetch('/api/sites/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          domain: formData.domain.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 400 && data.error === 'Domain already registered') {
          setErrors({ domain: 'This domain is already registered' });
        } else {
          setErrors({ general: data.error || 'Failed to register site' });
        }
        return;
      }

      setRegistrationResult(data);
    } catch (error) {
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyScript = async () => {
    if (!registrationResult) return;

    try {
      await navigator.clipboard.writeText(registrationResult.embedScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', domain: '', description: '' });
    setErrors({});
    setRegistrationResult(null);
    setCopied(false);
    onClose();
  };

  const handleGoToDashboard = () => {
    handleClose();
    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] bg-white border border-gray-200 rounded-2xl max-h-[90vh] overflow-y-auto">
        {!registrationResult ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-gray-900">
                Register New Site
              </DialogTitle>
              <DialogDescription className="text-gray-600">
                Add a new website to start making your content editable with AI assistance.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-6 mt-6">
              {errors.general && (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-red-800">
                    {errors.general}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="name" className="text-gray-900 font-medium">
                  Website Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="My Awesome Website"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    if (errors.name) {
                      setErrors({ ...errors, name: undefined });
                    }
                  }}
                  className={errors.name ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  disabled={isLoading}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="domain" className="text-gray-900 font-medium">
                  Website URL <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="domain"
                  placeholder="example.com or https://example.com"
                  value={formData.domain}
                  onChange={(e) => {
                    setFormData({ ...formData, domain: e.target.value });
                    if (errors.domain) {
                      setErrors({ ...errors, domain: undefined });
                    }
                  }}
                  className={errors.domain ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  disabled={isLoading}
                />
                {errors.domain && (
                  <p className="text-sm text-red-500">{errors.domain}</p>
                )}
                <p className="text-sm text-gray-500">
                  Enter your website&apos;s domain name (e.g., example.com)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-gray-900 font-medium">
                  Description <span className="text-gray-500">(Optional)</span>
                </Label>
                <Input
                  id="description"
                  placeholder="Brief description of your website"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  disabled={isLoading}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    'Register Site'
                  )}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <DialogTitle className="text-2xl font-bold text-gray-900 text-center">
                Site Registered Successfully!
              </DialogTitle>
              <DialogDescription className="text-gray-600 text-center">
                Your website has been registered. Follow the steps below to integrate ReCopyFast.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 mt-6">
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-gray-900">Site Details</h3>
                <div className="space-y-1 text-sm">
                  <p className="text-gray-600">
                    <span className="font-medium">Name:</span> {registrationResult.site.name}
                  </p>
                  <p className="text-gray-600">
                    <span className="font-medium">Domain:</span> {registrationResult.site.domain}
                  </p>
                  <p className="text-gray-600">
                    <span className="font-medium">Site ID:</span>{' '}
                    <code className="bg-white px-2 py-0.5 rounded text-xs border border-gray-200">
                      {registrationResult.site.id}
                    </code>
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">Integration Instructions</h3>

                <div className="space-y-2">
                  <p className="text-sm text-gray-600 font-medium">
                    Step 1: Copy the embed script
                  </p>
                  <div className="relative">
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
                      <code>{registrationResult.embedScript}</code>
                    </pre>
                    <Button
                      size="sm"
                      variant="outline"
                      className="absolute top-2 right-2 bg-white hover:bg-gray-100"
                      onClick={handleCopyScript}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-gray-600 font-medium">
                    Step 2: Add the script to your website
                  </p>
                  <p className="text-sm text-gray-600">
                    Paste the script tag in your HTML, just before the closing{' '}
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">&lt;/body&gt;</code>{' '}
                    tag.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-gray-600 font-medium">
                    Step 3: Mark elements as editable
                  </p>
                  <p className="text-sm text-gray-600">
                    Add the{' '}
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
                      data-recopyfast-editable
                    </code>{' '}
                    attribute to any HTML element you want to make editable.
                  </p>
                  <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-xs overflow-x-auto">
                    <code>{`<h1 data-recopyfast-editable>Your Editable Heading</h1>`}</code>
                  </pre>
                </div>

                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-800 text-sm">
                    <strong>Need help?</strong> Check out our{' '}
                    <a
                      href="/docs/integration"
                      className="underline hover:text-blue-900"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      integration guide
                    </a>{' '}
                    for more details.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button
                  variant="outline"
                  onClick={handleClose}
                >
                  Close
                </Button>
                <Button
                  onClick={handleGoToDashboard}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  Go to Site Dashboard
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}