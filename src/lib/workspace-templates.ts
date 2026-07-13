// Shared workspace-template metadata for the create/onboarding surfaces
// (CreateWorkspacePage and the cinematic WelcomePage). Kept in one place so
// the two surfaces cannot drift. The authoritative seeded metrics live in the
// backend (functions/src/lib/templates.ts); this is only the picker's copy.

export type TemplateCategory = 'startup' | 'personal';

export type TemplateId =
  | 'saas' | 'ecommerce' | 'marketplace' | 'consumer-app' | 'agency' | 'creator' | 'oss'
  | 'wellbeing' | 'health-fitness' | 'career' | 'learning' | 'relationships' | 'creative-project' | 'financial-independence'
  | 'blank';

export interface TemplateInfo {
  id: TemplateId;
  category: TemplateCategory | 'blank';
  label: string;
  blurb: string;
  /** A single glyph shown on the canvas card. Monochrome, no color coding. */
  glyph: string;
  needsCurrency: boolean;
  revenueScale?: { label: string; default: number };
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'saas', category: 'startup', label: 'SaaS startup', blurb: 'MRR, paying customers, churn, trial conversion.', glyph: '◆', needsCurrency: true, revenueScale: { label: 'MRR target', default: 100000 } },
  { id: 'ecommerce', category: 'startup', label: 'E-commerce / DTC', blurb: 'Weekly revenue, orders, AOV, repeat customers.', glyph: '▧', needsCurrency: true, revenueScale: { label: 'Weekly revenue target', default: 100000 } },
  { id: 'marketplace', category: 'startup', label: 'Marketplace', blurb: 'GMV, active buyers and sellers, take rate.', glyph: '⬡', needsCurrency: true, revenueScale: { label: 'Weekly GMV target', default: 250000 } },
  { id: 'consumer-app', category: 'startup', label: 'Consumer app', blurb: 'WAU, day-7 retention, installs, store rating.', glyph: '▲', needsCurrency: false },
  { id: 'agency', category: 'startup', label: 'Agency / consulting', blurb: 'Billable hours, retainer MRR, win rate.', glyph: '❖', needsCurrency: true, revenueScale: { label: 'Retainer MRR target', default: 50000 } },
  { id: 'creator', category: 'startup', label: 'Content creator', blurb: 'Subscribers, views, monetization, cadence.', glyph: '✦', needsCurrency: true, revenueScale: { label: 'Weekly revenue target', default: 5000 } },
  { id: 'oss', category: 'startup', label: 'Open source project', blurb: 'Stars, downloads, contributors, open issues.', glyph: '⟢', needsCurrency: false },
  { id: 'wellbeing', category: 'personal', label: 'Overall wellbeing', blurb: 'Self-reported happiness, health, career.', glyph: '☾', needsCurrency: false },
  { id: 'health-fitness', category: 'personal', label: 'Health & fitness', blurb: 'Weight, exercise, sleep, energy.', glyph: '♁', needsCurrency: false },
  { id: 'career', category: 'personal', label: 'Career growth', blurb: 'Income, deep work hours, satisfaction.', glyph: '↗', needsCurrency: true, revenueScale: { label: 'Annual income target', default: 150000 } },
  { id: 'learning', category: 'personal', label: 'Learning', blurb: 'Study hours, books, courses, mastery.', glyph: '✧', needsCurrency: false },
  { id: 'relationships', category: 'personal', label: 'Relationships', blurb: 'Time with people, depth of contact.', glyph: '❥', needsCurrency: false },
  { id: 'creative-project', category: 'personal', label: 'Creative project', blurb: 'Creation hours, finished pieces, audience.', glyph: '✎', needsCurrency: false },
  { id: 'financial-independence', category: 'personal', label: 'Financial independence', blurb: 'Net worth, savings rate, expenses, runway.', glyph: '◈', needsCurrency: true, revenueScale: { label: 'Net worth target', default: 1000000 } },
];

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'INR', 'BRL', 'MXN', 'SGD', 'NZD', 'ZAR'];
