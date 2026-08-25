/**
 * Workspace templates applied at creation time. Each template encodes the
 * metric-design guide principles (outcomes not activities, genie test, sibling
 * TP nodes for different timescales).
 *
 * Templates produce a flat list of leaf metrics, each with its own time
 * preference and a market range matched to the metric's realistic bounds.
 * Users edit freely after creation.
 *
 * Conventions:
 * - Outside the `personal` category, every metric must be objectively
 *   resolvable (anyone with access to the underlying data lands on the same
 *   number). Avoid feelings, gut reads, or qualitative judgements.
 * - In the `personal` category, where a feeling is genuinely the thing being
 *   tracked, the metric name carries `(self-reported)` and the description
 *   states it is a subjective gut read.
 * - Monetary metrics include the chosen currency (ISO code) in the name and
 *   description.
 */

export type TemplateCategory = 'startup' | 'personal' | 'blank';

export type TemplateId =
  | 'saas'
  | 'ecommerce'
  | 'marketplace'
  | 'consumer-app'
  | 'agency'
  | 'community'
  | 'creator'
  | 'oss'
  | 'wellbeing'
  | 'health-fitness'
  | 'career'
  | 'learning'
  | 'relationships'
  | 'creative-project'
  | 'financial-independence'
  | 'startup'
  | 'personal'
  | 'blank';

export interface TemplateMetricSpec {
  name: string;
  description: string;
  marketRangeMax: number;
  timePreferenceHalfLifeYears: number;
  initialValue: number;
}

export interface TemplateParams {
  /** ISO 4217 currency code used in monetary metric names/descriptions. Defaults to USD. */
  currency?: string;
  /** Upper bound for the template's primary monetary metric (revenue, MRR, GMV, net worth, etc.). */
  revenueRangeMax?: number;
}

export interface TemplateSpec {
  id: TemplateId;
  category: TemplateCategory;
  name: string;
  intent: string;
  /** When true, the create-workspace form should ask for a currency. */
  needsCurrency: boolean;
  /** When set, the form shows a "primary monetary scale" input with this label and default. */
  revenueScale?: { label: string; default: number };
  metrics: (params: TemplateParams) => TemplateMetricSpec[];
}

const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'INR',
  'BRL',
  'MXN',
  'SGD',
  'NZD',
  'ZAR',
];

function normalizeCurrency(c: string | undefined): string {
  if (!c) return 'USD';
  const upper = c.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(upper) ? upper : 'USD';
}

function clampPositive(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && n > 0 && Number.isFinite(n) ? n : fallback;
}

