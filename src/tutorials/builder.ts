import { api } from '../lib/api';
import type { Tutorial } from './types';

// Per-template category, suggest a starter proposal title the user can use as
// the "Submit a proposal" step.
function suggestionForTemplate(templateId: string | null): string {
  if (!templateId) return 'Start using Telarchy for my goals';
  if (templateId === 'saas' || templateId === 'startup') return 'Start using Telarchy for my SaaS startup';
  if (templateId === 'ecommerce') return 'Start using Telarchy for my e-commerce business';
  if (templateId === 'agency') return 'Start using Telarchy for my agency';
  if (templateId === 'marketplace') return 'Start using Telarchy for my marketplace';
  if (templateId === 'creator' || templateId === 'consumer-app' || templateId === 'community' || templateId === 'oss') {
    return `Start using Telarchy for my ${templateId.replace('-', ' ')}`;
  }
  if (templateId === 'wellbeing' || templateId === 'health-fitness' || templateId === 'career'
   || templateId === 'learning' || templateId === 'relationships' || templateId === 'creative-project'
   || templateId === 'financial-independence' || templateId === 'personal') {
    return 'Start using Telarchy for my personal goals';
  }
  return 'Start using Telarchy for my goals';
}

export const builderTutorial: Tutorial = {
  id: 'builder',
  title: 'Run the loop end-to-end',
  blurb: 'Workspace, metric, check-in, proposal, approval. About 5 minutes.',
  steps: [
    {
      id: 'welcome',
      kind: 'modal',
      title: "Let's run the loop",
      body: () => "Telarchy works because you do five things in order: pick what you care about, log where you are, propose actions, let the market price them, and decide on a calibrated number. This tutorial waits for you at each step.",
      primaryLabel: 'Start',
    },

    // Step 1: workspace. If the user already has one, the waitFor returns
    // true on first poll and the tour advances immediately to step 2.
    {
      id: 'create-workspace',
      kind: 'coach',
      navigate: '/create-workspace',
      target: 'form input[type="text"], input[name="name"], input[placeholder*="name" i]',
      title: 'Name your workspace',
      body: () => "Give your workspace a name (your company, your project, or your goals). Pick the template that fits. I'll wait while you submit.",
      capture: async () => null,
      waitFor: async () => {
        try {
          const wss = await api.listWorkspaces();
          return Array.isArray(wss) && wss.length >= 1;
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'add-metric',
      kind: 'coach',
      navigate: '/metrics',
      target: '[data-tour-id="metric-add-ghost"]',
      title: 'Add your first metric',
      body: () => "Click the + Add metric card and define one KPI. Pick whatever you actually want to track. I'll wait while you save.",
      capture: async () => {
        try {
          const ms = await api.getMetrics();
          return Array.isArray(ms) ? (ms as Array<{ id: string }>).length : null;
        } catch { return null; }
      },
      waitFor: async (initial) => {
        if (initial === null) return false;
        try {
          const ms = await api.getMetrics();
          const n = Array.isArray(ms) ? (ms as Array<{ id: string }>).length : 0;
          return n > (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'check-in',
      kind: 'coach',
      navigate: '/check-in',
      target: '[data-tour-id="nav-check-in"]',
      title: 'Log a current value',
      body: () => "On the Check-in page, type today's value for the metric you just added. Auto-saves, so a number is enough.",
      capture: async () => {
        try {
          const ms = await api.getMetrics();
          if (!Array.isArray(ms)) return 0;
          const list = ms as Array<{ updatedAt?: string }>;
          // Use max updatedAt timestamp as a "last touched" signal.
          let max = 0;
          for (const m of list) {
            if (m.updatedAt) {
              const t = Date.parse(m.updatedAt);
              if (Number.isFinite(t) && t > max) max = t;
            }
          }
          return max;
        } catch { return 0; }
      },
      waitFor: async (initial) => {
        try {
          const ms = await api.getMetrics();
          if (!Array.isArray(ms)) return false;
          const list = ms as Array<{ updatedAt?: string }>;
          let max = 0;
          for (const m of list) {
            if (m.updatedAt) {
              const t = Date.parse(m.updatedAt);
              if (Number.isFinite(t) && t > max) max = t;
            }
          }
          return max > (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'submit-proposal',
      kind: 'coach',
      navigate: '/proposals',
      target: '[data-tour-id="proposals-new"]',
      title: 'Propose your first action',
      body: (ctx) => `Click + New proposal. Try a title like: "${suggestionForTemplate(ctx.templateId)}". Each new proposal spawns conditional markets that forecast its impact on every metric.`,
      capture: async () => {
        try {
          const ps = await api.getProposals();
          return Array.isArray(ps) ? (ps as Array<{ id: string }>).length : 0;
        } catch { return 0; }
      },
      waitFor: async (initial) => {
        try {
          const ps = await api.getProposals();
          const n = Array.isArray(ps) ? (ps as Array<{ id: string }>).length : 0;
          return n > (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'approve-or-decline',
      kind: 'coach',
      navigate: '/proposals',
      target: '[data-tour-id="proposals-first-row"]',
      title: 'Decide on the number',
      body: () => "Open a proposal and check the Impact predictions table. Approve when the forecast convinces you, decline when it doesn't. I'll wait until any pending proposal moves to approved or declined.",
      capture: async () => {
        try {
          const ps = await api.getProposals();
          if (!Array.isArray(ps)) return 0;
          const list = ps as Array<{ status?: string }>;
          return list.filter(p => p.status === 'pending').length;
        } catch { return 0; }
      },
      waitFor: async (initial) => {
        try {
          const ps = await api.getProposals();
          if (!Array.isArray(ps)) return false;
          const list = ps as Array<{ status?: string }>;
          const pending = list.filter(p => p.status === 'pending').length;
          // Any proposal moved out of pending = success.
          return pending < (initial as number);
        } catch { return false; }
      },
      pollMs: 2500,
      waitOnly: true,
    },

    {
      id: 'done',
      kind: 'modal',
      title: "You ran the loop",
      body: () => "Metric, value, proposal, market, approval. That's the playbook. Re-open this tutorial any time from the Tutorials hub in the sidebar.",
      primaryLabel: 'Finish',
    },
  ],
};
