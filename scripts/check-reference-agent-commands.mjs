#!/usr/bin/env node
/**
 * The /agents page and the build guide tell a newcomer to clone
 * Reblexis/telarchy-reference-agent and run files and flags by name. On
 * 2026-09-17 every one of those commands failed, because the page had shipped
 * against a branch of that repo that was never merged.
 *
 * src/lib/reference-agent-surface.json records what the agent's main branch
 * offers; a unit test holds the page and the guide to that record. This script
 * holds the record to the real main branch:
 *
 *   node scripts/check-reference-agent-commands.mjs          # verify, exit 1 on drift
 *   node scripts/check-reference-agent-commands.mjs --write  # re-record from main
 */
import { readFileSync, writeFileSync } from 'node:fs';

const RAW = 'https://raw.githubusercontent.com/Reblexis/telarchy-reference-agent/main/';
const SURFACE = 'src/lib/reference-agent-surface.json'; // run from the repo root, as CI and npm do
const FILES = ['agent.py', 'llm_agent.py', 'requirements.txt'];

/** Every `--flag` a Python file registers with argparse. */
export function flagsOf(source) {
  // Anchored to the start of a line so a commented-out registration offers nothing.
  return [...source.matchAll(/^[ \t]*[\w.]+\.add_argument\(\s*["'](--[a-z][a-z0-9-]*)["']/gm)].map(m => m[1]).sort();
}

/** llm_agent.py builds on agent.parser(), so it answers to agent.py's flags too. */
export function surfaceOf(sources) {
  const base = flagsOf(sources['agent.py'] ?? '');
  const flags = {};
  for (const [file, source] of Object.entries(sources)) {
    if (!file.endsWith('.py')) continue;
    const own = flagsOf(source);
    flags[file] = file !== 'agent.py' && /agent\.parser\(/.test(source) ? [...new Set([...base, ...own])].sort() : own;
  }
  return { files: Object.keys(sources).sort(), flags };
}

async function main() {
  const sources = {};
  for (const file of FILES) {
    const res = await fetch(RAW + file);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    sources[file] = await res.text();
  }
  const live = surfaceOf(sources);
  if (process.argv.includes('--write')) {
    writeFileSync(SURFACE, `${JSON.stringify(live, null, 2)}\n`);
    console.log(`recorded ${SURFACE}`);
    return;
  }
  const recorded = JSON.parse(readFileSync(SURFACE, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(live)) {
    console.error('The reference agent main branch no longer matches src/lib/reference-agent-surface.json.');
    console.error(`main offers:  ${JSON.stringify(live)}`);
    console.error(`recorded:     ${JSON.stringify(recorded)}`);
    console.error('Re-record with --write, then run the frontend tests: they say which page command broke.');
    process.exit(1);
  }
  console.log('reference agent main matches the recorded surface');
}

if (process.argv[1]?.endsWith('check-reference-agent-commands.mjs')) await main();
