/**
 * Production Configuration
 * Environment-specific configuration settings for production deployment
 */

export interface ProductionConfig {
  app: {
    name: string;
    version: string;
    environment: string;
    debug: boolean;
  };
  api: {
    timeout: number;
    rateLimiting: {
      windowMs: number;
      maxRequests: number;
    };
    cors: {
      origins: string[];
      credentials: boolean;
    };
  };
  database: {
    connectionTimeout: number;
    queryTimeout: number;
    maxConnections: number;
    ssl: boolean;
  };
  storage: {
    maxFileSize: number;
    allowedTypes: string[];
    bucketName: string;
  };
  cache: {
    ttl: number;
    maxItems: number;
    strategy: 'lru' | 'lfu' | 'fifo';
  };
  security: {
    corsEnabled: boolean;
    csrfEnabled: boolean;
    helmetEnabled: boolean;
    rateLimitEnabled: boolean;
  };
  monitoring: {
    enabled: boolean;
    sentry: {
      enabled: boolean;
      tracesSampleRate: number;
      profilesSampleRate: number;
    };
    logging: {
      level: 'error' | 'warn' | 'info' | 'debug';
      structured: boolean;
      retention: number; // days
    };
    metrics: {
      enabled: boolean;
      interval: number; // seconds
    };
  };
  performance: {
    compression: boolean;
    cacheControl: {
      static: string;
      api: string;
      dynamic: string;
    };
    optimization: {
      images: boolean;
      minification: boolean;
      bundleSplitting: boolean;
    };
  };
  features: {
    maintenance: boolean;
    registrationEnabled: boolean;
    embedEnabled: boolean;
    analyticsEnabled: boolean;
  };
}

const developmentConfig: ProductionConfig = {
  app: {
    name: 'ReCopyFast',
    version: process.env.npm_package_version || '1.0.0',
    environment: 'development',
    debug: true,
  },
  api: {
    timeout: 30000,
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000, // Very generous for development
    },
    cors: {
      origins: ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true,
    },
  },
  database: {
    connectionTimeout: 30000,
    queryTimeout: 10000,
    maxConnections: 10,
    ssl: false,
  },
  storage: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    bucketName: 'assets',
  },
  cache: {
    ttl: 5 * 60 * 1000, // 5 minutes
    maxItems: 1000,
    strategy: 'lru',
  },
  security: {
    corsEnabled: true,
    csrfEnabled: false,
    helmetEnabled: false,
    rateLimitEnabled: false,
  },
  monitoring: {
    enabled: true,
    sentry: {
      enabled: false,
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
    },
    logging: {
      level: 'debug',
      structured: false,
      retention: 7,
    },
    metrics: {
      enabled: true,
      interval: 30,
    },
  },
  performance: {
    compression: false,
    cacheControl: {
      static: 'no-cache',
      api: 'no-cache',
      dynamic: 'no-cache',
    },
    optimization: {
      images: false,
      minification: false,
      bundleSplitting: true,
    },
  },
  features: {
    maintenance: false,
    registrationEnabled: true,
    embedEnabled: true,
    analyticsEnabled: false,
  },
};

const productionConfig: ProductionConfig = {
  app: {
    name: 'ReCopyFast',
    version: process.env.npm_package_version || '1.0.0',
    environment: 'production',
    debug: false,
  },
  api: {
    timeout: 30000,
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100, // Per IP
    },
    cors: {
      origins: [
        'https://recopyfast.com',
        'https://www.recopyfast.com',
        'https://app.recopyfast.com',
        ...(process.env.ALLOWED_ORIGINS?.split(',') || []),
      ],
      credentials: true,
    },
  },
  database: {
    connectionTimeout: 10000,
    queryTimeout: 5000,
    maxConnections: 20,
    ssl: true,
  },
  storage: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    bucketName: 'assets',
  },
  cache: {
    ttl: 60 * 60 * 1000, // 1 hour
    maxItems: 10000,
    strategy: 'lru',
  },
  security: {
    corsEnabled: true,
    csrfEnabled: true,
    helmetEnabled: true,
    rateLimitEnabled: true,
  },
  monitoring: {
    enabled: true,
    sentry: {
      enabled: true,
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
    },
    logging: {
      level: 'info',
      structured: true,
      retention: 30,
    },
    metrics: {
      enabled: true,
      interval: 60,
    },
  },
  performance: {
    compression: true,
    cacheControl: {
      static: 'public, max-age=31536000, immutable', // 1 year
      api: 'private, no-cache, no-store, must-revalidate',
      dynamic: 'private, max-age=300', // 5 minutes
    },
    optimization: {
      images: true,
      minification: true,
      bundleSplitting: true,
    },
  },
  features: {
    maintenance: false,
    registrationEnabled: true,
    embedEnabled: true,
    analyticsEnabled: true,
  },
};

const stagingConfig: ProductionConfig = {
  ...productionConfig,
  app: {
    ...productionConfig.app,
    environment: 'staging',
    debug: true,
  },
  api: {
    ...productionConfig.api,
    rateLimiting: {
      windowMs: 15 * 60 * 1000,
      maxRequests: 500, // More generous for testing
    },
    cors: {
      origins: [
        ...productionConfig.api.cors.origins,
        'https://staging.recopyfast.com',
        'https://preview.recopyfast.com',
      ],
      credentials: true,
    },
  },
  monitoring: {
    ...productionConfig.monitoring,
    sentry: {
      enabled: true,
      tracesSampleRate: 0.5, // Higher sampling for testing
      profilesSampleRate: 0.5,
    },
    logging: {
      level: 'debug',
      structured: true,
      retention: 14,
    },
  },
  features: {
    ...productionConfig.features,
    maintenance: false, // Allow testing even during maintenance
  },
};

function getConfig(): ProductionConfig {
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return productionConfig;
    case 'preview':
    case 'staging':
      return stagingConfig;
    case 'development':
    default:
      return developmentConfig;
  }
}

// Export the config for the current environment
export const config = getConfig();

// Export individual configs for testing
export { developmentConfig, stagingConfig, productionConfig };

// Utility functions
export function isProduction(): boolean {
  return config.app.environment === 'production';
}

export function isDevelopment(): boolean {
  return config.app.environment === 'development';
}

export function isStaging(): boolean {
  return config.app.environment === 'staging';
}

export function getEnvironment(): string {
  return config.app.environment;
}

// Configuration validation
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required environment variables
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  if (isProduction()) {
    requiredEnvVars.push(
      'NEXT_PUBLIC_SENTRY_DSN',
      'VERCEL_URL',
    );
  }

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  }

  // Validate URLs
  try {
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  } catch {
    errors.push('Invalid NEXT_PUBLIC_SUPABASE_URL');
  }

  // Validate numeric values
  if (config.api.timeout <= 0) {
    errors.push('API timeout must be positive');
  }

  if (config.storage.maxFileSize <= 0) {
    errors.push('Max file size must be positive');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}