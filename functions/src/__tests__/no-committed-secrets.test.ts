/**
 * No credential may live in the tracked tree.
 *
 * The prod admin password was committed in eight places until 2026-08-24 (P0 of the
 * open-source release plan). This test walks `git ls-files` from the repo root and
 * fails on anything that looks like a secret: the retired literal, a password literal
 * beside an email, private-key headers, and the well-known token prefixes. Emails alone
 * are allowed (the privacy contact is published on purpose).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');

const PATTERNS: Array<[string, RegExp]> = [
  ['retired admin password', /TestAdmin99/],
  // example.com / example.org addresses are fixtures, not accounts.
  [
    'password literal beside an email',
    /"email"\s*:\s*"[^"@]+@(?!example\.(com|org))[^"]+"\s*,\s*"password"\s*:\s*"(?!\$|\\"\$)[^"]{4,}"/,
  ],
  [
    'password literal beside an email (single quotes)',
    /email:\s*'[^'@]+@(?!example\.(com|org))[^']+'\s*,\s*password:\s*'[^']{4,}'/,
  ],
  ['private key header', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['OpenAI / Anthropic style key', /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['Slack token', /xox[abpr]-[A-Za-z0-9-]{20,}/],
];

const SKIP = /\.(png|jpg|jpeg|gif|ico|pdf|ics|woff2?|ttf|eot|lock)$/;
const SELF = 'functions/src/__tests__/no-committed-secrets.test.ts';

describe('no committed secrets', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter(f => f && f !== SELF && !SKIP.test(f));

  test('tracked tree has no credential-looking content', () => {
    const hits: string[] = [];
    for (const f of files) {
      const p = join(ROOT, f);
      let text: string;
      try {
        if (statSync(p).size > 2_000_000) continue;
        text = readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      for (const [name, re] of PATTERNS) {
        if (re.test(text)) hits.push(`${f}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('no .env file other than the example is tracked', () => {
    const envs = files.filter(f => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith('.example'));
    expect(envs).toEqual([]);
  });
});
