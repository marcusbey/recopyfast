'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PurchaseTicketsDialog } from './PurchaseTicketsDialog';
import type { Tickets, TicketTransaction } from '@/types/billing';

interface TicketBalanceCardProps {
  tickets?: Tickets;
  recentTransactions: TicketTransaction[];
  onUpdate: () => void;
}

export function TicketBalanceCard({ tickets, recentTransactions, onUpdate }: TicketBalanceCardProps) {
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);

  const balance = tickets?.balance || 0;
  const totalPurchased = tickets?.total_purchased || 0;
  const totalConsumed = tickets?.total_consumed || 0;

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'purchase':
        return (
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
        );
      case 'consumption':
        return (
          <div className="w-2 h-2 rounded-full bg-red-500"></div>
        );
      case 'refund':
        return (
          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
        );
      default:
        return (
          <div className="w-2 h-2 rounded-full bg-gray-500"></div>
        );
    }
  };

  const formatTransactionAmount = (transaction: TicketTransaction) => {
    const prefix = transaction.type === 'consumption' ? '' : '+';
    return `${prefix}${Math.abs(transaction.amount)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card className="p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">AI Tickets</h3>
          <p className="text-gray-600 mt-1">Pay-per-use for AI features</p>
        </div>
        <Button 
          onClick={() => setShowPurchaseDialog(true)}
          size="sm"
        >
          Buy Tickets
        </Button>
      </div>

      <div className="space-y-4">
        <div className="text-center p-4 bg-blue-50 rounded-lg">
          <div className="text-3xl font-bold text-blue-600">{balance}</div>
          <div className="text-sm text-gray-600">Available Tickets</div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="font-semibold">{totalPurchased}</div>
            <div className="text-gray-600">Total Purchased</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="font-semibold">{totalConsumed}</div>
            <div className="text-gray-600">Total Used</div>
          </div>
        </div>

        {balance < 5 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center text-yellow-700">
              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium">Low ticket balance</span>
            </div>
            <p className="text-sm text-yellow-600 mt-1">
              Purchase more tickets to continue using AI features
            </p>
          </div>
        )}

        <div>
          <h4 className="font-medium mb-3">Recent Activity</h4>
          {recentTransactions.length > 0 ? (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {recentTransactions.slice(0, 5).map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {getTransactionIcon(transaction.type)}
                    <span className="truncate">
                      {transaction.description || transaction.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={transaction.type === 'consumption' ? 'destructive' : 'default'}
                      className="text-xs"
                    >
                      {formatTransactionAmount(transaction)}
                    </Badge>
                    <span className="text-gray-500 text-xs">
                      {formatDate(transaction.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">
              No ticket activity yet
            </p>
          )}
        </div>
      </div>

      <PurchaseTicketsDialog
        open={showPurchaseDialog}
        onOpenChange={setShowPurchaseDialog}
        onSuccess={onUpdate}
      />
    </Card>
  );
}