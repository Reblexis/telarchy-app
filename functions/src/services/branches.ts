/**
 * Every branch of the repository, and whether it is built as a preview
 * (docs/infra/deploy.md, "Branch previews": "Any branch can be built").
 *
 * The list comes from GitHub's public branches API, cached a minute so the
 * stripe's picker does not spend the unauthenticated rate limit. Building one
 * dispatches the deploy workflow on that ref, which needs a token with Actions
 * write; without it the endpoint says so and names the terminal command.
 */

import { execFileSync } from 'child_process';
import { ttlCache } from '../lib/ttl-cache';
import { type PreviewRevision, releaseState } from './release';

export const REPO = process.env.GITHUB_REPO ?? 'Reblexis/telarchy-app';
const WORKFLOW = 'deploy-cloudrun.yml';

/** `scripts/preview-tag.sh`, in TypeScript: `br-` plus the branch lowercased,
 *  anything outside [a-z0-9-] to "-", hyphen runs collapsed, no leading or
 *  trailing hyphen, 40 characters at most. `branches.test.ts` pins the two
 *  against each other. Null when nothing is left to name a tag with. */
export function previewTagFor(branch: string): string | null {
  let name = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
  name = name.slice(0, 37).replace(/-$/, '');
  return name ? `br-${name}` : null;
}

/** For the parity test only: what the shell script says. */
export function previewTagFromScript(branch: string, cwd: string): string | null {
  try {
    return execFileSync('sh', ['scripts/preview-tag.sh', branch], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export interface Branch {
  name: string;
  sha: string;
  /** The preview tag this branch would carry; null for a name that leaves nothing. */
  tag: string | null;
  /** True when a revision carrying that tag exists right now. */
  built: boolean;
}

function token(): string | null {
  return process.env.GITHUB_ACTIONS_TOKEN || null;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'telarchy' };
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function fetchBranches(): Promise<Array<{ name: string; sha: string }>> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/branches?per_page=100`, {
    headers: headers(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub branches: ${res.status}`);
  const body = (await res.json()) as Array<{ name: string; commit?: { sha?: string } }>;
  return body.map(b => ({ name: b.name, sha: b.commit?.sha ?? '' }));
}

const branchCache = ttlCache({ ttlMs: 60_000, keyOf: () => 'branches', load: fetchBranches });

/** Pure join, so the marking is testable without GitHub or Cloud Run. */
export function joinBranches(branches: Array<{ name: string; sha: string }>, previews: PreviewRevision[]): Branch[] {
  const built = new Set(previews.map(p => p.tag));
  return branches
    .filter(b => b.name !== 'main')
    .map(b => {
      const tag = previewTagFor(b.name);
      return { name: b.name, sha: b.sha, tag, built: tag !== null && built.has(tag) };
    })
    .sort((a, b) => Number(b.built) - Number(a.built) || a.name.localeCompare(b.name));
}

/** GitHub unreachable is a list with an `error`, not a failed page: the picker
 *  still shows what is built, from Cloud Run, and says the rest is unknown. */
export async function listBranches(): Promise<{ branches: Branch[]; error: string | null }> {
  const state = await releaseState();
  try {
    const branches = await branchCache.get();
    return { branches: joinBranches(branches, state.previews), error: null };
  } catch (e) {
    console.error('branches: GitHub list failed', (e as Error).message);
    return { branches: [], error: (e as Error).message };
  }
}

export function buildConfigured(): boolean {
  return token() !== null;
}

export class BuildNotConfiguredError extends Error {}

/** Ask CI to build `branch` as a preview: a workflow_dispatch on that ref. */
export async function dispatchBuild(branch: string): Promise<{ tag: string }> {
  const tag = previewTagFor(branch);
  if (!tag) throw new Error(`"${branch}" leaves nothing to name a preview tag with`);
  if (!buildConfigured()) {
    throw new BuildNotConfiguredError(
      `This instance has no GITHUB_ACTIONS_TOKEN, so it cannot ask CI to build a branch. From a terminal: gh workflow run ${WORKFLOW} --ref ${branch}`,
    );
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: branch }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub refused the dispatch (${res.status}) ${detail}`.trim());
  }
  return { tag };
}
