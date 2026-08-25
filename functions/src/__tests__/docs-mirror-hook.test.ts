import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The docs mirror guard (scripts/check-docs-mirror-staged.sh).
 *
 * AGENTS.md: any commit that changes a file under docs/ regenerates
 * browse/index.html in the same commit. Until 2026-08-25 that was a sentence
 * the first conformance audit found broken; now it is a pre-commit hook, and
 * this test is what keeps the hook honest. Runs the real script against a
 * throwaway git repository, so it checks the shell, not a re-derivation of it.
 *
 * Static apart from a temp directory: no database, no server.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-docs-mirror-staged.sh');
const MESSAGE = 'docs/ changed: run python3 scripts/build-docs-mirror.py and stage browse/index.html';

let repo: string;

function git(...args: string[]) {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

function stage(rel: string, content: string) {
  const abs = join(repo, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
  git('add', rel);
}

function guard() {
  const r = spawnSync('sh', [join(repo, 'scripts', 'check-docs-mirror-staged.sh')], { cwd: repo, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'telarchy-mirror-hook-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(SCRIPT, join(repo, 'scripts', 'check-docs-mirror-staged.sh'));
  // A baseline commit so later diffs are ordinary, not the initial one.
  stage('docs/seasons.md', '# Seasons\n');
  stage('browse/index.html', '<html>v1</html>\n');
  git('commit', '-q', '-m', 'baseline');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test('a docs/ change staged without the mirror is refused, and says what to run', () => {
  stage('docs/seasons.md', '# Seasons\n\nnew sentence\n');
  const r = guard();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(MESSAGE);
});

test('a docs/ change staged with the mirror passes', () => {
  stage('docs/seasons.md', '# Seasons\n\nnew sentence\n');
  stage('browse/index.html', '<html>v2</html>\n');
  expect(guard().status).toBe(0);
});

test('a commit that touches nothing under docs/ is left alone', () => {
  stage('src/thing.ts', 'export const x = 1;\n');
  expect(guard().status).toBe(0);
});

test('a new doc counts as a docs/ change, not only an edited one', () => {
  stage('docs/new-topic.md', '# New\n');
  expect(guard().status).toBe(1);
});

test('a docs/ file only modified in the working tree, not staged, does not trigger it', () => {
  writeFileSync(join(repo, 'docs', 'seasons.md'), '# Seasons\n\nunstaged\n');
  stage('src/thing.ts', 'export const x = 1;\n');
  expect(guard().status).toBe(0);
});

test('the guard is wired into the pre-commit hook, after lint-staged', () => {
  // simple-git-hooks installs exactly this string as .git/hooks/pre-commit,
  // so a script nobody wires is a script nobody runs.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    'simple-git-hooks': Record<string, string>;
  };
  const hook = pkg['simple-git-hooks']['pre-commit'];
  expect(hook).toContain('lint-staged');
  expect(hook).toContain('scripts/check-docs-mirror-staged.sh');
});
