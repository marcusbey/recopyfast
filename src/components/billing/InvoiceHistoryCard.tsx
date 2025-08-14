'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Invoice } from '@/types/billing';

interface InvoiceHistoryCardProps {
  invoices: Invoice[];
}

export function InvoiceHistoryCard({ invoices }: InvoiceHistoryCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatAmount = (amount: number) => {
    return (amount / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  };

  const getStatusBadge = (status: string) => {
    const variant = status === 'paid' ? 'default' :
                   status === 'open' ? 'secondary' :
                   status === 'draft' ? 'outline' :
                   'destructive';

    return <Badge variant={variant}>{status.toUpperCase()}</Badge>;
  };

  return (
    <Card className="p-6">
      <h3 className="text-xl font-semibold mb-4">Invoice History</h3>

      {invoices.length > 0 ? (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <div
              key={invoice.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-medium">
                    Invoice #{invoice.stripe_invoice_id.slice(-8)}
                  </span>
                  {getStatusBadge(invoice.status)}
                </div>
                <div className="text-sm text-gray-600">
                  {invoice.period_start && invoice.period_end ? (
                    <span>
                      {formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}
                    </span>
                  ) : (
                    <span>Issued {formatDate(invoice.created_at)}</span>
                  )}
                </div>
              </div>

              <div className="text-right">
                <div className="font-semibold">
                  {formatAmount(invoice.amount_paid || invoice.amount_due)}
                </div>
                {invoice.hosted_invoice_url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(invoice.hosted_invoice_url, '_blank')}
                    className="text-blue-600 hover:text-blue-700 p-0 h-auto"
                  >
                    View PDF
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No invoices yet</p>
          <p className="text-sm">Your billing history will appear here</p>
        </div>
      )}
    </Card>
  );
}