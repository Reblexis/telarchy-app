#!/usr/bin/env node
//
// Status-quo betting script.
// Bets on every open market that the metric's current value will stay the same.
// Uses targetValue mode — buys shares to move consensus to the current metric value.
//
// Usage:
//   node status-quo-bet.cjs --all                    Bet on all open markets
//   node status-quo-bet.cjs --market <marketId>       Bet on a single market
//   node status-quo-bet.cjs --metric <metricId>       Bet on all open markets for a metric
//
// Environment:
//   TELARCHY_URL         API base URL (default: https://metrics-tracker-vcihal.web.app/api)
//   MAX_BUDGET            Max credits per market (default: 10000)
//
// The script reads the API key from ~/.openclaw/workspaces/status-quo/.metrics-trader-key

const fs = require('fs');
const path = require('path');

const API_URL = process.env.TELARCHY_URL || 'https://metrics-tracker-vcihal.web.app/api';
const MAX_BUDGET = Number(process.env.MAX_BUDGET) || 10000;
const AGENT_ID = 'status-quo';
const KEY_FILE = path.join(require('os').homedir(), '.openclaw', 'workspaces', AGENT_ID, '.metrics-trader-key');

function readApiKey() {
  return fs.readFileSync(KEY_FILE, 'utf-8').trim();
}

async function api(method, endpoint, apiKey, body) {
  const opts = {
    method,
    headers: { 'X-Agent-Key': apiKey, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${endpoint}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function betOnMarket(apiKey, market, metricsByIdOrNull) {
  // market can be a pre-fetched list item (has rangeMin/rangeMax/metricId) or a market id string
  if (typeof market === 'string') {
    market = await api('GET', `/predictions/markets/${market}`, apiKey);
  }
  const metric = metricsByIdOrNull?.[market.metricId]
    ?? await api('GET', `/metrics/${market.metricId}`, apiKey);
  const value = Math.max(market.rangeMin, Math.min(market.rangeMax, metric.total));

  const result = await api('POST', '/predictions/trade', apiKey, {
    marketId: market.id,
    targetValue: value,
    maxBudget: MAX_BUDGET,
  });
  console.log(`Bet on "${market.metricName}" @ ${market.targetDate}: value=${value}, cost=${result.cost}, consensus=${result.consensus}`);
  return result;
}

async function betAll(apiKey) {
  const [markets, allMetrics, { balance: startBalance }] = await Promise.all([
    api('GET', '/predictions/markets', apiKey),
    api('GET', '/metrics', apiKey),
    api('GET', `/agents/${AGENT_ID}/balance`, apiKey),
  ]);

  if (startBalance < 1) { console.log('Out of credits.'); return; }

  const metricsById = Object.fromEntries(allMetrics.map(m => [m.id, m]));

  let bets = 0;
  for (const market of markets) {
    try {
      await betOnMarket(apiKey, market, metricsById);
      bets++;
    } catch (err) {
      if (err.message.includes('Insufficient balance')) { console.log('Out of credits.'); break; }
      console.error(`Failed on ${market.id}: ${err.message}`);
    }
  }
  console.log(`Placed ${bets} bet(s).`);
}

async function main() {
  const apiKey = readApiKey();
  const args = process.argv.slice(2);

  if (args[0] === '--all') {
    await betAll(apiKey);
  } else if (args[0] === '--market' && args[1]) {
    const { balance } = await api('GET', `/agents/${AGENT_ID}/balance`, apiKey);
    if (balance < 1) { console.log('Out of credits.'); return; }
    await betOnMarket(apiKey, args[1], null);
  } else if (args[0] === '--metric' && args[1]) {
    const [markets, allMetrics, { balance }] = await Promise.all([
      api('GET', '/predictions/markets', apiKey),
      api('GET', '/metrics', apiKey),
      api('GET', `/agents/${AGENT_ID}/balance`, apiKey),
    ]);
    if (balance < 1) { console.log('Out of credits.'); return; }
    const metricsById = Object.fromEntries(allMetrics.map(m => [m.id, m]));
    const matching = markets.filter(m => m.metricId === args[1]);
    if (matching.length === 0) { console.log(`No open markets for metric ${args[1]}.`); return; }
    for (const market of matching) {
      try {
        await betOnMarket(apiKey, market, metricsById);
      } catch (err) {
        if (err.message.includes('Insufficient balance')) { console.log('Out of credits.'); break; }
        console.error(`Failed on ${market.id}: ${err.message}`);
      }
    }
  } else {
    console.error('Usage: status-quo-bet.cjs --all | --market <marketId> | --metric <metricId>');
    process.exit(1);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
