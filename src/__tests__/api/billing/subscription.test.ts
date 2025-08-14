import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { GET, POST, PUT, DELETE } from '@/app/api/billing/subscription/route';

// Mock Supabase client
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null
      })
    }
  })
}));

// Mock Stripe functions
jest.mock('@/lib/stripe/subscription', () => ({
  getUserSubscription: jest.fn(),
  createSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
}));

import { 
  getUserSubscription, 
  createSubscription, 
  updateSubscription,
  cancelSubscription 
} from '@/lib/stripe/subscription';

describe('/api/billing/subscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET', () => {
    it('should return user subscription', async () => {
      const mockSubscription = {
        id: 'sub-123',
        plan_id: 'pro',
        status: 'active'
      };

      (getUserSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(getUserSubscription).toHaveBeenCalledWith('test-user-id');
    });

    it('should return null subscription for users without subscription', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toBeNull();
    });
  });

  describe('POST', () => {
    it('should create a new subscription', async () => {
      const mockSubscription = {
        id: 'sub-123',
        plan_id: 'pro',
        status: 'active'
      };

      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      (createSubscription as jest.Mock).mockResolvedValue({
        subscription: mockSubscription
      });

      const request = new NextRequest('http://localhost:3000/api/billing/subscription', {
        method: 'POST',
        body: JSON.stringify({
          planId: 'pro',
          paymentMethodId: 'pm_test_123'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(createSubscription).toHaveBeenCalledWith(
        'test-user-id',
        'test@example.com',
        'pro',
        'pm_test_123',
        undefined
      );
    });

    it('should reject invalid plan IDs', async () => {
      const request = new NextRequest('http://localhost:3000/api/billing/subscription', {
        method: 'POST',
        body: JSON.stringify({
          planId: 'invalid-plan'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid plan ID');
    });

    it('should reject users with existing active subscription', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue({
        status: 'active'
      });

      const request = new NextRequest('http://localhost:3000/api/billing/subscription', {
        method: 'POST',
        body: JSON.stringify({
          planId: 'pro'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('User already has an active subscription');
    });
  });

  describe('PUT', () => {
    it('should update existing subscription', async () => {
      const mockSubscription = {
        id: 'sub-123',
        plan_id: 'enterprise',
        status: 'active'
      };

      (updateSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const request = new NextRequest('http://localhost:3000/api/billing/subscription', {
        method: 'PUT',
        body: JSON.stringify({
          planId: 'enterprise'
        })
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(updateSubscription).toHaveBeenCalledWith('test-user-id', {
        planId: 'enterprise',
        paymentMethodId: undefined
      });
    });
  });

  describe('DELETE', () => {
    it('should cancel subscription at period end', async () => {
      const mockSubscription = {
        id: 'sub-123',
        plan_id: 'pro',
        status: 'active',
        cancel_at_period_end: true
      };

      (cancelSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const request = new NextRequest('http://localhost:3000/api/billing/subscription');

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(cancelSubscription).toHaveBeenCalledWith('test-user-id', false);
    });

    it('should cancel subscription immediately when requested', async () => {
      const mockSubscription = {
        id: 'sub-123',
        plan_id: 'pro',
        status: 'canceled'
      };

      (cancelSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const request = new NextRequest('http://localhost:3000/api/billing/subscription?immediate=true');

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(cancelSubscription).toHaveBeenCalledWith('test-user-id', true);
    });
  });
});