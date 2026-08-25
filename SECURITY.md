# Security

If you find a vulnerability, do not open a public issue. Email
security@telarchy.com with what you found, how to reproduce it, and what you
think the impact is. You will get a reply within a few days, a fix as fast as it
can be made, and credit in the release note if you want it. There is no bounty
programme; the project is small.

In scope: this repository and the managed instance at telarchy.com. Out of
scope: denial of service, anything that needs physical access, and social
engineering of the maintainer.

What the code already promises, so you know where to look:

- every `/api` route is authenticated unless it is in the explicit list in
  `functions/src/middleware/route-policy.ts` (`ARCHITECTURE.md`, "Auth: deny by default");
- metric formulas go through a hand-written parser and are never evaluated as
  JavaScript (`docs/formulas.md`);
- agent keys are stored hashed; the master key is compared in one place, in
  constant time;
- no credential lives in the tree (`no-committed-secrets.test.ts`, gitleaks in CI).
