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
  // ts-jest never frees transpiled-module memory, so a worker grows past
  // 2.5GB over a long run. The CI runners share Viktor's 31GB laptop with
  // his desktop session; workers above this limit are recycled between test
  // files, which keeps a 2-worker shard around 3GB instead of 6GB.
  workerIdleMemoryLimit: '1.5G',
};

