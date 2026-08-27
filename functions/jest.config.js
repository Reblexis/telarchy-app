/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  // Transpile-only: no type-checking inside jest workers. Type errors in
  // tests are still caught, `npm run typecheck` builds this package with
  // tsc and `include: ["src"]` covers __tests__. Checking types in every
  // worker made a suite take 5x longer and each worker hold a full ts
  // Program in memory.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  // Node environment plus one shared PGlite per worker (created lazily,
  // injected into every sandbox). See harness/pglite-environment.js for why
  // the environment is the only per-worker place a live object can survive.
  testEnvironment: '<rootDir>/src/__tests__/harness/pglite-environment.js',
  testMatch: ['**/__tests__/**/*.test.ts', '!**/__tests__/harness/**'],
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  // better-auth ships ESM-only entrypoints. ts-jest skips node_modules by
  // default, but we need it to transpile better-auth so jest's CJS loader can
  // import it from middleware/auth.ts in integration tests.
  transformIgnorePatterns: [
    '/node_modules/(?!(better-auth|@better-auth|@better-fetch|better-call|nanostores|@simplewebauthn|jose|zod)/)',
  ],
  // Everything that runs this suite (CI runners, coding agents, hooks)
  // shares Viktor's 12-core 31GB laptop with his desktop session; jest's
  // default of cores-1 workers has frozen the whole machine twice, and
  // several agents often run the suite at the same time, so stay at two
  // workers. A worker holds one shared PGlite (~1GB, see the harness) plus
  // per-file module registries; the idle limit below recycles it when the
  // JS heap - the only thing jest can measure, WASM memory is invisible to
  // it - outgrows a gigabyte.
  maxWorkers: 2,
  workerIdleMemoryLimit: '1G',
};

