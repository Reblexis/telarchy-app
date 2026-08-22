/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '!**/__tests__/harness/**'],
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  // better-auth ships ESM-only entrypoints. ts-jest skips node_modules by
  // default, but we need it to transpile better-auth so jest's CJS loader can
  // import it from middleware/auth.ts in integration tests.
  transformIgnorePatterns: [
    '/node_modules/(?!(better-auth|@better-auth|@better-fetch|better-call|nanostores|@simplewebauthn|jose|zod)/)',
  ],
  // Everything that runs this suite (CI runners, coding agents, hooks)
  // shares Viktor's 12-core 31GB laptop with his desktop session. Jest's
  // default of cores-1 workers at ts-jest's memory appetite (a worker never
  // frees transpiled-module memory and grows past 2.5GB) has frozen the
  // whole machine twice, so: two workers, recycled when they exceed 1.5GB.
  maxWorkers: 2,
  workerIdleMemoryLimit: '1.5G',
};