const SAAS: TemplateSpec = {
  id: 'saas',
  category: 'startup',
  name: 'SaaS startup',
  intent: 'MRR, paying customers, churn, trial conversion.',
  needsCurrency: true,
  revenueScale: { label: 'MRR target', default: 100000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const mrrMax = clampPositive(params.revenueRangeMax, 100000);
    return [
      {
        name: `MRR (${cur})`,
        description: `Monthly recurring revenue at week end, summed across active paid subscriptions, in ${cur}.`,
        marketRangeMax: mrrMax,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Paying customers',
        description: 'Distinct accounts on a paid plan at week end (count, from billing system).',
        marketRangeMax: Math.max(100, Math.round(mrrMax / 50)),
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Weekly churn rate (%)',
        description:
          'Paying customers who cancelled this week divided by paying customers at week start, expressed as a percentage (0-100).',
        marketRangeMax: 20,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: 'Trial-to-paid conversion (%)',
        description:
          'Of trials that started in the past 30 days and have ended, the percentage that converted to a paid plan (0-100).',
        marketRangeMax: 100,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
    ];
  },
};

const ECOMMERCE: TemplateSpec = {
  id: 'ecommerce',
  category: 'startup',
  name: 'E-commerce / DTC',
  intent: 'Weekly revenue, orders, AOV, repeat customer rate.',
  needsCurrency: true,
  revenueScale: { label: 'Weekly revenue target', default: 100000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const revMax = clampPositive(params.revenueRangeMax, 100000);
    return [
      {
        name: `Weekly revenue (${cur})`,
        description: `Gross revenue from orders placed this week, in ${cur} (from your storefront analytics).`,
        marketRangeMax: revMax,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Orders shipped',
        description: 'Orders shipped to customers this week (count, from fulfillment system).',
        marketRangeMax: Math.max(100, Math.round(revMax / 50)),
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: `Average order value (${cur})`,
        description: `Weekly revenue divided by orders placed this week, in ${cur}.`,
        marketRangeMax: Math.max(50, Math.round(revMax / 200)),
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: 'Repeat customer rate (%)',
        description:
          'Orders this week from customers who ordered at least once before, divided by total orders this week (0-100).',
        marketRangeMax: 100,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
    ];
  },
};

const MARKETPLACE: TemplateSpec = {
  id: 'marketplace',
  category: 'startup',
  name: 'Marketplace',
  intent: 'GMV, active buyers and sellers, take rate.',
  needsCurrency: true,
  revenueScale: { label: 'Weekly GMV target', default: 250000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const gmvMax = clampPositive(params.revenueRangeMax, 250000);
    return [
      {
        name: `Weekly GMV (${cur})`,
        description: `Total transaction value of orders completed this week, in ${cur} (from your transactions table).`,
        marketRangeMax: gmvMax,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Weekly active buyers',
        description: 'Distinct buyer accounts that completed at least one purchase this week (count).',
        marketRangeMax: Math.max(500, Math.round(gmvMax / 50)),
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Weekly active sellers',
        description: 'Distinct seller accounts that fulfilled at least one order this week (count).',
        marketRangeMax: Math.max(100, Math.round(gmvMax / 250)),
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Take rate (%)',
        description: 'Marketplace revenue this week divided by GMV this week, expressed as a percentage (0-100).',
        marketRangeMax: 30,
        timePreferenceHalfLifeYears: 3,
        initialValue: 0,
      },
    ];
  },
};

const CONSUMER_APP: TemplateSpec = {
  id: 'consumer-app',
  category: 'startup',
  name: 'Consumer app',
  intent: 'Weekly active users, retention, installs, store rating.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'Weekly active users',
      description:
        'Distinct users who opened the app at least once in the past 7 days (count, from product analytics).',
      marketRangeMax: 100000,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Day-7 retention (%)',
      description: 'Of users who installed exactly 7 days ago, the percentage who opened the app today (0-100).',
      marketRangeMax: 100,
      timePreferenceHalfLifeYears: 2,
      initialValue: 0,
    },
    {
      name: 'Weekly installs',
      description: 'New installs across all stores this week (count, from store consoles).',
      marketRangeMax: 50000,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Store rating (1-5)',
      description: 'Current average rating shown on the primary app store page (1-5).',
      marketRangeMax: 5,
      timePreferenceHalfLifeYears: 3,
      initialValue: 4,
    },
  ],
};

