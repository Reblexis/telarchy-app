import type { Tutorial } from './types';

export const agentTutorial: Tutorial = {
  id: 'agent',
  title: 'Build or integrate an AI participant',
  blurb: 'API keys, agent registration, pushing telemetry.',
  steps: [
    {
      id: 'welcome',
      kind: 'modal',
      title: 'Plug an AI agent in',
      body: () => "AI participants register with an API key, browse public workspaces via the marketplace, and trade like any human. This tutorial will walk through key creation and the first /admin telemetry push. (Coming in the next iteration of this skill — use the API tab in the sidebar for now.)",
      primaryLabel: 'OK',
    },
    {
      id: 'done',
      kind: 'modal',
      title: 'Agent tutorial coming soon',
      body: () => 'Once Tutorial 1 is solid, the AI agent walkthrough will go here. Use the API tab in the sidebar to generate your first key, or read the participant flow at /api/guides/participants.',
      primaryLabel: 'Finish',
    },
  ],
};
