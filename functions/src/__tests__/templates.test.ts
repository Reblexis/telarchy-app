import {
  getStarterProposal,
  getTemplate,
  listSupportedCurrencies,
  listTemplates,
  type TemplateId,
} from '../lib/templates';

describe('templates', () => {
  describe('getTemplate', () => {
    test('resolves every catalog id', () => {
      const ids: TemplateId[] = [
        'saas',
        'ecommerce',
        'marketplace',
        'consumer-app',
        'agency',
        'community',
        'creator',
        'oss',
        'wellbeing',
        'health-fitness',
        'career',
        'learning',
        'relationships',
        'creative-project',
        'financial-independence',
        'blank',
      ];
      for (const id of ids) {
        const tpl = getTemplate(id);
        expect(tpl.id).toBe(id);
      }
    });

    test('preserves legacy startup/personal aliases', () => {
      // Older clients still send these IDs at workspace creation. The aliases
      // must keep producing a usable metric set or we silently break account
      // creation for stale frontends.
      expect(getTemplate('startup').category).toBe('startup');
      expect(getTemplate('personal').category).toBe('personal');
      expect(getTemplate('startup').metrics({}).length).toBeGreaterThan(0);
      expect(getTemplate('personal').metrics({}).length).toBeGreaterThan(0);
    });

    test('blank by default and on undefined', () => {
      expect(getTemplate(undefined).id).toBe('blank');
      expect(getTemplate('blank').metrics({})).toEqual([]);
    });

    test('throws on unknown id', () => {
      expect(() => getTemplate('not-a-real-template')).toThrow(/Unknown template/);
    });
  });

  describe('currency baking', () => {
    test('saas MRR metric carries the chosen currency in name and description', () => {
      const metrics = getTemplate('saas').metrics({ currency: 'EUR', revenueRangeMax: 50000 });
      const mrr = metrics[0];
      expect(mrr.name).toBe('MRR (EUR)');
      expect(mrr.description).toContain('in EUR');
      expect(mrr.marketRangeMax).toBe(50000);
    });

    test('falls back to USD for unsupported currency', () => {
      const metrics = getTemplate('ecommerce').metrics({ currency: 'XYZ' });
      expect(metrics[0].name).toBe('Weekly revenue (USD)');
    });

    test('falls back to USD when no currency given', () => {
      const metrics = getTemplate('marketplace').metrics({});
      expect(metrics[0].name).toBe('Weekly GMV (USD)');
    });

    test('defaults revenueRangeMax when invalid', () => {
      const m1 = getTemplate('saas').metrics({ revenueRangeMax: 0 });
      const m2 = getTemplate('saas').metrics({ revenueRangeMax: -100 });
      expect(m1[0].marketRangeMax).toBeGreaterThan(0);
      expect(m2[0].marketRangeMax).toBeGreaterThan(0);
    });
  });

  describe('metric content rules', () => {
    test('non-personal templates avoid "self-reported" metrics', () => {
      // Outside the personal category, every metric must be objectively
      // resolvable. If a future edit slips in a feeling-based metric on a
      // company template, this test fails so we notice.
      const summary = listTemplates();
      for (const s of summary) {
        if (s.category === 'startup') {
          const metrics = getTemplate(s.id).metrics({});
          for (const m of metrics) {
            expect(m.name.toLowerCase()).not.toMatch(/self-reported/);
            expect(m.description.toLowerCase()).not.toContain('subjective');
          }
        }
      }
    });

    test('personal templates label subjective metrics explicitly', () => {
      // Where a personal metric is genuinely a feeling, the name must say
      // "(self-reported)" so the user knows what kind of number they are
      // logging.
      const wellbeing = getTemplate('wellbeing').metrics({});
      for (const m of wellbeing) {
        expect(m.name).toContain('(self-reported)');
      }
      const energy = getTemplate('health-fitness')
        .metrics({})
        .find(m => m.name.toLowerCase().startsWith('energy'));
      expect(energy?.name).toContain('(self-reported)');
    });

    test('every metric description has substantive content', () => {
      const summary = listTemplates();
      for (const s of summary) {
        const metrics = getTemplate(s.id).metrics({});
        for (const m of metrics) {
          expect(m.description.length).toBeGreaterThan(20);
          expect(m.name.length).toBeGreaterThan(0);
          expect(m.marketRangeMax).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('listTemplates', () => {
    test('groups templates by category and excludes legacy aliases', () => {
      const list = listTemplates();
      const ids = list.map(t => t.id);
      expect(ids).not.toContain('startup');
      expect(ids).not.toContain('personal');
      expect(ids).toContain('saas');
      expect(ids).toContain('wellbeing');

      const startupCount = list.filter(t => t.category === 'startup').length;
      const personalCount = list.filter(t => t.category === 'personal').length;
      expect(startupCount).toBeGreaterThanOrEqual(5);
      expect(personalCount).toBeGreaterThanOrEqual(5);
    });

    test('flags currency requirement and revenue scale per template', () => {
      const list = listTemplates();
      const saas = list.find(t => t.id === 'saas')!;
      expect(saas.needsCurrency).toBe(true);
      expect(saas.revenueScale?.label).toBe('MRR target');

      const oss = list.find(t => t.id === 'oss')!;
      expect(oss.needsCurrency).toBe(false);
      expect(oss.revenueScale).toBeUndefined();
    });
  });

  test('supported currencies includes major ISO codes', () => {
    const codes = listSupportedCurrencies();
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
  });

  describe('getStarterProposal', () => {
    test('returns startup-flavored copy for startup-category templates', () => {
      const starter = getStarterProposal(getTemplate('saas'));
      expect(starter.title.toLowerCase()).toContain('company');
      expect(starter.description.length).toBeGreaterThan(0);
    });

    test('returns personal-flavored copy for personal-category templates', () => {
      const starter = getStarterProposal(getTemplate('wellbeing'));
      expect(starter.title.toLowerCase()).toContain('personal');
    });

    test('returns generic copy for the blank template', () => {
      const starter = getStarterProposal(getTemplate('blank'));
      expect(starter.title.toLowerCase()).toContain('try telarchy');
    });
  });
});
