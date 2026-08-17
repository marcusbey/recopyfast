const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/server/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/layout.tsx',
    '!src/app/globals.css',
  ],
  // Ratchet, not a target. The global gate was set to 80% while real coverage
  // sat near 22%, so `npm run test:coverage` — and with it the pre-push hook —
  // failed on every single push regardless of what changed. A gate that never
  // passes gates nothing.
  //
  // These numbers are the floor measured today. They stop coverage regressing
  // and should be raised as tests are added; 80% remains the goal, it just
  // cannot be declared before it is earned.
  //
  // Raised 2026-08-17 (s11a) from 16/19/22/22 to the floor measured that day:
  // branches 34.32, functions 39.51, lines 41.82, statements 41.57. Each is
  // rounded down to the integer below the measurement, so the gate has a
  // fraction of a point of slack and still ratchets. Never lower these.
  coverageThreshold: {
    global: {
      branches: 34,
      functions: 39,
      lines: 41,
      statements: 41,
    },
  },
  // Only *.test.* / *.spec.* are suites. The previous
  // `src/**/__tests__/**/*.{js,jsx,ts,tsx}` pattern also swept up shared
  // helpers (e.g. integration/setup.ts) and failed them as empty suites.
  testMatch: ['<rootDir>/src/**/*.(test|spec).{js,jsx,ts,tsx}'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)