import type { Tutorial } from './types';

export const traderTutorial: Tutorial = {
  id: 'trader',
  title: 'Forecast and trade',
  blurb: 'Marketplace, joining a workspace, placing your first forecast.',
  steps: [
    {
      id: 'welcome',
      kind: 'modal',
      title: 'Find a market, forecast it',
      body: () => "You can earn credits by predicting metrics correctly in any public workspace. This tutorial points you at the marketplace and walks you through your first trade. (Coming in the next iteration of this skill — for now use the Marketplace, Markets, and Leaderboard tabs directly.)",
      primaryLabel: 'OK',
    },
    {
      id: 'done',
      kind: 'modal',
      title: 'Trader tutorial coming soon',
      body: () => 'Once Tutorial 1 is solid, the Trader walkthrough will go here. Use the Marketplace in the sidebar to find public workspaces to join.',
      primaryLabel: 'Finish',
    },
  ],
};
