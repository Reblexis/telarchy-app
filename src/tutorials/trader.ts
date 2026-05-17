import { api } from '../lib/api';
import type { Tutorial } from './types';

export const traderTutorial: Tutorial = {
  id: 'trader',
  title: 'Forecast and trade',
  blurb: 'Marketplace, joining a workspace, placing your first forecast.',
  steps: [
    {
      id: 'welcome',
      kind: 'modal',
      title: 'Find a market, predict it',
      body: () => "Telarchy public workspaces let anyone forecast their KPIs. Pick a workspace whose metrics you have a view on, join it, and place trades. If your forecasts are right, you earn credits.",
      primaryLabel: 'Start',
    },

    {
      id: 'marketplace',
      kind: 'coach',
      navigate: '/marketplace',
      target: '[data-tour-id="nav-marketplace"]',
      title: 'Find a public workspace to join',
      body: () => "The Marketplace lists every public workspace. Each row shows the workspace's most active markets and the rough size of the pool. Pick one whose KPIs you can forecast and click Join.",
      capture: async () => {
        try {
          const wss = await api.listWorkspaces();
          return Array.isArray(wss) ? (wss as Array<{ id: string }>).length : 0;
        } catch { return 0; }
      },
      waitFor: async (initial) => {
        try {
          const wss = await api.listWorkspaces();
          const n = Array.isArray(wss) ? (wss as Array<{ id: string }>).length : 0;
          return n > (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'markets',
      kind: 'coach',
      navigate: '/markets',
      target: '[data-tour-id="nav-markets"]',
      title: 'Browse the open markets',
      body: () => "After joining, each workspace's Markets tab shows every priced market. Each card is a forecast you can trade on. Filter by Open vs Resolved at the top. Click a card to expand it and see the trading panel.",
      primaryLabel: 'Next',
    },

    {
      id: 'trade',
      kind: 'coach',
      navigate: '/markets',
      target: '.market-card',
      title: 'Place your first forecast',
      body: () => "Expand any open market and use the trading panel on the right. Choose Higher or Lower, type an amount, and confirm. I'll wait while you place your first trade.",
      capture: async (ctx) => {
        if (!ctx.workspaceId) return 0;
        try {
          const positions = await api.getPositions(undefined, undefined, ctx.workspaceId);
          return Array.isArray(positions) ? (positions as unknown[]).length : 0;
        } catch { return 0; }
      },
      waitFor: async (initial, ctx) => {
        if (!ctx.workspaceId) return false;
        try {
          const positions = await api.getPositions(undefined, undefined, ctx.workspaceId);
          const n = Array.isArray(positions) ? (positions as unknown[]).length : 0;
          return n > (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'leaderboard',
      kind: 'coach',
      navigate: '/leaderboard',
      target: '[data-tour-id="nav-leaderboard"]',
      title: 'Track your rank',
      body: () => "The Leaderboard ranks every participant by realized P/L. Your rank updates as your forecasts resolve. Consistent forecasters earn most of the credits.",
      primaryLabel: 'Next',
    },

    {
      id: 'done',
      kind: 'modal',
      title: "You're trading",
      body: () => "Marketplace -> Join -> Trade -> Rank. That's the trader loop. Re-open this tutorial any time from the Tutorials hub in the sidebar.",
      primaryLabel: 'Finish',
    },
  ],
};
