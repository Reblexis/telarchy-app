import type { Tutorial, TabTutorialId } from './types';

/**
 * Tab-specific deep-dive mini-tutorials. Each one fires when the user
 * accepts the per-tab opt-in banner on their first visit, and again
 * any time from the Tutorials hub. These are SEPARATE from the
 * persona-track tutorials (builder / trader / agent) and intentionally
 * shorter and more tab-specific.
 */
export const TAB_TUTORIAL_IDS = [
  'tab-metrics',
  'tab-markets',
  'tab-proposals',
  'tab-sources',
  'tab-marketplace',
  'tab-leaderboard',
  'tab-participants',
] as const;

export interface TabTutorialMeta {
  /** Which page path triggers the opt-in banner. */
  path: string;
  /** Banner copy: short, action-oriented. */
  bannerCta: string;
}

export const TAB_TUTORIAL_META: Record<TabTutorialId, TabTutorialMeta> = {
  'tab-metrics': { path: '/metrics', bannerCta: 'New here? Take a 30-second tour of the Metrics tab.' },
  'tab-markets': { path: '/markets', bannerCta: 'Quick tour of the Markets tab?' },
  'tab-proposals': { path: '/proposals', bannerCta: 'Quick tour of the Proposals tab?' },
  'tab-sources': { path: '/sources', bannerCta: 'Quick tour of the Sources tab?' },
  'tab-marketplace': { path: '/marketplace', bannerCta: 'Quick tour of the Marketplace?' },
  'tab-leaderboard': { path: '/leaderboard', bannerCta: 'Quick tour of the Leaderboard?' },
  'tab-participants': { path: '/participants', bannerCta: 'Quick tour of the Participants tab?' },
};

const metricsTabTutorial: Tutorial = {
  id: 'tab-metrics',
  title: 'Metrics in detail',
  blurb: 'Add metrics, write formulas, browse the hierarchy.',
  steps: [
    {
      id: 'add', kind: 'coach', navigate: '/metrics',
      target: '[data-tour-id="metric-add-ghost"]',
      title: 'Add metrics',
      body: () => "Every metric needs a name. Click + Add metric, expand More options to set an initial value, formula, market range, and half-life. Half-life determines how fast future values discount in forecasts. Track whatever matters to you.",
      primaryLabel: 'Next',
    },
    {
      id: 'cards', kind: 'coach', navigate: '/metrics',
      target: '.metric-card',
      title: 'Metric cards',
      body: () => "Every tracked metric shows here. The Zoom button drills into history, Graph shows the forecast chart from the metric's open markets, Edit opens the full form, Delete voids the metric and refunds any market liquidity.",
      primaryLabel: 'Next',
    },
    {
      id: 'formula', kind: 'coach', navigate: '/metrics',
      target: '.metric-card',
      title: 'Formulas compose metrics',
      body: () => 'A formula like {Revenue} - {Costs} makes one metric a function of others. Composed metrics are recomputed on every change; the graph view shows propagated forecasts too.',
      primaryLabel: 'Done',
    },
  ],
};

const marketsTabTutorial: Tutorial = {
  id: 'tab-markets',
  title: 'Markets in detail',
  blurb: 'Filter, expand a market, trade in it.',
  steps: [
    {
      id: 'filter', kind: 'coach', navigate: '/markets',
      target: '.markets-filters, .markets-list',
      title: 'Filter open vs resolved',
      body: () => 'The chip row at the top filters by status. Open markets are still accepting trades. Resolved markets paid out; you can still see their final prices.',
      primaryLabel: 'Next',
    },
    {
      id: 'expand', kind: 'coach', navigate: '/markets',
      target: '.market-card',
      title: 'Expand a market to trade',
      body: () => "Click any market card to open the trading panel. Pick Higher or Lower against the current consensus, type an amount, and confirm. If you're right when the market resolves, you earn credits.",
      primaryLabel: 'Done',
    },
  ],
};

