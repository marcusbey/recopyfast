import {
  validateDomain,
  normalizeDomain,
  createDomainVerification,
  generateDNSTXTRecord,
  generateFileVerificationContent,
  isDomainWhitelisted,
  extractDomainFromURL,
  DomainVerificationChecker
} from '@/lib/security/domain-verification';

// Mock the dns module for testing
jest.mock('dns', () => ({
  promises: {
    resolveTxt: jest.fn()
  }
}));

// Mock fetch for file verification
global.fetch = jest.fn();

describe('Domain Verification', () => {
  describe('validateDomain', () => {
    it('should validate correct domains', () => {
      const validDomains = [
        'example.com',
        'subdomain.example.com',
        'example-site.com',
        'test.co.uk',
        'a.b.c.d.e.com'
      ];

      validDomains.forEach(domain => {
        const result = validateDomain(domain);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    it('should reject invalid domains', () => {
      const invalidDomains = [
        '',
        'localhost',
        '127.0.0.1',
        '192.168.1.1',
        '10.0.0.1',
        'invalid..domain.com',
        'domain-with-too-long-name-that-exceeds-the-maximum-length-allowed-for-domain-names-which-is-253-characters'.repeat(10) + '.com',
        'invalid_domain',
        '-invalid.com',
        'invalid-.com'
      ];

      invalidDomains.forEach(domain => {
        const result = validateDomain(domain);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });

  describe('normalizeDomain', () => {
    it('should normalize domain formats', () => {
      const testCases = [
        { input: 'EXAMPLE.COM', expected: 'example.com' },
        { input: 'https://example.com', expected: 'example.com' },
        { input: 'http://www.example.com/', expected: 'example.com' },
        { input: '  Example.Com  ', expected: 'example.com' },
        { input: 'subdomain.Example.COM', expected: 'subdomain.example.com' }
      ];

      testCases.forEach(({ input, expected }) => {
        expect(normalizeDomain(input)).toBe(expected);
      });
    });
  });

  describe('createDomainVerification', () => {
    it('should create valid verification object', () => {
      const verification = createDomainVerification('site-123', 'example.com', 'dns');

      expect(verification.siteId).toBe('site-123');
      expect(verification.domain).toBe('example.com');
      expect(verification.verificationMethod).toBe('dns');
      expect(verification.verificationToken).toHaveLength(64); // 32 bytes hex
      expect(verification.verificationCode).toHaveLength(32); // 16 bytes hex
      expect(verification.isVerified).toBe(false);
      expect(verification.expiresAt).toBeInstanceOf(Date);
      expect(verification.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should normalize domain in verification', () => {
      const verification = createDomainVerification('site-123', 'HTTPS://WWW.EXAMPLE.COM/', 'file');
      expect(verification.domain).toBe('example.com');
    });
  });

  describe('generateDNSTXTRecord', () => {
    it('should generate proper DNS TXT record', () => {
      const code = 'abc123';
      const record = generateDNSTXTRecord(code);
      
      expect(record).toBe('recopyfast-verification=abc123');
    });
  });

  describe('generateFileVerificationContent', () => {
    it('should generate proper file verification content', () => {
      const code = 'abc123';
      const result = generateFileVerificationContent(code);
      
      expect(result.filename).toBe('recopyfast-verification-abc123.txt');
      expect(result.content).toContain('ReCopyFast Domain Verification');
      expect(result.content).toContain('Verification Code: abc123');
      expect(result.content).toContain('Generated:');
    });
  });

  describe('isDomainWhitelisted', () => {
    const whitelistedDomains = ['example.com', 'test.example.com', 'another-site.com'];

    it('should allow whitelisted domains', () => {
      expect(isDomainWhitelisted('example.com', whitelistedDomains)).toBe(true);
      expect(isDomainWhitelisted('test.example.com', whitelistedDomains)).toBe(true);
      expect(isDomainWhitelisted('EXAMPLE.COM', whitelistedDomains)).toBe(true);
    });

    it('should reject non-whitelisted domains', () => {
      expect(isDomainWhitelisted('malicious.com', whitelistedDomains)).toBe(false);
      expect(isDomainWhitelisted('sub.example.com', whitelistedDomains)).toBe(false);
      expect(isDomainWhitelisted('', whitelistedDomains)).toBe(false);
    });

    it('should handle empty whitelist', () => {
      expect(isDomainWhitelisted('example.com', [])).toBe(false);
    });
  });

  describe('extractDomainFromURL', () => {
    it('should extract domains from valid URLs', () => {
      const testCases = [
        { input: 'https://example.com/path', expected: 'example.com' },
        { input: 'http://subdomain.example.com:8080/path?query=1', expected: 'subdomain.example.com' },
        { input: 'https://www.example.com/', expected: 'example.com' },
        { input: 'http://EXAMPLE.COM', expected: 'example.com' }
      ];

      testCases.forEach(({ input, expected }) => {
        expect(extractDomainFromURL(input)).toBe(expected);
      });
    });

    it('should return null for invalid URLs', () => {
      const invalidURLs = [
        'not-a-url',
        'ftp://example.com', // Invalid protocol handled by normalizeDomain
        '',
        'javascript:alert(1)'
      ];

      invalidURLs.forEach(url => {
        expect(extractDomainFromURL(url)).toBeNull();
      });
    });
  });

  describe('DomainVerificationChecker', () => {
    let checker: DomainVerificationChecker;
    const mockVerification = {
      id: 'test-id',
      siteId: 'site-123',
      domain: 'example.com',
      verificationMethod: 'dns' as const,
      verificationToken: 'token123',
      verificationCode: 'code123',
      isVerified: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    beforeEach(() => {
      checker = new DomainVerificationChecker(1000); // 1 second cache
      jest.clearAllMocks();
    });

    it('should cache verification results', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockResolvedValue([['recopyfast-verification=code123']]);

      // First call should perform verification
      const result1 = await checker.checkDomain(mockVerification);
      expect(result1.success).toBe(true);
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await checker.checkDomain(mockVerification);
      expect(result2.success).toBe(true);
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(1); // Still 1, cached
    });

    it('should bypass cache when requested', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockResolvedValue([['recopyfast-verification=code123']]);

      await checker.checkDomain(mockVerification, true); // Use cache
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(1);

      await checker.checkDomain(mockVerification, false); // Bypass cache
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(2);
    });

    it('should clear cache correctly', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockResolvedValue([['recopyfast-verification=code123']]);

      await checker.checkDomain(mockVerification);
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(1);

      checker.clearCache('example.com');

      await checker.checkDomain(mockVerification);
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(2); // Cache was cleared
    });

    it('should expire cache after timeout', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockResolvedValue([['recopyfast-verification=code123']]);

      const shortCacheChecker = new DomainVerificationChecker(10); // 10ms cache

      await shortCacheChecker.checkDomain(mockVerification);
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      await shortCacheChecker.checkDomain(mockVerification);
      expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(2); // Cache expired
    });
  });

  describe('DNS Verification', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should verify correct DNS TXT record', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockResolvedValue([['recopyfast-verification=code123']]);

      const { verifyDNSTXTRecord } = require('@/lib/security/domain-verification');
      const result = await verifyDNSTXTRecord('example.com', 'code123');
      
      expect(result.success).toBe(true);
      expect(dns.promises.resolveTxt).toHaveBeenCalledWith('example.com');
    });

    it('should fail for incorrect DNS TXT record', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockResolvedValue([['other-verification=wrong']]);

      const { verifyDNSTXTRecord } = require('@/lib/security/domain-verification');
      const result = await verifyDNSTXTRecord('example.com', 'code123');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('DNS TXT record not found');
    });

    it('should handle DNS resolution errors', async () => {
      const dns = require('dns');
      dns.promises.resolveTxt.mockRejectedValue(new Error('NXDOMAIN'));

      const { verifyDNSTXTRecord } = require('@/lib/security/domain-verification');
      const result = await verifyDNSTXTRecord('nonexistent.com', 'code123');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('DNS verification failed');
    });
  });

  describe('File Verification', () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockClear();
    });

    it('should verify correct file content', async () => {
      const expectedContent = 'ReCopyFast Domain Verification\nVerification Code: code123\nGenerated: 2023-01-01';
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(expectedContent)
      });

      const { verifyDomainFile } = require('@/lib/security/domain-verification');
      const result = await verifyDomainFile('example.com', 'code123');
      
      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/.well-known/recopyfast-verification-code123.txt',
        expect.any(Object)
      );
    });

    it('should fail for incorrect file content', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Wrong content')
      });

      const { verifyDomainFile } = require('@/lib/security/domain-verification');
      const result = await verifyDomainFile('example.com', 'code123');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('File content does not match');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const { verifyDomainFile } = require('@/lib/security/domain-verification');
      const result = await verifyDomainFile('example.com', 'code123');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { verifyDomainFile } = require('@/lib/security/domain-verification');
      const result = await verifyDomainFile('example.com', 'code123');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('File verification failed');
    });
  });
});