/**
 * Workspace templates applied at creation time. Each template encodes the
 * metric-design guide principles (outcomes not activities, genie test, subjective
 * self-reports over speculative proxies, sibling TP nodes for different timescales).
 *
 * Templates produce a flat list of leaf metrics, each with its own time preference
 * and a market range matched to the metric's realistic bounds. Users edit freely
 * after creation.
 */

export type TemplateId = 'startup' | 'personal' | 'blank';

export interface TemplateMetricSpec {
  name: string;
  description: string;
  marketRangeMax: number;
  timePreferenceHalfLifeYears: number;
  initialValue: number;
}

export interface TemplateParams {
  /** Upper bound for the Weekly revenue market (startup template). */
  revenueRangeMax?: number;
}

export interface TemplateSpec {
  id: TemplateId;
  name: string;
  intent: string;
  metrics: (params: TemplateParams) => TemplateMetricSpec[];
}

const STARTUP: TemplateSpec = {
  id: 'startup',
  name: 'Startup',
  intent: 'Revenue, customer satisfaction, and product quality.',
  metrics: (params) => [
    {
      name: 'Weekly revenue',
      description: 'Total revenue this week, in your currency.',
      marketRangeMax: params.revenueRangeMax && params.revenueRangeMax > 0 ? params.revenueRangeMax : 100000,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Customer satisfaction',
      description: 'Your read on how happy customers are, 0-10.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
    {
      name: 'Product quality',
      description: 'Your assessment of the product overall, 0-10.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 3,
      initialValue: 5,
    },
  ],
};

const PERSONAL: TemplateSpec = {
  id: 'personal',
  name: 'Personal',
  intent: 'Happiness, health, and career satisfaction.',
  metrics: () => [
    {
      name: 'Happiness',
      description: 'How happy you are right now, 0-10.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
    {
      name: 'Health',
      description: 'Overall physical and mental health, 0-10.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 5,
      initialValue: 5,
    },
    {
      name: 'Career satisfaction',
      description: 'How satisfied you are with your career, 0-10.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 3,
      initialValue: 5,
    },
  ],
};

const BLANK: TemplateSpec = {
  id: 'blank',
  name: 'Blank',
  intent: 'Start with no metrics. Create your own from the Metrics page.',
  metrics: () => [],
};

const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  startup: STARTUP,
  personal: PERSONAL,
  blank: BLANK,
};

export function getTemplate(id: string | undefined): TemplateSpec {
  if (!id) return BLANK;
  const tpl = TEMPLATES[id as TemplateId];
  if (!tpl) throw new Error(`Unknown template: ${id}`);
  return tpl;
}

export function listTemplates(): Array<Pick<TemplateSpec, 'id' | 'name' | 'intent'> & { metricCount: number }> {
  return (Object.values(TEMPLATES) as TemplateSpec[]).map(t => ({
    id: t.id,
    name: t.name,
    intent: t.intent,
    metricCount: t.metrics({}).length,
  }));
}
