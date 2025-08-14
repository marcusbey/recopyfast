import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  canCreateWebsite, 
  canUseAIFeatures, 
  canUseTranslation,
  consumeFeatureUsage 
} from '@/lib/feature-gating/permissions';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  insert: jest.fn(),
  rpc: jest.fn()
};

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue(mockSupabase)
}));

// Mock Stripe functions
jest.mock('@/lib/stripe/subscription', () => ({
  getUserSubscription: jest.fn(),
}));

jest.mock('@/lib/stripe/tickets', () => ({
  getUserTicketBalance: jest.fn(),
  consumeTickets: jest.fn(),
}));

import { getUserSubscription } from '@/lib/stripe/subscription';
import { getUserTicketBalance, consumeTickets } from '@/lib/stripe/tickets';

describe('Feature Gating Permissions', () => {
  const testUserId = 'test-user-id';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('canCreateWebsite', () => {
    it('should allow website creation for pro plan with unlimited websites', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue({
        plan_id: 'pro'
      });

      mockSupabase.single.mockResolvedValue({ count: 5 });

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
    });

    it('should allow website creation for free plan within limit', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      mockSupabase.single.mockResolvedValue({ count: 0 });

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(0);
      expect(result.maxLimit).toBe(1);
    });

    it('should deny website creation for free plan at limit', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      mockSupabase.single.mockResolvedValue({ count: 1 });

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain('limit of 1 website');
    });
  });

  describe('canUseAIFeatures', () => {
    it('should allow AI features for pro plan', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue({
        plan_id: 'pro'
      });

      const result = await canUseAIFeatures(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresTickets).toBeFalsy();
    });

    it('should allow AI features for free plan with sufficient tickets', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      (getUserTicketBalance as jest.Mock).mockResolvedValue(5);

      const result = await canUseAIFeatures(testUserId, 2);

      expect(result.allowed).toBe(true);
      expect(result.requiresTickets).toBe(true);
      expect(result.ticketsRequired).toBe(2);
    });

    it('should deny AI features for free plan without tickets', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      (getUserTicketBalance as jest.Mock).mockResolvedValue(0);

      const result = await canUseAIFeatures(testUserId, 1);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.requiresTickets).toBe(true);
      expect(result.reason).toContain('require a Pro or Enterprise plan');
    });
  });

  describe('canUseTranslation', () => {
    it('should allow translations for pro plan', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue({
        plan_id: 'pro'
      });

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
    });

    it('should allow translations for free plan with tickets', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      (getUserTicketBalance as jest.Mock).mockResolvedValue(3);

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresTickets).toBe(true);
      expect(result.ticketsRequired).toBe(1);
    });
  });

  describe('consumeFeatureUsage', () => {
    it('should consume tickets for free plan AI usage', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      (getUserTicketBalance as jest.Mock).mockResolvedValue(5);
      (consumeTickets as jest.Mock).mockResolvedValue(true);

      mockSupabase.insert.mockResolvedValue({ error: null });

      const result = await consumeFeatureUsage(testUserId, 'ai_suggestion', {
        context: 'test'
      });

      expect(result.success).toBe(true);
      expect(consumeTickets).toHaveBeenCalledWith(testUserId, 1, 'ai_suggestion usage');
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        user_id: testUserId,
        feature_type: 'ai_suggestion',
        count: 1,
        metadata: { context: 'test' }
      });
    });

    it('should not consume tickets for pro plan usage', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue({
        plan_id: 'pro'
      });

      mockSupabase.insert.mockResolvedValue({ error: null });

      const result = await consumeFeatureUsage(testUserId, 'ai_suggestion');

      expect(result.success).toBe(true);
      expect(consumeTickets).not.toHaveBeenCalled();
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should fail when insufficient tickets', async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);
      (getUserTicketBalance as jest.Mock).mockResolvedValue(0);

      const result = await consumeFeatureUsage(testUserId, 'ai_suggestion');

      expect(result.success).toBe(false);
      expect(result.error).toContain('require a Pro or Enterprise plan');
    });
  });
});