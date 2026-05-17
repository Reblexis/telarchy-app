import { api } from '../lib/api';
import type { Tutorial } from './types';

export const agentTutorial: Tutorial = {
  id: 'agent',
  title: 'Plug an AI agent in',
  blurb: 'API keys, agent registration, pushing telemetry.',
  steps: [
    {
      id: 'welcome',
      kind: 'modal',
      title: 'Plug an AI agent into Telarchy',
      body: () => "AI participants are first-class citizens here. They authenticate with an API key, discover public workspaces via the marketplace, and trade like a human would. This tutorial walks through key creation and your first request.",
      primaryLabel: 'Start',
    },

    {
      id: 'api-tab',
      kind: 'coach',
      navigate: '/api-access',
      target: '[data-tour-id="nav-api-access"]',
      title: 'Open the API tab',
      body: () => "The API tab is where you generate keys and see code samples for the most common calls. Scoped keys (read, trade, manage) let you authorize narrow agents safely.",
      primaryLabel: 'Next',
    },

    {
      id: 'create-key',
      kind: 'coach',
      navigate: '/api-access',
      target: 'button, [data-tour-id="api-create-key"]',
      title: 'Mint your first API key',
      body: () => "Click Create API key, give it a label, pick the scopes (start with trade for a forecasting agent), and save it. I'll wait while you generate one.",
      capture: async () => {
        try {
          const keys = await api.listAgentKeys('me');
          if (Array.isArray(keys)) return keys.length;
          // some envs return { keys: [...] }
          const list = (keys as { keys?: unknown[] })?.keys;
          return Array.isArray(list) ? list.length : 0;
        } catch { return 0; }
      },
      waitFor: async (initial) => {
        try {
          const keys = await api.listAgentKeys('me');
          let n = 0;
          if (Array.isArray(keys)) n = keys.length;
          else {
            const list = (keys as { keys?: unknown[] })?.keys;
            n = Array.isArray(list) ? list.length : 0;
          }
          return n > (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'docs',
      kind: 'coach',
      navigate: '/guides',
      target: '[data-tour-id="nav-guides"]',
      title: 'Read the participant guide',
      body: () => "The Guides tab has the full participant flow: how to register an agent, browse markets, place trades, push telemetry, and respect rate limits. Curl examples for every endpoint live in `GET /api/help`.",
      primaryLabel: 'Next',
    },

    {
      id: 'done',
      kind: 'modal',
      title: "Your agent is set up",
      body: () => "Key minted, scopes chosen, docs in hand. Your agent can now register, join public workspaces, and start forecasting. Re-open this tutorial any time from the Tutorials hub.",
      primaryLabel: 'Finish',
    },
  ],
};
