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
  intent: 'Outcomes a founder is certain they want to maximise. Edit freely; this is a starter, not a prescription.',
  metrics: (params) => [
    {
      name: 'Weekly revenue',
      description:
        'Direct financial outcome. Set the range max to a realistic ~2-year ceiling so the market has room to move. Activities like signups, features shipped, or hours worked are not metrics here; propose them as tasks if you suspect they drive revenue.',
      marketRangeMax: params.revenueRangeMax && params.revenueRangeMax > 0 ? params.revenueRangeMax : 100000,
      timePreferenceHalfLifeYears: 1,
      initialValue: 0,
    },
    {
      name: 'Customer satisfaction',
      description:
        'Your honest aggregate read on customer happiness, scored 0-10 weekly. The guides recommend subjective self-assessment over upstream proxies (NPS, CSAT) unless you are certain the proxy captures what you mean.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
    {
      name: 'Product quality',
      description:
        'Your own assessment of the product as an internal compounding asset, scored 0-10. Not directly observable to customers week-to-week, but drives retention, velocity, and hiring long-term. Longer half-life reflects that.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 3,
      initialValue: 5,
    },
  ],
};

const PERSONAL: TemplateSpec = {
  id: 'personal',
  name: 'Personal',
  intent: 'A starter set of self-reported outcomes. The guides explicitly prefer subjective scores here over upstream proxies like "hours slept" or "income".',
  metrics: () => [
    {
      name: 'Happiness',
      description:
        'Self-reported weekly, 0-10. The guides explicitly recommend self-reported happiness over upstream proxies (dopamine, income, relationships). Anything you think drives happiness but are not certain about belongs in a task.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 1,
      initialValue: 5,
    },
    {
      name: 'Health',
      description:
        'Self-reported, 0-10. Includes however you weight sleep, energy, fitness, mental state. Long half-life: the things that matter here compound over years. Do not track "hours slept" or "workouts per week" as metrics; those are activities. Propose them as tasks if you suspect they help.',
      marketRangeMax: 10,
      timePreferenceHalfLifeYears: 5,
      initialValue: 5,
    },
    {
      name: 'Career satisfaction',
      description:
        'Self-reported, 0-10. Outcome, not activity (avoid "hours worked" or "projects shipped" as metrics).',
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
