import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Whether a push builds an image (scripts/image-build-needed.mjs).
 *
 * docs/infra/deploy.md, "Branch previews", "A push builds only when the image
 * would change": the build runs if any path changed since the last built
 * commit is an image input. A path is not an input only when no Dockerfile
 * COPY names it (or a directory above it) AND it is under docs/, browse/,
 * notes/ or qa/, or ends in .md. Everything else builds, a workflow_dispatch
 * always builds, and the tests run regardless.
 *
 * Runs the real script against a throwaway git repository holding a copy of
 * the real Dockerfile, so it checks the script, not a re-derivation of it.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'image-build-needed.mjs');
const DOCKERFILE = join(ROOT, 'Dockerfile');
const workflow = readFileSync(join(ROOT, '.github/workflows/deploy-cloudrun.yml'), 'utf8');

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function write(rel: string, content = `${rel}\n`) {
  const abs = join(repo, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function commit(msg: string): string {
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', msg);
  return git('rev-parse', 'HEAD');
}

/** Commits the given paths on top of the baseline and asks the script. */
function push(paths: string[], opts: { event?: string; base?: string } = {}) {
  const base = opts.base ?? git('rev-parse', 'HEAD');
  for (const p of paths) write(p, `${p} changed ${Math.random()}\n`);
  commit('push');
  return decide(base, opts.event ?? 'push');
}

function decide(base: string, event = 'push', env: Record<string, string> = {}) {
  const r = spawnSync('node', [SCRIPT, '--event', event, '--base', base], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', ...env },
  });
  const m = r.stdout.match(/^build=(true|false)$/m);
  return { status: r.status, build: m ? m[1] === 'true' : undefined, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'telarchy-image-build-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  copyFileSync(DOCKERFILE, join(repo, 'Dockerfile'));
  write('docs/seasons.md');
  write('browse/index.html');
  write('src/App.tsx');
  write('functions/src/app.ts');
  commit('baseline');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('a push that cannot change the image does not build', () => {
  test('a docs-only push with its regenerated mirror does not build', () => {
    expect(push(['docs/seasons.md', 'browse/index.html'])).toMatchObject({ status: 0, build: false });
  });

  test('a notes-only push does not build', () => {
    expect(push(['notes/decisions/infra-deploy.md', 'notes/design/x.html'])).toMatchObject({ build: false });
  });

  test('a push of only root markdown files does not build', () => {
    expect(push(['AGENTS.md', 'TODOS.md', 'README.md'])).toMatchObject({ build: false });
  });

  test('a push of only browser specs does not build', () => {
    expect(push(['qa/browse/floor.md', 'qa/browse/_runner/run.sh'])).toMatchObject({ build: false });
  });

  test('a markdown file outside the app source, in a nested directory, does not build', () => {
    expect(push(['clients/python/README.md'])).toMatchObject({ build: false });
  });

  test('a push whose tree equals the last build does not build', () => {
    const base = git('rev-parse', 'HEAD');
    commit('empty');
    expect(decide(base)).toMatchObject({ status: 0, build: false });
  });
});

describe('a push that can change the image builds', () => {
  test('a server source file builds', () => {
    expect(push(['functions/src/app.ts'])).toMatchObject({ build: true });
  });

  test('a frontend source file builds', () => {
    expect(push(['src/App.tsx'])).toMatchObject({ build: true });
  });

  test('a static asset builds', () => {
    expect(push(['public/favicon.svg'])).toMatchObject({ build: true });
  });

  test('a mixed push of docs and code builds', () => {
    expect(push(['docs/seasons.md', 'browse/index.html', 'functions/src/app.ts'])).toMatchObject({ build: true });
  });

  test('a served doc builds: a guide the app serves at /api/guides', () => {
    expect(push(['docs/guides/overview.md'])).toMatchObject({ build: true });
  });

  test('a served doc builds: the audience pages', () => {
    expect(push(['docs/audience-pages.md'])).toMatchObject({ build: true });
  });

  test('a served doc builds: the data room vision', () => {
    expect(push(['docs/data-room/vision.md'])).toMatchObject({ build: true });
  });

  test('a markdown file inside the app source builds', () => {
    expect(push(['src/copy/intro.md'])).toMatchObject({ build: true });
  });

  test('a migration builds', () => {
    expect(push(['functions/drizzle/0999_new.sql'])).toMatchObject({ build: true });
  });

  test('the lockfile builds (a globbed COPY source)', () => {
    expect(push(['package-lock.json'])).toMatchObject({ build: true });
  });

  test('the Dockerfile itself builds', () => {
    expect(push(['Dockerfile'])).toMatchObject({ build: true });
  });

  test('the deploy workflow builds, since it carries the deploy flags', () => {
    expect(push(['.github/workflows/deploy-cloudrun.yml'])).toMatchObject({ build: true });
  });

  test('an unfamiliar file builds rather than skips', () => {
    expect(push(['biome.json'])).toMatchObject({ build: true });
  });

  test('a deleted source file builds', () => {
    const base = git('rev-parse', 'HEAD');
    rmSync(join(repo, 'src/App.tsx'));
    commit('delete');
    expect(decide(base)).toMatchObject({ build: true });
  });

  test('a source file renamed into docs builds, because its old path is an input', () => {
    const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, 'docs/archive'), { recursive: true });
    git('mv', 'src/App.tsx', 'docs/archive/App.md');
    commit('rename');
    expect(decide(base)).toMatchObject({ build: true });
  });
});

describe('never skips a file the image contains', () => {
  /** COPY sources of the real Dockerfile, read independently of the script. */
  const sources = readFileSync(DOCKERFILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^COPY\s/.test(l) && !/--from/.test(l))
    .flatMap(l => l.split(/\s+/).slice(1, -1));

  test('the real Dockerfile copies at least the served docs', () => {
    expect(sources).toEqual(
      expect.arrayContaining(['docs/guides', 'docs/audience-pages.md', 'docs/data-room/vision.md']),
    );
  });

  test.each(sources)('a change under COPY source %s builds', source => {
    const concrete = source.replace(/\*/g, 'x');
    const isFile = /\.[a-z]+$/.test(concrete) || concrete === 'Dockerfile';
    expect(push([isFile ? concrete : `${concrete}/changed.md`])).toMatchObject({ build: true });
  });

  test('a doc newly copied by the Dockerfile builds without any change to the rule', () => {
    const df = readFileSync(join(repo, 'Dockerfile'), 'utf8');
    writeFileSync(
      join(repo, 'Dockerfile'),
      df.replace('# ── Runtime', 'COPY docs/pricing.md ./docs/pricing.md\n# ── Runtime'),
    );
    write('docs/pricing.md');
    commit('serve pricing doc');
    expect(push(['docs/pricing.md'])).toMatchObject({ build: true });
  });
});

describe('when there is nothing to compare against, it builds', () => {
  test('an empty base builds', () => {
    write('docs/seasons.md', 'x\n');
    commit('docs');
    expect(decide('')).toMatchObject({ status: 0, build: true });
  });

  test('a base that is not a commit in this clone builds', () => {
    write('docs/seasons.md', 'x\n');
    commit('docs');
    expect(decide('0123456789abcdef0123456789abcdef01234567')).toMatchObject({ status: 0, build: true });
  });

  test('a workflow_dispatch always builds, even for a docs-only change', () => {
    expect(push(['docs/seasons.md'], { event: 'workflow_dispatch' })).toMatchObject({ build: true });
  });
});

test('the decision is written to GITHUB_OUTPUT for the deploy jobs to read', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'telarchy-image-build-out-'));
  const out = join(outDir, 'github-output');
  writeFileSync(out, '');
  const base = git('rev-parse', 'HEAD');
  write('docs/seasons.md', 'y\n');
  commit('docs');
  expect(decide(base, 'push', { GITHUB_OUTPUT: out }).status).toBe(0);
  expect(readFileSync(out, 'utf8')).toContain('build=false');
  rmSync(outDir, { recursive: true, force: true });
});