const AGENCY: TemplateSpec = {
  id: 'agency',
  category: 'startup',
  name: 'Agency / consulting',
  intent: 'Billable hours, retainer MRR, active clients, win rate.',
  needsCurrency: true,
  revenueScale: { label: 'Retainer MRR target', default: 50000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const mrrMax = clampPositive(params.revenueRangeMax, 50000);
    return [
      {
        name: 'Weekly billable hours',
        description: 'Hours billed to clients this week, summed across the team (count, from time tracking).',
        marketRangeMax: 500,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: `Retainer MRR (${cur})`,
        description: `Sum of active monthly retainer contracts at week end, in ${cur}.`,
        marketRangeMax: mrrMax,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: 'Active clients',
        description: 'Clients with an active engagement (retainer or project) at week end (count).',
        marketRangeMax: 100,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: 'Proposal win rate (%)',
        description: 'Proposals accepted in the past 90 days divided by proposals sent in the past 90 days (0-100).',
        marketRangeMax: 100,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
    ];
  },
};

const COMMUNITY: TemplateSpec = {
  id: 'community',
  category: 'startup',
  name: 'Community / collective',
  intent:
    'Active members, weekly engagement, retention, recurring revenue. For professional communities, advisory collectives, or curated networks.',
  needsCurrency: true,
  revenueScale: { label: 'Recurring revenue target', default: 30000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const revMax = clampPositive(params.revenueRangeMax, 30000);
    return [
      {
        name: 'Active members',
        description:
          'Distinct members in good standing at week end (count, from your member directory or billing system).',
        marketRangeMax: 5000,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: 'Weekly engagement events',
        description:
          'Distinct events held this week with at least 3 member participants (count, e.g. workshops, meetups, hosted threads, live sessions).',
        marketRangeMax: 30,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Annual member retention (%)',
        description:
          'Members renewed in the trailing 12 months divided by members eligible to renew in that window, expressed as a percentage (0-100).',
        marketRangeMax: 100,
        timePreferenceHalfLifeYears: 3,
        initialValue: 0,
      },
      {
        name: `Recurring revenue (${cur})`,
        description: `Sum of active recurring contracts at week end across membership, advisory retainers, and sponsorships, in ${cur}.`,
        marketRangeMax: revMax,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
    ];
  },
};

const CREATOR: TemplateSpec = {
  id: 'creator',
  category: 'startup',
  name: 'Content creator',
  intent: 'Subscribers, weekly views, monetization, publishing cadence.',
  needsCurrency: true,
  revenueScale: { label: 'Weekly revenue target', default: 5000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const revMax = clampPositive(params.revenueRangeMax, 5000);
    return [
      {
        name: 'Total subscribers',
        description:
          'Total subscribers / followers on the primary channel at week end (count, from the channel dashboard).',
        marketRangeMax: 1000000,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: 'Weekly views',
        description: 'Total views on content published this week, measured 7 days after publication (count).',
        marketRangeMax: 500000,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: `Weekly revenue (${cur})`,
        description: `Sum of ad, sponsorship, and membership revenue paid out for this week, in ${cur}.`,
        marketRangeMax: revMax,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Pieces published this week',
        description: 'Distinct pieces of content published on the primary channel this week (count).',
        marketRangeMax: 14,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
    ];
  },
};

const OSS: TemplateSpec = {
  id: 'oss',
  category: 'startup',
  name: 'Open source project',
  intent: 'Stars, downloads, contributors, open issues.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'GitHub stars',
      description: 'Total stars on the primary repository at week end (count, from GitHub).',
      marketRangeMax: 100000,
      timePreferenceHalfLifeYears: 3,
      initialValue: 0,
    },
    {
      name: 'Weekly downloads',
      description: 'Package downloads this week from the primary registry (count, e.g. npm/pypi/crates).',
      marketRangeMax: 1000000,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Weekly active contributors',
      description: 'Distinct authors with at least one commit merged into the primary branch this week (count).',
      marketRangeMax: 50,
      timePreferenceHalfLifeYears: 2,
      initialValue: 0,
    },
    {
      name: 'Open issues',
      description: 'Issues with status "open" on the primary repository at week end (count).',
      marketRangeMax: 1000,
      timePreferenceHalfLifeYears: 2,
      initialValue: 0,
    },
  ],
};

const WELLBEING: TemplateSpec = {
  id: 'wellbeing',
  category: 'personal',
  name: 'Overall wellbeing',
  intent: 'Self-reported happiness, health, and career satisfaction.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'Happiness (self-reported)',
      description:
        'Your gut read on how happy you feel right now, from 0 (miserable) to 10 (best you can imagine). Subjective by design; record honestly.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
    {
      name: 'Health (self-reported)',
      description:
        'Your gut read on overall physical and mental health, from 0 (severely unwell) to 10 (peak). Subjective; not a clinical measure.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 5,
      initialValue: 5,
    },
    {
      name: 'Career satisfaction (self-reported)',
      description:
        'Your gut read on how satisfied you are with your career trajectory right now, from 0 (stuck) to 10 (thriving). Subjective.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 3,
      initialValue: 5,
    },
  ],
};

const HEALTH_FITNESS: TemplateSpec = {
  id: 'health-fitness',
  category: 'personal',
  name: 'Health & fitness',
  intent: 'Weight, exercise minutes, sleep, energy.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'Body weight (kg)',
      description: 'Your body weight measured on the same scale, first thing in the morning, in kilograms.',
      marketRangeMax: 200,
      timePreferenceHalfLifeYears: 5,
      initialValue: 70,
    },
    {
      name: 'Weekly exercise minutes',
      description:
        'Minutes of intentional exercise logged this week across all activities (count, from your tracker or training log).',
      marketRangeMax: 1000,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Average nightly sleep (hours)',
      description: 'Average hours of sleep per night this week (mean of nightly totals from your sleep tracker).',
      marketRangeMax: 12,
      timePreferenceHalfLifeYears: 2,
      initialValue: 7,
    },
    {
      name: 'Energy (self-reported)',
      description:
        'Your gut read on average energy this week, from 0 (exhausted all week) to 10 (energized all week). Subjective.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
  ],
};