const proposalsTabTutorial: Tutorial = {
  id: 'tab-proposals',
  title: 'Proposals in detail',
  blurb: 'Submit, inspect, approve, decline.',
  steps: [
    {
      id: 'submit', kind: 'coach', navigate: '/proposals',
      target: '[data-tour-id="proposals-new"]',
      title: 'Submit a proposal',
      body: () => "Anyone with trade capability can propose. Each new proposal spawns conditional markets that forecast its impact on every metric. Adding a liquidity subsidy makes traders show up faster, but is optional.",
      primaryLabel: 'Next',
    },
    {
      id: 'inspect', kind: 'coach', navigate: '/proposals',
      target: '[data-tour-id="proposals-first-row"]',
      title: 'Open the drawer',
      body: () => "Click any row to open the proposal drawer. The Impact predictions table shows the conditional markets' forecast for each metric if approved. Use Inspect to overlay those forecasts on the Metrics page.",
      primaryLabel: 'Next',
    },
    {
      id: 'decide', kind: 'coach', navigate: '/proposals',
      target: '[data-tour-id="proposals-first-row"]',
      title: 'Approve or decline',
      body: () => "Admins approve when the forecast convinces them. Declining voids the conditional markets and refunds stakes. Either action moves the proposal out of pending.",
      primaryLabel: 'Done',
    },
  ],
};

const sourcesTabTutorial: Tutorial = {
  id: 'tab-sources',
  title: 'Sources in detail',
  blurb: 'Auto-populate metrics from external systems.',
  steps: [
    {
      id: 'add', kind: 'coach', navigate: '/sources',
      target: '.sources-list, .page-content',
      title: 'Add a source',
      body: () => "Sources auto-feed metric values from external systems: URL endpoints, formulas over other metrics, GitHub repos, Codeforces ratings, and more. Add a source once and every workspace participant sees the updated values.",
      primaryLabel: 'Done',
    },
  ],
};

const marketplaceTabTutorial: Tutorial = {
  id: 'tab-marketplace',
  title: 'Marketplace in detail',
  blurb: 'Browse public workspaces and join.',
  steps: [
    {
      id: 'browse', kind: 'coach', navigate: '/marketplace',
      target: '.marketplace-list, .page-content',
      title: 'Every public workspace',
      body: () => "Public workspaces grant Trader capability to anyone who joins. Pick one whose KPIs you can forecast and click Join. After joining you can browse its Markets tab and place trades.",
      primaryLabel: 'Done',
    },
  ],
};

const leaderboardTabTutorial: Tutorial = {
  id: 'tab-leaderboard',
  title: 'Leaderboard in detail',
  blurb: 'How rank, P/L, and credit awards work.',
  steps: [
    {
      id: 'rank', kind: 'coach', navigate: '/leaderboard',
      target: '.leaderboard-list, .leaderboard-row, .page-content',
      title: 'Realized P/L ranks you',
      body: () => "Rank is realized profit and loss across all your closed markets. Open positions do not count until resolution. Top forecasters earn periodic credit awards from the platform.",
      primaryLabel: 'Done',
    },
  ],
};

const participantsTabTutorial: Tutorial = {
  id: 'tab-participants',
  title: 'Participants in detail',
  blurb: 'Invite humans, register AI agents, set roles.',
  steps: [
    {
      id: 'roles', kind: 'coach', navigate: '/participants',
      target: '.participants-list, .page-content',
      title: 'Roles and groups',
      body: () => "Roles control who can do what: owner (everything), admin (manage workspace), trader (forecast), viewer (read-only). Permission groups let you assign roles by group rather than per-user; the Public group governs anonymous capability for public workspaces.",
      primaryLabel: 'Done',
    },
  ],
};

export const TAB_TUTORIALS: Record<TabTutorialId, Tutorial> = {
  'tab-metrics': metricsTabTutorial,
  'tab-markets': marketsTabTutorial,
  'tab-proposals': proposalsTabTutorial,
  'tab-sources': sourcesTabTutorial,
  'tab-marketplace': marketplaceTabTutorial,
  'tab-leaderboard': leaderboardTabTutorial,
  'tab-participants': participantsTabTutorial,
};
