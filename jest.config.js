/**
 * Two projects:
 *  - unit:    pure domain logic, the demo repository and repository contract
 *             tests. No backend required. `npm test`
 *  - backend: database/authorization tests and the same contract tests run
 *             against a local Supabase stack. `npm run test:db`
 */
const shared = {
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts', '<rootDir>/tests/demo/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'backend',
      testEnvironment: 'node',
      transform: {
        '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
      },
      transformIgnorePatterns: ['/node_modules/'],
      testMatch: ['<rootDir>/supabase/tests/**/*.test.ts', '<rootDir>/tests/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/supabase/tests/support/global-setup.js',
      testTimeout: 60000,
    },
  ],
};