describe('the workflow is wired to the rule', () => {
  function job(name: string): string {
    const at = workflow.search(new RegExp(`^  ${name}:\\n`, 'm'));
    if (at < 0) throw new Error(`deploy-cloudrun.yml has no job ${name}`);
    const rest = workflow.slice(at + 3);
    const next = rest.search(/^ {2}[a-z][a-z-]*:\n/m);
    return next < 0 ? rest : rest.slice(0, next);
  }

  test('tests still run on a docs-only push: no workflow-level path filter', () => {
    const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
    expect(on).not.toMatch(/paths-ignore|paths:/);
  });

  test('the test jobs do not wait on the build decision', () => {
    expect(job('checks')).not.toMatch(/needs:.*changes/);
    expect(job('backend')).not.toMatch(/needs:.*changes/);
  });

  test('the changes job calls the script', () => {
    expect(job('changes')).toContain('scripts/image-build-needed.mjs');
  });

  test.each(['deploy', 'preview'])('the %s job runs only when the push changes an image input', name => {
    const j = job(name);
    expect(j).toMatch(/needs: \[checks, backend, changes\]/);
    expect(j).toContain("needs.changes.outputs.build == 'true'");
  });

  test('the workflow may read its own run history to find the last build', () => {
    expect(workflow).toMatch(/^\s+actions: read/m);
  });
});
