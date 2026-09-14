#!/usr/bin/env node
/**
 * Decide whether a push builds an image.
 *
 * Spec: docs/infra/deploy.md, "Branch previews", "A push builds only when the
 * image would change". The build runs if any path that differs between --base
 * (the last commit this workflow built for the branch) and HEAD is an image
 * input. A path is NOT an input only when no Dockerfile COPY (other than
 * COPY --from) names it or a directory above it, AND it is under docs/,
 * browse/, notes/ or qa/, or ends in .md. Anything else, including a path
 * nobody anticipated, builds. A workflow_dispatch always builds, and so does
 * a missing or unknown base.
 *
 *   node scripts/image-build-needed.mjs --event push --base <sha>
 *
 * Prints `build=true` or `build=false` on stdout and appends the same line to
 * $GITHUB_OUTPUT when that is set. The reasoning goes to stderr.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const INERT_DIRS = ['docs/', 'browse/', 'notes/', 'qa/'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Matchers for every path a non --from COPY puts into the image. */
function copySources(dockerfile) {
  const text = dockerfile.replace(/\\\r?\n/g, ' ');
  const matchers = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line)) continue;
    let rest = line.slice(4).trim();
    const flags = [];
    while (rest.startsWith('--')) {
      const m = rest.match(/^(\S+)\s*/);
      flags.push(m[1]);
      rest = rest.slice(m[0].length);
    }
    if (flags.some(f => f.startsWith('--from'))) continue;
    let tokens;
    if (rest.startsWith('[')) {
      try {
        tokens = JSON.parse(rest);
      } catch {
        tokens = ['.', 'x']; // unreadable: treat as copying everything
      }
    } else {
      tokens = rest.split(/\s+/);
    }
    for (const source of tokens.slice(0, -1)) {
      const clean = source.replace(/^\.\//, '').replace(/\/+$/, '');
      if (clean === '' || clean === '.') {
        matchers.push(() => true);
        continue;
      }
      const glob = clean
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      const re = new RegExp(`^${glob}(/.*)?$`);
      matchers.push(p => re.test(p));
    }
  }
  return matchers;
}

function decide() {
  const event = arg('event');
  const base = arg('base');

  if (event === 'workflow_dispatch') {
    return { build: true, reason: 'dispatched by hand: always builds' };
  }
  if (!base || git(['cat-file', '-e', `${base}^{commit}`]) === null) {
    return { build: true, reason: `no last built commit to compare with (${base || 'none'}): builds` };
  }
  if (!existsSync('Dockerfile')) {
    return { build: true, reason: 'no Dockerfile to read the image inputs from: builds' };
  }

  const diff = git(['diff', '--name-only', '--no-renames', '-z', base, 'HEAD']);
  if (diff === null) {
    return { build: true, reason: `could not diff ${base}..HEAD: builds` };
  }
  const files = diff.split('\0').filter(Boolean);
  const copied = copySources(readFileSync('Dockerfile', 'utf8'));
  const isInput = p => copied.some(m => m(p)) || !(INERT_DIRS.some(d => p.startsWith(d)) || p.endsWith('.md'));
  const inputs = files.filter(isInput);

  if (inputs.length > 0) {
    const shown = inputs.slice(0, 10).join(', ') + (inputs.length > 10 ? `, and ${inputs.length - 10} more` : '');
    return {
      build: true,
      reason: `${inputs.length} of ${files.length} changed paths since ${base} are image inputs: ${shown}`,
    };
  }
  return {
    build: false,
    reason: files.length
      ? `none of the ${files.length} paths changed since ${base} is an image input: no build`
      : `nothing changed since ${base}: no build`,
  };
}

const { build, reason } = decide();
console.error(reason);
console.log(`build=${build}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ${build ? 'Image inputs changed, building' : 'No image input changed, nothing to build'}\n\n${reason}\n`,
  );
}