const CAREER: TemplateSpec = {
  id: 'career',
  category: 'personal',
  name: 'Career growth',
  intent: 'Income, deep work hours, satisfaction.',
  needsCurrency: true,
  revenueScale: { label: 'Annual income target', default: 150000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const incomeMax = clampPositive(params.revenueRangeMax, 150000);
    return [
      {
        name: `Annual income (${cur})`,
        description: `Your gross annual income from primary employment or business in the trailing 12 months, in ${cur} (from pay stubs / invoices).`,
        marketRangeMax: incomeMax,
        timePreferenceHalfLifeYears: 3,
        initialValue: 0,
      },
      {
        name: 'Weekly deep work hours',
        description:
          'Hours spent this week on focused work on hard problems, with no shallow tasks or meetings (count, from your time log).',
        marketRangeMax: 60,
        timePreferenceHalfLifeYears: 1,
        initialValue: 0,
      },
      {
        name: 'Career satisfaction (self-reported)',
        description:
          'Your gut read on how satisfied you are with your career trajectory right now, from 0 (stuck) to 10 (thriving). Subjective.',
        marketRangeMax: 10,
        timePreferenceHalfLifeYears: 3,
        initialValue: 5,
      },
    ];
  },
};

const LEARNING: TemplateSpec = {
  id: 'learning',
  category: 'personal',
  name: 'Learning',
  intent: 'Study hours, books, courses, mastery.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'Weekly study hours',
      description:
        'Hours spent this week on focused study (reading, courses, exercises). Count only time you would defend as deliberate practice.',
      marketRangeMax: 40,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Books finished this year',
      description: 'Distinct books finished cover-to-cover since January 1 of this year (count).',
      marketRangeMax: 100,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Courses completed this year',
      description:
        'Distinct online or formal courses completed since January 1 of this year (count, completion certificate or final exam passed).',
      marketRangeMax: 30,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Mastery (self-reported)',
      description:
        'Your gut read on how well you understand the subject right now, from 0 (total beginner) to 10 (could teach a graduate course). Subjective.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 3,
      initialValue: 3,
    },
  ],
};

const RELATIONSHIPS: TemplateSpec = {
  id: 'relationships',
  category: 'personal',
  name: 'Relationships',
  intent: 'Time with people, depth of contact, connection.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'Close people contacted this week',
      description:
        'Distinct close friends or family members you had a real conversation with this week (count). Texting "hi" does not count; a real exchange does.',
      marketRangeMax: 30,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Weekly in-person hours with loved ones',
      description:
        'Hours spent in person with partner, family, or close friends this week (count). Shared activities count; passive co-presence (e.g. silent commute) does not.',
      marketRangeMax: 60,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Connection (self-reported)',
      description:
        'Your gut read on how connected and supported you feel right now, from 0 (alone) to 10 (deeply held). Subjective.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 2,
      initialValue: 5,
    },
  ],
};

