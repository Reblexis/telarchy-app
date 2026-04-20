# Persona: Dev, the skeptical self-hoster

Arrives via search or an aggregator, looking to self-host. Desktop. Technical, suspicious of SaaS-only pitches.

## Context

- **Device**: desktop, 1440x900, Firefox with uBlock Origin, broadband.
- **Referral**: Googled "prediction market self hosted docker", clicked a result pointing at `https://telarchy.com/`. May also arrive from a mention on r/selfhosted.
- **Attention budget**: 5 minutes. Will spend most of it reading, not clicking. Closes tab when convinced the product is SaaS-only or the self-hosting story is vaporware.
- **Trust level**: wary. Has been burned by "open core" products that turn out to be permanent closed beta.

## Background

Mid-career engineer running a homelab. Already self-hosts 10+ services via docker compose. Prefers to own their data. Will pay a small sum for a managed instance but only after trying the self-hosted path first. Expects a GitHub link, a LICENSE file, and a published container image. Does not expect SSO or polish; expects honesty about what works.

## Mental model

**They already know**:
- docker, docker-compose, postgres, nginx reverse-proxy patterns.
- That most "open core" startups eventually pull a rug on the free tier.
- That a private GitHub repo and "planned open-source release" is a yellow flag, not a green one.
- That "MIT license" in a README without a LICENSE file in the repo is a lie by omission.

**They don't know**:
- Anything about prediction-market math (they will skim the vision doc).
- Whether the project has users, maintainers, or is a one-weekend hackathon.

## Success path

The conversion milestone here is different from other personas: the goal is not signup. The goal is for Dev to bookmark the project, star the repo (if public), or leave with an accurate understanding of the state ("managed-only today, self-host promised later") so they'd be willing to recommend it to a colleague who needs managed.

A signup is a surprise win.

## Session script

- **T+00:00 — Land on `/`.** Scan for "self-host", "docker", "open source", "GitHub" in the first viewport. If none of those words appear, scroll to footer looking for a GitHub link.
- **T+00:30 — Check the repo link.** If a GitHub link exists, open it. 404 or private = trust break. No README with a docker-compose snippet = trust break.
- **T+01:00 — Read the ToS / Privacy / About pages.** Dev will actually read these. Look for: licensing status, self-hosted clause, data-sovereignty language. Inconsistencies between pages are a major trust break (e.g. landing says "open source", ToS says "all rights reserved").
- **T+02:00 — Look at the marketplace.** Not to sign up but to see whether the product has real usage. A public marketplace with varied workspaces is a strong signal; a single seed workspace is a weak signal.
- **T+03:00 — Read one market's detail page.** Checking that the LMSR math / mechanics look right. If it looks correct, Dev starts to trust the team.
- **T+04:00 — Decide.** Close the tab with a thumbs-up, a thumbs-down, or a bookmark.

## Friction triggers

- **Blocker**: README.md in the repo (or on GitHub) still says "MIT license" but there is no LICENSE file and no published image. Dev calls this fake-open-source and bounces.
- **Blocker**: Dev cannot tell from the landing or the docs whether the product is open source, planned-to-be, or closed forever. Ambiguity = bounce.
- **High**: ToS and README disagree about licensing or self-hosting availability. Any documentation drift erodes trust.
- **High**: landing page promises "self-host" as a feature but there is no command to run it and no image URL.
- **High**: vision.md mentions self-hosting in detail, README mentions docker-compose, but neither links to an actual published artifact.
- **Medium**: the public repo (if one exists) has no recent commits.
- **Medium**: no mention of who builds this. No team page. No personal names on the about page.
- **Low**: social preview image missing when sharing a link.

## Conversion criteria

Dev leaves with an accurate mental model and a bookmark. Best case: signs up to try the managed instance because the self-hosted story is honestly communicated as "not yet, here's the plan".

## Bounce criteria

Dev bounces and tells a colleague "another fake-open-source product". This is the persona most likely to actively warn others away if we misrepresent the state of the repo or license.

## Executor notes

- Critical files to check for consistency: `README.md` (License section), `docs/vision.md` (Business Model), `docs/go-to-market.md` ("Open Core" mention), `docs/legal/terms-of-service.md`, `docs/legal/privacy-policy.md`.
- Landing: `src/pages/LandingPage.tsx` (check any copy about "self-host" or "open source").
- If the repo is not public, there should be no GitHub link in the footer, no "clone this" snippet in docs, no `git@github.com:...` in any doc. Run a quick grep.
- This persona is the canary for open-source / self-hosting messaging drift. Re-run after any edit to ToS, README, or landing.
