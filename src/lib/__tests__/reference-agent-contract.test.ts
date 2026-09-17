import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
// @ts-expect-error plain ESM script, no types
import { flagsOf, surfaceOf } from '../../../scripts/check-reference-agent-commands.mjs';
import { manualCommands } from '../../components/AgentManualSetup';
import surface from '../reference-agent-surface.json';

/** `python <file>.py --flag ...` and `-r <file>` uses in a block of shell text. */
function uses(text: string) {
  const out: { file: string; flag?: string }[] = [];
  for (const line of text.split('\n')) {
    const req = line.match(/-r (\S+)/);
    if (req) out.push({ file: req[1] });
    const run = line.match(/\s(\w+\.py)\b(.*)$/);
    if (!run) continue;
    out.push({ file: run[1] });
    for (const flag of run[2].replace(/#.*$/, '').match(/--[a-z][a-z0-9-]*/g) ?? []) out.push({ file: run[1], flag });
  }
  return out;
}

function expectOffered(text: string, where: string) {
  const found = uses(text);
  expect(found.length, `${where} names no commands; the extractor is broken`).toBeGreaterThan(0);
  for (const { file, flag } of found) {
    expect(surface.files, `${where} names ${file}`).toContain(file);
    if (flag)
      expect((surface.flags as Record<string, string[]>)[file], `${where} runs ${file} ${flag}`).toContain(flag);
  }
}

test.each(['unix', 'windows'] as const)(
  'every file and flag the %s manual setup names exists in the reference agent',
  os => {
    for (const workspace of ['', 'ws-one'])
      expectOffered(Object.values(manualCommands(os, workspace)).join('\n'), '/agents');
  },
);

test('every file and flag the build guide names exists in the reference agent', () => {
  const guide = readFileSync('docs/guides/build-agent.md', 'utf8');
  const blocks = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).join('\n');
  expectOffered(blocks, 'build-agent.md');
});

test('a command the agent does not offer is caught', () => {
  expect(() => expectOffered('.venv/bin/python agent.py --no-such-flag', 'x')).toThrow(/--no-such-flag/);
  expect(() => expectOffered('pip install -r missing.txt', 'x')).toThrow(/missing.txt/);
});

test('flags are read from argparse, and llm_agent.py inherits agent.py flags', () => {
  const agent = 'ap.add_argument("--live", action="store_true")\nap.add_argument(\n  "--every", type=float)';
  const llm = 'ap = agent.parser(doc)\nap.add_argument("--max-tokens")';
  expect(flagsOf(agent)).toEqual(['--every', '--live']);
  expect(surfaceOf({ 'agent.py': agent, 'llm_agent.py': llm, 'requirements.txt': 'x' })).toEqual({
    files: ['agent.py', 'llm_agent.py', 'requirements.txt'],
    flags: { 'agent.py': ['--every', '--live'], 'llm_agent.py': ['--every', '--live', '--max-tokens'] },
  });
});
