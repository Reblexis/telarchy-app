import { isPageLoad, sessionize, type VisitRow } from '../lib/visit-log';

/**
 * A journey is one visitor's ordered path through the site in a single
 * sitting (docs/ui-conventions.md, "Journeys"). It exists to answer the one
 * question the counts cannot: where did they stop.
 *
 * Every rule below decides what the owner concludes from the page, so each
 * has a test named after the rule rather than after the function.
 */

const T = (iso: string) => new Date(iso);

const hit = (over: Omit<Partial<VisitRow>, 'ts'> & { ts: string; path: string }): VisitRow => ({
  ip: '1.1.1.1',
  userAgent: 'Mozilla/5.0 Firefox',
  referer: null,
  country: 'CZ',
  ...over,
  ts: T(over.ts),
});

describe('a journey is one address AND one user agent', () => {
  it('keeps two browsers behind one address apart', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/', userAgent: 'Firefox' }),
      hit({
        ts: '2026-09-01T10:00:30Z',
        path: '/leaderboard',
        userAgent: 'Safari',
      }),
      hit({ ts: '2026-09-01T10:01:00Z', path: '/join', userAgent: 'Firefox' }),
    ]);
    expect(js).toHaveLength(2);
    const firefox = js.find(j => j.userAgent === 'Firefox')!;
    expect(firefox.steps.map(s => s.path)).toEqual(['/', '/join']);
    expect(js.find(j => j.userAgent === 'Safari')!.steps.map(s => s.path)).toEqual(['/leaderboard']);
  });

  it('keeps one user agent on two addresses apart', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/', ip: '1.1.1.1' }),
      hit({ ts: '2026-09-01T10:00:30Z', path: '/join', ip: '2.2.2.2' }),
    ]);
    expect(js).toHaveLength(2);
  });
});

describe('thirty idle minutes ends the sitting', () => {
  it('keeps hits inside the gap in one journey', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:29:00Z', path: '/leaderboard' }),
      hit({ ts: '2026-09-01T10:57:00Z', path: '/join' }),
    ]);
    expect(js).toHaveLength(1);
    expect(js[0].steps).toHaveLength(3);
  });

  it('starts a new journey after a longer gap, so a return visit is two visits', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:31:00Z', path: '/join' }),
    ]);
    expect(js).toHaveLength(2);
  });

  it('measures the gap from the previous hit, not from the journey start', () => {
    // Six hits five minutes apart are one sitting of half an hour, not two.
    const js = sessionize(
      [0, 5, 10, 15, 20, 25, 30, 35].map(m =>
        hit({
          ts: `2026-09-01T10:${String(m).padStart(2, '0')}:00Z`,
          path: `/p${m}`,
        }),
      ),
    );
    expect(js).toHaveLength(1);
    expect(js[0].steps).toHaveLength(8);
  });
});

describe('where they came from is the first hit referer', () => {
  it('reports the entry referer, never a later on-site one', () => {
    const [j] = sessionize([
      hit({
        ts: '2026-09-01T10:00:00Z',
        path: '/',
        referer: 'https://manifold.markets/x',
      }),
      hit({
        ts: '2026-09-01T10:00:30Z',
        path: '/join',
        referer: 'https://telarchy.com/',
      }),
    ]);
    expect(j.referer).toBe('https://manifold.markets/x');
  });

  it('reports no referer as direct', () => {
    const [j] = sessionize([hit({ ts: '2026-09-01T10:00:00Z', path: '/', referer: null })]);
    expect(j.referer).toBeNull();
  });
});

describe('the journey says where they entered and where they stopped', () => {
  it('names the first and last path and the steps between them, in time order', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:20Z', path: '/leaderboard' }),
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:01:20Z', path: '/join' }),
    ]);
    expect(j.entryPath).toBe('/');
    expect(j.exitPath).toBe('/join');
    expect(j.steps.map(s => s.path)).toEqual(['/', '/leaderboard', '/join']);
  });

  it('carries the seconds spent on each step, and none for the last', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:00:20Z', path: '/leaderboard' }),
      hit({ ts: '2026-09-01T10:01:20Z', path: '/join' }),
    ]);
    expect(j.steps.map(s => s.secondsOnPage)).toEqual([20, 60, null]);
  });

  it('measures duration from first hit to last', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:02:30Z', path: '/join' }),
    ]);
    expect(j.durationSeconds).toBe(150);
  });
});

describe('a single-hit journey is a bounce and says so', () => {
  it('labels it, with zero duration', () => {
    const [j] = sessionize([hit({ ts: '2026-09-01T10:00:00Z', path: '/' })]);
    expect(j.bounced).toBe(true);
    expect(j.durationSeconds).toBe(0);
    expect(j.entryPath).toBe('/');
    expect(j.exitPath).toBe('/');
  });

  it('does not label a two-page journey a bounce', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:00:05Z', path: '/join' }),
    ]);
    expect(j.bounced).toBe(false);
  });
});

