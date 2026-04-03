#!/usr/bin/env node
//
// Hook Watcher — one-shot poll. Run via system crontab every minute.
// Zero LLM cost unless an event matches an agent's hooks.
//
// crontab: * * * * * /usr/bin/node /home/cihalvi/src/metrics-tracker/scripts/hook-watcher.js >> /tmp/hook-watcher.log 2>&1
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API_URL = process.env.TELARCHY_URL || 'https://telarchy.com/api';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/home/linuxbrew/.linuxbrew/bin/openclaw';
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

function resolveKeyFile(agentDir) {
  const telarchy = path.join(agentDir, '.telarchy-key');
  const legacy = path.join(agentDir, '.metrics-trader-key');
  if (fs.existsSync(telarchy)) return telarchy;
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

function findApiKey() {
  if (process.env.TELARCHY_KEY) return process.env.TELARCHY_KEY;
  const agents = fs.readdirSync(WORKSPACES_DIR).filter(d => resolveKeyFile(path.join(WORKSPACES_DIR, d)));
  if (agents.length === 0) { console.error('No agent key found. Set TELARCHY_KEY or add .telarchy-key under ~/.openclaw/workspaces/<agentId>/.'); process.exit(1); }
  const keyPath = resolveKeyFile(path.join(WORKSPACES_DIR, agents[0]));
  return fs.readFileSync(keyPath, 'utf-8').trim();
}

// sub: string (event type, match all) or object with optional metricNames/metricIds filters.
// Filtering by metricNames/metricIds is supported for: metric:updated, market:resolved, market:created, trade:executed.
function eventMatchesSubscription(event, sub) {
  const type = typeof sub === 'string' ? sub : sub.type;
  if (event.type !== type) return false;
  if (typeof sub === 'string') return true;
  if (sub.metricNames?.length && !sub.metricNames.includes(event.data?.metricName)) return false;
  if (sub.metricIds?.length && !sub.metricIds.includes(event.data?.metricId)) return false;
  return true;
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
  console.log(`  Waking ${agentId} with ${events.length} event(s)`);
  // Fresh session each invocation so context never accumulates across runs.
  const sessionId = require('crypto').randomUUID();
  // Archive any previous session files so they don't get reloaded next time.
  const sessionsDir = path.join(OPENCLAW_DIR, 'agents', agentId, 'sessions');
  const archiveDir = path.join(sessionsDir, 'archive');
  if (fs.existsSync(sessionsDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const f of fs.readdirSync(sessionsDir)) {
      if (f.endsWith('.jsonl')) {
        fs.renameSync(path.join(sessionsDir, f), path.join(archiveDir, f));
      }
    }
  }
  try {
    execFileSync(OPENCLAW_BIN, [
      'agent', '--agent', agentId, '--local',
      '--timeout', '120', '--session-id', sessionId, '--message', message,
    ], {
      stdio: 'pipe',
      timeout: 150_000,
      env: { ...process.env, PATH: `/home/linuxbrew/.linuxbrew/bin:${process.env.PATH || ''}` },
    });
    return true;
  } catch (err) {
    console.error(`  Failed to wake ${agentId}:`, err.stderr?.toString?.() || err.message);
    return false;
  }
}

const RETRY_MAX_AGE_MS = 10 * 60_000;

async function main() {
  const state = loadState();
  const apiKey = findApiKey();
  const agentHooks = loadAgentHooks();
  const now = new Date().toISOString();
  const nowMs = Date.now();

  const events = await fetchEvents(apiKey, state.lastPolledAt);
  await postHeartbeat(apiKey);

  const pending = state.pending || {};
  const hasPending = Object.keys(pending).length > 0;

  if (events.length === 0 && agentHooks.length === 0 && !hasPending) {
    saveState({ lastPolledAt: now });
    return;
  }

  if (events.length > 0) console.log(`[${now}] ${events.length} new event(s)`);

  const nextPending = {};
  for (const { agentId, events: subscribedEvents } of agentHooks) {
    const matched = events.filter(e => subscribedEvents.some(sub => eventMatchesSubscription(e, sub)));
    const retries = (pending[agentId] || []).filter(e => nowMs - new Date(e.timestamp).getTime() < RETRY_MAX_AGE_MS);
    if (retries.length > 0) console.log(`  Retrying ${retries.length} pending event(s) for ${agentId}`);
    const all = [...retries, ...matched];
    if (all.length === 0) continue;
    if (wakeAgent(agentId, all)) continue;
    nextPending[agentId] = all;
  }

  saveState({
    lastPolledAt: now,
    ...(Object.keys(nextPending).length > 0 && { pending: nextPending }),
  });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
