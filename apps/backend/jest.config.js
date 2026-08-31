/**
 * Tests run against a REAL Postgres, never a mocked Prisma.
 *
 * The invariants worth testing here — a partial unique index, a CHECK
 * constraint, capacity counting across rows — are database behaviour. A mocked
 * Prisma would assert that the mock behaves as written, which is not the same
 * thing and would have caught none of the bugs found by hand.
 *
 * ESM, not CommonJS: @nestjs/common@12 ships ESM only, and Jest's CommonJS
 * registry cannot require() it on Node below 24.9. `npm test` sets
 * NODE_OPTIONS=--experimental-vm-modules for the same reason.
 */
export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  testEnvironment: 'node',

  setupFiles: ['<rootDir>/test/setup/env.ts'],
  globalSetup: '<rootDir>/test/setup/global-setup.ts',

  // Serial. Suites truncate shared tables, so parallel workers would delete
  // each other's fixtures mid-test. The suite is small enough that the
  // wall-clock cost is not worth the flakiness.
  maxWorkers: 1,
  testTimeout: 30000,
};
