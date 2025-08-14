import {
  MemoryRateLimiter,
  createRateLimitConfig,
  AbuseDetector,
  RATE_LIMIT_CONFIGS
} from '@/lib/security/rate-limiter';

// Mock Redis for testing
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    multi: jest.fn(() => ({
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      exec: jest.fn(() => Promise.resolve([1, 'OK', 3600]))
    })),
    del: jest.fn(),
    keys: jest.fn(() => Promise.resolve([])),
    on: jest.fn()
  }))
}));

describe('Rate Limiter', () => {
  describe('MemoryRateLimiter', () => {
    let rateLimiter: MemoryRateLimiter;

    beforeEach(() => {
      rateLimiter = new MemoryRateLimiter();
    });

    describe('checkLimit', () => {
      it('should allow requests within limit', async () => {
        const config = {
          windowMs: 60000, // 1 minute
          maxRequests: 10,
          identifier: 'user123',
          identifierType: 'user' as const,
          endpoint: '/api/test'
        };

        const result = await rateLimiter.checkLimit(config);
        
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9);
        expect(result.totalRequests).toBe(1);
        expect(result.resetTime).toBeGreaterThan(Date.now());
      });

      it('should block requests over limit', async () => {
        const config = {
          windowMs: 60000,
          maxRequests: 2,
          identifier: 'user123',
          identifierType: 'user' as const,
          endpoint: '/api/test'
        };

        // First two requests should be allowed
        let result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(1);

        result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(0);

        // Third request should be blocked
        result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      });

      it('should reset window after expiration', async () => {
        const config = {
          windowMs: 100, // 100ms window for testing
          maxRequests: 1,
          identifier: 'user123',
          identifierType: 'user' as const,
          endpoint: '/api/test'
        };

        // First request should be allowed
        let result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);

        // Second request should be blocked
        result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(false);

        // Wait for window to expire
        await new Promise(resolve => setTimeout(resolve, 150));

        // Request should be allowed again
        result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);
      });

      it('should track different identifiers separately', async () => {
        const config1 = {
          windowMs: 60000,
          maxRequests: 1,
          identifier: 'user1',
          identifierType: 'user' as const,
          endpoint: '/api/test'
        };

        const config2 = {
          ...config1,
          identifier: 'user2'
        };

        // User1's first request
        let result = await rateLimiter.checkLimit(config1);
        expect(result.allowed).toBe(true);

        // User1's second request should be blocked
        result = await rateLimiter.checkLimit(config1);
        expect(result.allowed).toBe(false);

        // User2's first request should still be allowed
        result = await rateLimiter.checkLimit(config2);
        expect(result.allowed).toBe(true);
      });

      it('should track different endpoints separately', async () => {
        const config1 = {
          windowMs: 60000,
          maxRequests: 1,
          identifier: 'user123',
          identifierType: 'user' as const,
          endpoint: '/api/endpoint1'
        };

        const config2 = {
          ...config1,
          endpoint: '/api/endpoint2'
        };

        // First endpoint request
        let result = await rateLimiter.checkLimit(config1);
        expect(result.allowed).toBe(true);

        // Second request to same endpoint should be blocked
        result = await rateLimiter.checkLimit(config1);
        expect(result.allowed).toBe(false);

        // Request to different endpoint should be allowed
        result = await rateLimiter.checkLimit(config2);
        expect(result.allowed).toBe(true);
      });
    });

    describe('resetLimit', () => {
      it('should reset specific identifier limit', async () => {
        const config = {
          windowMs: 60000,
          maxRequests: 1,
          identifier: 'user123',
          identifierType: 'user' as const,
          endpoint: '/api/test'
        };

        // Use up the limit
        await rateLimiter.checkLimit(config);
        let result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(false);

        // Reset the limit
        await rateLimiter.resetLimit(config);

        // Should be allowed again
        result = await rateLimiter.checkLimit(config);
        expect(result.allowed).toBe(true);
      });
    });

    describe('clearAll', () => {
      it('should clear all rate limit data', async () => {
        const config = {
          windowMs: 60000,
          maxRequests: 1,
          identifier: 'user123',
          identifierType: 'user' as const,
          endpoint: '/api/test'
        };

        // Use up the limit
        await rateLimiter.checkLimit(config);
        await rateLimiter.checkLimit(config);

        const stats = rateLimiter.getStats();
        expect(stats.totalKeys).toBeGreaterThan(0);

        // Clear all
        await rateLimiter.clearAll();

        const newStats = rateLimiter.getStats();
        expect(newStats.totalKeys).toBe(0);
      });
    });
  });

  describe('createRateLimitConfig', () => {
    it('should create config with predefined limits', () => {
      const config = createRateLimitConfig('user123', 'user', 'USER_GENERAL', '/api/test');
      
      expect(config.identifier).toBe('user123');
      expect(config.identifierType).toBe('user');
      expect(config.endpoint).toBe('/api/test');
      expect(config.windowMs).toBe(RATE_LIMIT_CONFIGS.USER_GENERAL.windowMs);
      expect(config.maxRequests).toBe(RATE_LIMIT_CONFIGS.USER_GENERAL.maxRequests);
    });

    it('should handle different identifier types', () => {
      const userConfig = createRateLimitConfig('user123', 'user', 'USER_GENERAL');
      const ipConfig = createRateLimitConfig('192.168.1.1', 'ip', 'IP_GENERAL');
      const apiConfig = createRateLimitConfig('api_key_123', 'api_key', 'API_KEY_DEFAULT');

      expect(userConfig.identifierType).toBe('user');
      expect(ipConfig.identifierType).toBe('ip');
      expect(apiConfig.identifierType).toBe('api_key');
    });
  });

  describe('AbuseDetector', () => {
    let abuseDetector: AbuseDetector;

    beforeEach(() => {
      abuseDetector = new AbuseDetector();
    });

    describe('detectRapidRequests', () => {
      it('should detect rapid requests', () => {
        const identifier = 'user123';

        // Normal request should not be suspicious
        let result = abuseDetector.detectRapidRequests(identifier);
        expect(result.isSuspicious).toBe(false);
        expect(result.shouldBan).toBe(false);

        // Simulate rapid requests
        for (let i = 0; i < 60; i++) {
          result = abuseDetector.detectRapidRequests(identifier);
        }

        expect(result.isSuspicious).toBe(true);
        expect(result.shouldBan).toBe(true);
      });

      it('should reset counter after time window', async () => {
        const identifier = 'user123';

        // Create some rapid requests
        for (let i = 0; i < 30; i++) {
          abuseDetector.detectRapidRequests(identifier);
        }

        // Wait longer than the time window (simulate)
        // In real implementation, this would use the actual time window
        await new Promise(resolve => setTimeout(resolve, 15));

        // Counter should reset for new time window
        const result = abuseDetector.detectRapidRequests(identifier);
        expect(result.isSuspicious).toBe(false);
      });

      it('should track different identifiers separately', () => {
        // Make user1 suspicious
        for (let i = 0; i < 60; i++) {
          abuseDetector.detectRapidRequests('user1');
        }

        const user1Result = abuseDetector.detectRapidRequests('user1');
        expect(user1Result.isSuspicious).toBe(true);

        // User2 should not be affected
        const user2Result = abuseDetector.detectRapidRequests('user2');
        expect(user2Result.isSuspicious).toBe(false);
      });
    });

    describe('isCurrentlyBanned', () => {
      it('should return ban status', () => {
        const identifier = 'user123';

        // Initially not banned
        expect(abuseDetector.isCurrentlyBanned(identifier)).toBe(false);

        // Make enough requests to trigger ban
        for (let i = 0; i < 200; i++) { // Exceed ban threshold
          abuseDetector.detectRapidRequests(identifier);
        }

        // Should be banned now
        expect(abuseDetector.isCurrentlyBanned(identifier)).toBe(true);
      });

      it('should handle non-existent identifiers', () => {
        expect(abuseDetector.isCurrentlyBanned('nonexistent')).toBe(false);
      });
    });

    describe('clearSuspiciousActivity', () => {
      it('should clear specific identifier', () => {
        const identifier = 'user123';

        // Create suspicious activity
        for (let i = 0; i < 60; i++) {
          abuseDetector.detectRapidRequests(identifier);
        }

        expect(abuseDetector.isCurrentlyBanned(identifier)).toBe(true);

        // Clear activity
        abuseDetector.clearSuspiciousActivity(identifier);

        expect(abuseDetector.isCurrentlyBanned(identifier)).toBe(false);
      });

      it('should clear all activities when no identifier provided', () => {
        // Create activity for multiple users
        for (let i = 0; i < 60; i++) {
          abuseDetector.detectRapidRequests('user1');
          abuseDetector.detectRapidRequests('user2');
        }

        const activities = abuseDetector.getSuspiciousActivities();
        expect(activities.length).toBeGreaterThan(0);

        // Clear all
        abuseDetector.clearSuspiciousActivity();

        const newActivities = abuseDetector.getSuspiciousActivities();
        expect(newActivities.length).toBe(0);
      });
    });

    describe('getSuspiciousActivities', () => {
      it('should return suspicious activities', () => {
        // Create activity for multiple users
        for (let i = 0; i < 30; i++) {
          abuseDetector.detectRapidRequests('user1');
        }
        for (let i = 0; i < 40; i++) {
          abuseDetector.detectRapidRequests('user2');
        }

        const activities = abuseDetector.getSuspiciousActivities();
        
        expect(activities.length).toBe(2);
        expect(activities.find(a => a.identifier === 'user1')).toBeDefined();
        expect(activities.find(a => a.identifier === 'user2')).toBeDefined();
        
        const user2Activity = activities.find(a => a.identifier === 'user2');
        expect(user2Activity?.count).toBe(40);
        expect(user2Activity?.lastSeen).toBeInstanceOf(Date);
      });

      it('should return empty array when no activities', () => {
        const activities = abuseDetector.getSuspiciousActivities();
        expect(activities).toEqual([]);
      });
    });
  });

  describe('RATE_LIMIT_CONFIGS', () => {
    it('should have valid configurations', () => {
      Object.entries(RATE_LIMIT_CONFIGS).forEach(([key, config]) => {
        expect(config.windowMs).toBeGreaterThan(0);
        expect(config.maxRequests).toBeGreaterThan(0);
        expect(typeof config.windowMs).toBe('number');
        expect(typeof config.maxRequests).toBe('number');
      });
    });

    it('should have appropriate limits for different contexts', () => {
      // Auth endpoints should be more restrictive
      expect(RATE_LIMIT_CONFIGS.API_AUTH.maxRequests).toBeLessThan(RATE_LIMIT_CONFIGS.API_GENERAL.maxRequests);
      
      // IP limits should be more generous than user limits (multiple users per IP)
      expect(RATE_LIMIT_CONFIGS.IP_GENERAL.maxRequests).toBeGreaterThan(RATE_LIMIT_CONFIGS.USER_GENERAL.maxRequests);
      
      // Enterprise API keys should have highest limits
      expect(RATE_LIMIT_CONFIGS.API_KEY_ENTERPRISE.maxRequests).toBeGreaterThan(RATE_LIMIT_CONFIGS.API_KEY_DEFAULT.maxRequests);
    });
  });
});