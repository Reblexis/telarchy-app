# Architecture

The map a contributor needs before touching code. Product intent lives in
`docs/vision.md`; this file says where things are and the two rules that are
easy to get wrong. Docs govern: where this file and the code disagree, the
code is wrong.

## Module map

```
telarchy-app/
├── src/                       React + TypeScript frontend (Vite)
│   ├── main.tsx, App.tsx      entry and routes
│   ├── pages/                 one file per route page
│   ├── components/            shared UI
│   ├── lib/                   API client (api.ts), AMM mirror (amm.ts), floor model
│   └── hooks/                 useAuth, useMyParticipantId
├── functions/                 Node + Express backend (Drizzle ORM, Postgres; pglite in tests)
│   └── src/
│       ├── server.ts          process entry: static SPA, share-meta injection, boot
│       ├── app.ts             the Express app: limiters, auth policy, router mounts
│       ├── routes/            one router per resource; thin, call services
│       ├── services/          domain operations (markets, proposals, credits, ...)
│       ├── lib/               pure modules: amm, formula (parser), master-key, notify, ...
│       ├── middleware/        auth (who is calling), route-policy (deny by default),
│       │                      capabilities, consent, roles
│       ├── db/                schema.ts (Drizzle) and client.ts
│       ├── content/           generated prose modules (changelog, guides)
│       └── __tests__/         Jest; harness/ boots pglite and replays migrations
├── scripts/                   operator and build scripts (build-changelog, parity checks)
└── docs/                      the governing docs; see docs/README.md
```

Request flow:

```
  browser / agent
        |
        v
  functions/src/server.ts      static SPA, share-meta injection, visit log
        |
        v
  functions/src/app.ts         CORS, json, rate limiters,
        |                      app.use('/api', apiAuthPolicy)   <- runs FIRST on every /api call
        |                      routers, in any order
        v
  routes/*.ts  --wrap()-->  services/*.ts  -->  lib/*.ts (amm, formula, notify)
                                  |
                                  v
                            db/schema.ts (Drizzle, Postgres; pglite in tests)
```

## Auth: deny by default

Every `/api` request passes through `apiAuthPolicy`
(`functions/src/middleware/route-policy.ts`) before any router sees it.

- Paths under one of the `OPTIONAL_AUTH_PREFIXES` get `optionalAuthMiddleware`:
  credentials are resolved when present and the router's own gates
  (`requireCapability`, `requireIdentity`, `agentsRouter.use(authMiddleware)`
  for the private half of `/api/agents`) decide what an anonymous caller may do.
- Every other path gets `authMiddleware`, which rejects unauthenticated calls
  with 401 before routing happens. An unknown path is 401 anonymously, 404 with
  credentials.

Consequences for a change:

- A new private route needs nothing: it is denied by default.
- A new public route needs one entry in `OPTIONAL_AUTH_PREFIXES`, with its reason.
- `app.ts` must never mount `authMiddleware` or `optionalAuthMiddleware` itself;
  `route-auth-guard.test.ts` fails on that, on a stale prefix, and on a policy
  mounted after a router.
- `route-auth-matrix.test.ts` pins the status every route returns anonymously,
  with an agent key and with the master key. A change that moves a route across
  the line shows up as a fixture diff; regenerate with `UPDATE_AUTH_MATRIX=1`
  and read the diff before committing it.

History: until 2026-08-24 the check depended on mount order in `app.ts`
(routers above `app.use('/api', authMiddleware)` had to self-authorize), and a
router added on the wrong side shipped open. That design is gone.

Consent (`requireConsentIfUser`, terms acceptance for browser sessions) is a
separate concern and is still applied per mount in `app.ts`.

## Credentials

The master key is compared in one function, `isMasterKey`
(`functions/src/lib/master-key.ts`), which also honours `API_KEY_PREVIOUS`
during a rotation; a test asserts no other file reads `process.env.API_KEY`.
Agent keys are stored hashed (`agentApiKeys.hash`) and resolved in
`middleware/auth.ts`. Nothing in the tracked tree may hold a credential:
`no-committed-secrets.test.ts` walks `git ls-files`.

## Formulas

Metric formulas are parsed by the hand-written tokenizer, parser and evaluator
in `functions/src/lib/formula/` against the grammar in `docs/formulas.md`. The
backend never evaluates a formula as JavaScript; a test fails the build if that
changes.