const CREATIVE_PROJECT: TemplateSpec = {
  id: 'creative-project',
  category: 'personal',
  name: 'Creative project',
  intent: 'Creation hours, finished pieces, audience, momentum.',
  needsCurrency: false,
  metrics: () => [
    {
      name: 'Weekly creation hours',
      description:
        'Hours spent making the work this week (count, from your time log). Planning and consumption do not count; making does.',
      marketRangeMax: 40,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Pieces shipped this year',
      description:
        'Finished pieces published since January 1 of this year (count). "Shipped" means a real audience can see it.',
      marketRangeMax: 100,
      timePreferenceHalfLifeYears: 2,
      initialValue: 0,
    },
    {
      name: 'Audience size',
      description:
        'Total followers / subscribers / listeners on the primary channel at week end (count, from the channel dashboard).',
      marketRangeMax: 100000,
      timePreferenceHalfLifeYears: 3,
      initialValue: 0,
    },
    {
      name: 'Creative momentum (self-reported)',
      description:
        'Your gut read on how alive and on-track the project feels right now, from 0 (dead) to 10 (best of my life). Subjective.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
  ],
};

const FINANCIAL_INDEPENDENCE: TemplateSpec = {
  id: 'financial-independence',
  category: 'personal',
  name: 'Financial independence',
  intent: 'Net worth, savings rate, expenses, runway.',
  needsCurrency: true,
  revenueScale: { label: 'Net worth target', default: 1000000 },
  metrics: params => {
    const cur = normalizeCurrency(params.currency);
    const nwMax = clampPositive(params.revenueRangeMax, 1000000);
    return [
      {
        name: `Net worth (${cur})`,
        description: `Total assets minus total liabilities at week end, in ${cur} (from your aggregated account statements).`,
        marketRangeMax: nwMax,
        timePreferenceHalfLifeYears: 5,
        initialValue: 0,
      },
      {
        name: 'Monthly savings rate (%)',
        description:
          'This calendar month: (income minus expenses) divided by income, expressed as a percentage (0-100).',
        marketRangeMax: 100,
        timePreferenceHalfLifeYears: 2,
        initialValue: 0,
      },
      {
        name: `Annual expenses (${cur})`,
        description: `Total spending in the trailing 12 months, in ${cur} (from your expense tracker).`,
        marketRangeMax: Math.max(50000, Math.round(nwMax / 20)),
        timePreferenceHalfLifeYears: 3,
        initialValue: 0,
      },
      {
        name: 'Years to financial independence',
        description:
          'Estimated years until investment income covers annual expenses at the current savings rate (count).',
        marketRangeMax: 50,
        timePreferenceHalfLifeYears: 5,
        initialValue: 30,
      },
    ];
  },
};

const BLANK: TemplateSpec = {
  id: 'blank',
  category: 'blank',
  name: 'Blank',
  intent: 'Start with no metrics. Define your own from the Metrics page.',
  needsCurrency: false,
  metrics: () => [],
};

const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  saas: SAAS,
  ecommerce: ECOMMERCE,
  marketplace: MARKETPLACE,
  'consumer-app': CONSUMER_APP,
  agency: AGENCY,
  community: COMMUNITY,
  creator: CREATOR,
  oss: OSS,
  wellbeing: WELLBEING,
  'health-fitness': HEALTH_FITNESS,
  career: CAREER,
  learning: LEARNING,
  relationships: RELATIONSHIPS,
  'creative-project': CREATIVE_PROJECT,
  'financial-independence': FINANCIAL_INDEPENDENCE,
  // Legacy aliases preserved so older clients keep working.
  startup: SAAS,
  personal: WELLBEING,
  blank: BLANK,
};

export function getTemplate(id: string | undefined): TemplateSpec {
  if (!id) return BLANK;
  const tpl = TEMPLATES[id as TemplateId];
  if (!tpl) throw new Error(`Unknown template: ${id}`);
  return tpl;
}

export interface TemplateSummary {
  id: TemplateId;
  category: TemplateCategory;
  name: string;
  intent: string;
  needsCurrency: boolean;
  revenueScale?: { label: string; default: number };
  metricCount: number;
}

export function listTemplates(): TemplateSummary[] {
  // Skip legacy aliases so the list shows each template exactly once.
  const seen = new Set<TemplateSpec>();
  const out: TemplateSummary[] = [];
  for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
    if (id === 'startup' || id === 'personal') continue;
    const tpl = TEMPLATES[id];
    if (seen.has(tpl)) continue;
    seen.add(tpl);
    out.push({
      id: tpl.id,
      category: tpl.category,
      name: tpl.name,
      intent: tpl.intent,
      needsCurrency: tpl.needsCurrency,
      revenueScale: tpl.revenueScale,
      metricCount: tpl.metrics({}).length,
    });
  }
  return out;
}

/**
 * Title + description for the starter proposal that ships with every newly
 * created workspace. The tour points at this proposal so a first-time user
 * (or a demoing investor) sees the mechanism (proposal -> priced market ->
 * approve) on a populated workspace, not an empty one.
 */
export function getStarterProposal(template: TemplateSpec): { title: string; description: string } {
  switch (template.category) {
    case 'startup':
      return {
        title: 'Actively use Telarchy to run this company',
        description:
          'Starter proposal. Approve if you intend to run real decisions through this workspace for at least one cycle. The conditional markets below price whether doing so will move the KPIs you just set up; participants forecast the impact and you decide.',
      };
    case 'personal':
      return {
        title: 'Actively use Telarchy for my personal goals',
        description:
          'Starter proposal. Approve if you intend to use this workspace to make decisions against your personal goals for at least one cycle. The conditional markets below price the predicted impact on each metric you just set up.',
      };
    default:
      return {
        title: 'Try Telarchy for one cycle',
        description:
          'Starter proposal. Approve if you intend to use this workspace to make at least one real decision. The conditional markets below price predicted impact against the metrics in this workspace.',
      };
  }
}

export function listSupportedCurrencies(): string[] {
  return [...SUPPORTED_CURRENCIES];
}