describe('journeys are ordered newest first', () => {
  it('puts the most recent sitting at the top', () => {
    const js = sessionize([
      hit({ ts: '2026-08-30T10:00:00Z', path: '/old', ip: '1.1.1.1' }),
      hit({ ts: '2026-09-01T10:00:00Z', path: '/new', ip: '2.2.2.2' }),
      hit({ ts: '2026-08-31T10:00:00Z', path: '/mid', ip: '3.3.3.3' }),
    ]);
    expect(js.map(j => j.entryPath)).toEqual(['/new', '/mid', '/old']);
  });
});

describe('rows that cannot be attributed to a visitor are dropped', () => {
  it('drops a null address rather than merging strangers into one journey', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/a', ip: null }),
      hit({ ts: '2026-09-01T10:00:10Z', path: '/b', ip: null }),
      hit({ ts: '2026-09-01T10:00:20Z', path: '/c', ip: '9.9.9.9' }),
    ]);
    expect(js).toHaveLength(1);
    expect(js[0].steps.map(s => s.path)).toEqual(['/c']);
  });

  it('treats a missing user agent as its own visitor rather than throwing', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/a', userAgent: null }),
      hit({ ts: '2026-09-01T10:00:10Z', path: '/b', userAgent: null }),
    ]);
    expect(js).toHaveLength(1);
    expect(js[0].steps).toHaveLength(2);
  });
});

describe('degenerate input', () => {
  it('returns nothing for an empty log', () => {
    expect(sessionize([])).toEqual([]);
  });

  it('keeps both hits when two share a timestamp', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/a' }),
      hit({ ts: '2026-09-01T10:00:00Z', path: '/b' }),
    ]);
    expect(j.steps).toHaveLength(2);
    expect(j.durationSeconds).toBe(0);
    expect(j.bounced).toBe(false);
  });

  it('takes the first country it knows, ignoring nulls', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/a', country: null }),
      hit({ ts: '2026-09-01T10:00:10Z', path: '/b', country: 'DE' }),
    ]);
    expect(j.country).toBe('DE');
  });
});

/**
 * A step is a PAGE. The visitor log catches every request that falls through
 * to the app, so a missing /favicon.ico, a JS chunk and a scanner probing
 * /lala.php all sit in it. Reading those as steps made /favicon.ico the
 * second most common place a visitor "stopped" against real production
 * traffic on 2026-09-01, which is the one question the block exists to
 * answer.
 */
describe('a journey step is a page, not an asset', () => {
  it('drops the asset requests that fall through to the app', () => {
    for (const path of [
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/assets/ParticipantProfilePage-BLDu20j6.js',
      '/media/system/js/core.js',
      '/wp-includes/css/buttons.css',
      '/wp-content/plugins/hellopress/wp_filemanager.php',
      '/lala.php',
      '/sitemap.xml',
      '/fonts/inter.woff2',
    ]) {
      expect(isPageLoad(path)).toBe(false);
    }
  });

  it('keeps a page nobody has thought of yet, which is why the rule is the extension', () => {
    // The durability rule: pages added next year have no extension, so they
    // are journeys without anyone maintaining a list of known routes.
    for (const path of ['/', '/join', '/leaderboard', '/some-page-invented-in-2027', '/floors/acme/market/7']) {
      expect(isPageLoad(path)).toBe(true);
    }
  });

  it('does not treat the operator cockpit as a page, including rows logged before it stopped being logged', () => {
    expect(isPageLoad('/admin')).toBe(false);
    expect(isPageLoad('/admin/anything')).toBe(false);
  });

  it('does not treat infrastructure paths as pages', () => {
    expect(isPageLoad('/__/hosting/verification')).toBe(false);
  });

  it('removes asset hits from a sitting without splitting it', () => {
    const js = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:00:01Z', path: '/favicon.ico' }),
      hit({ ts: '2026-09-01T10:05:00Z', path: '/join' }),
    ]);
    expect(js).toHaveLength(1);
    expect(js[0].steps.map(s => s.path)).toEqual(['/', '/join']);
    // And the time on the front page is the time to the next PAGE, not the
    // one second until the browser asked for the icon.
    expect(js[0].steps[0].secondsOnPage).toBe(300);
    expect(js[0].durationSeconds).toBe(300);
  });

  it('is not a journey at all when a visitor only ever fetched assets', () => {
    expect(
      sessionize([
        hit({ ts: '2026-09-01T10:00:00Z', path: '/favicon.ico' }),
        hit({ ts: '2026-09-01T10:00:02Z', path: '/apple-touch-icon.png' }),
      ]),
    ).toEqual([]);
  });

  it('does not let an asset be where somebody stopped', () => {
    const [j] = sessionize([
      hit({ ts: '2026-09-01T10:00:00Z', path: '/' }),
      hit({ ts: '2026-09-01T10:00:30Z', path: '/telarchy' }),
      hit({ ts: '2026-09-01T10:00:31Z', path: '/favicon.ico' }),
    ]);
    expect(j.exitPath).toBe('/telarchy');
    expect(j.bounced).toBe(false);
  });
});
