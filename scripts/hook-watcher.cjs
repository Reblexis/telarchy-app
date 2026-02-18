#!/usr/bin/env node
//
// Hook Watcher — one-shot poll. Run via system crontab every minute.
// Zero LLM cost unless an event matches an agent's hooks.
//
// crontab: * * * * * /usr/bin/node /home/cihalvi/src/metrics-tracker/scripts/hook-watcher.js >> /tmp/hook-watcher.log 2>&1
//

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_URL = process.env.METRICS_TRACKER_URL || 'https://metrics-tracker-vcihal.web.app/api';
const INTERVAL_MS = 60_000;
const OPENCLAW_DIR = path.join(require('os').homedir(), '.openclaw');
const STATE_FILE = path.join(OPENCLAW_DIR, '.hook-watcher-state.json');
const WORKSPACES_DIR = path.join(OPENCLAW_DIR, 'workspaces');

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastPolledAt: new Date(Date.now() - INTERVAL_MS).toISOString() };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function findApiKey() {
  if (process.env.METRICS_TRACKER_KEY) return process.env.METRICS_TRACKER_KEY;
  const agents = fs.readdirSync(WORKSPACES_DIR).filter(d => {
    const keyFile = path.join(WORKSPACES_DIR, d, '.metrics-trader-key');
    return fs.existsSync(keyFile);
  });
  if (agents.length === 0) { console.error('No agent key found. Set METRICS_TRACKER_KEY or register an agent.'); process.exit(1); }
  return fs.readFileSync(path.join(WORKSPACES_DIR, agents[0], '.metrics-trader-key'), 'utf-8').trim();
}

function loadAgentHooks() {
  const hooks = [];
  if (!fs.existsSync(WORKSPACES_DIR)) return hooks;
  for (const dir of fs.readdirSync(WORKSPACES_DIR)) {
    const hookFile = path.join(WORKSPACES_DIR, dir, 'hooks.json');
    if (!fs.existsSync(hookFile)) continue;
    const config = JSON.parse(fs.readFileSync(hookFile, 'utf-8'));
    hooks.push({ agentId: dir, events: config.events || [] });
  }
  return hooks;
}

async function fetchEvents(apiKey, since) {
  const url = `${API_URL}/events?since=${encodeURIComponent(since)}`;
  const res = await fetch(url, { headers: { 'X-Agent-Key': apiKey } });
  if (!res.ok) { console.error(`Events API error: ${res.status} ${await res.text()}`); return []; }
  return res.json();
}

async function postHeartbeat(apiKey) {
  await fetch(`${API_URL}/events/hooks/heartbeat`, {
    method: 'POST',
    headers: { 'X-Agent-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastPolledAt: new Date().toISOString(), intervalMs: INTERVAL_MS }),
  }).catch(err => console.error('Heartbeat failed:', err.message));
}

function wakeAgent(agentId, events) {
  const summary = events.map(e => `- ${e.type}: ${JSON.stringify(e.data)}`).join('\n');
  const message = `Hook events triggered. Review and act on these:\n${summary}\n\nRead HEARTBEAT.md and follow your strategy.`;
  const cmd = `openclaw agent --agent ${agentId} --session isolated --timeout 120 --message ${JSON.stringify(message)} --no-deliver`;
  console.log(`  Waking ${agentId} with ${events.length} event(s)`);
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 150_000 });
  } catch (err) {
    console.error(`  Failed to wake ${agentId}:`, err.message);
  }
}

async function main() {
  const state = loadState();
  const apiKey = findApiKey();
  const agentHooks = loadAgentHooks();
  const now = new Date().toISOString();

  const events = await fetchEvents(apiKey, state.lastPolledAt);
  await postHeartbeat(apiKey);
  saveState({ lastPolledAt: now });

  if (events.length === 0 || agentHooks.length === 0) return;

  console.log(`[${now}] ${events.length} new event(s)`);
  for (const { agentId, events: subscribedEvents } of agentHooks) {
    const matched = events.filter(e => subscribedEvents.includes(e.type));
    if (matched.length > 0) wakeAgent(agentId, matched);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
