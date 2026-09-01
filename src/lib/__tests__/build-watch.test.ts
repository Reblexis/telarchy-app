import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { pageHasTypedText, RELOAD_GUARD_KEY, runningBundlePath, startBuildWatch } from '../build-watch';

/**
 * The rule this file protects: a phone that had the app open must end up on
 * the new build, and must never lose what someone typed to get there
 * (docs/infra/deploy.md, "A tab that is already open picks the new build up").
 */

const OLD = '/assets/index-OLD11111.js';
const NEW = '/assets/index-NEW22222.js';
const indexHtml = (bundle: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${bundle}"></script>` +
  `<link rel="stylesheet" crossorigin href="/assets/index-B3fz7wD6.css"></head><body></body></html>`;

function setVisible(visible: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: !visible });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: visible ? 'visible' : 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Leave for `awayMs`, come back: the phone case, in two lines. */
async function leaveAndReturn(awayMs: number) {
  setVisible(false);
  await vi.advanceTimersByTimeAsync(awayMs);
  setVisible(true);
  await vi.advanceTimersByTimeAsync(1);
}

/** Every watch this file starts, so none survives into the next test: a
 *  watch left attached answers the next test's events too, and would take
 *  the reload slot out from under it. */
const running: Array<() => void> = [];

function watch(over: Record<string, unknown> = {}) {
  const fetchIndexHtml = vi.fn().mockResolvedValue(indexHtml(NEW));
  const onUpdate = vi.fn();
  const reload = vi.fn();
  const stop = startBuildWatch({
    runningBundle: OLD,
    fetchIndexHtml,
    onUpdate,
    reload,
    awayMs: 60_000,
    ...over,
  } as Parameters<typeof startBuildWatch>[0]);
  running.push(stop);
  return { fetchIndexHtml, onUpdate, reload, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
  sessionStorage.clear();
  document.body.innerHTML = '';
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  while (running.length) running.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startBuildWatch', () => {
  test('a tab coming back from a minute away lands on the new build by itself', async () => {
    const { reload, onUpdate } = watch();
    await leaveAndReturn(90_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('the same build is not an update: no reload, no pill', async () => {
    const { reload, onUpdate } = watch({ fetchIndexHtml: vi.fn().mockResolvedValue(indexHtml(OLD)) });
    await leaveAndReturn(90_000);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('RULE: text a visitor typed outranks a fresh build - it offers, never reloads', async () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    (document.getElementById('t') as HTMLTextAreaElement).value = 'half a comment I am still writing';
    const { reload, onUpdate } = watch();
    await leaveAndReturn(600_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test('a visitor who is looking at the page is offered the reload, not given it', async () => {
    const { reload, onUpdate } = watch();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  test('a short glance away is not a return: under the away window it offers instead', async () => {
    const { reload, onUpdate } = watch();
    await leaveAndReturn(5_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test('a hidden tab costs nothing: no check while the phone is elsewhere', async () => {
    const { fetchIndexHtml } = watch();
    setVisible(false);
    await vi.advanceTimersByTimeAsync(1_200_000);
    expect(fetchIndexHtml).not.toHaveBeenCalled();
  });

  test('a bfcache restore counts as a return, even with no visibility change', async () => {
    const { reload } = watch();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a fresh page load (pageshow, not persisted) checks but does not auto-reload', async () => {
    const { reload, onUpdate } = watch();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test('RULE: one automatic reload a minute at most, so no tab can loop', async () => {
    const { reload, onUpdate } = watch({ awayMs: 1_000 });
    await leaveAndReturn(2_000);
    expect(reload).toHaveBeenCalledTimes(1);
    await leaveAndReturn(2_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test('the guard survives the reload it caused: a recent stamp holds the next tab back', async () => {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now() - 10_000));
    const { reload, onUpdate } = watch({ awayMs: 1_000 });
    await leaveAndReturn(2_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test('an old stamp does not hold it back forever', async () => {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now() - 3_600_000));
    const { reload } = watch();
    await leaveAndReturn(90_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('the beta base path is not a new build: the hashed name is what is compared', async () => {
    const { reload, onUpdate } = watch({
      runningBundle: '/beta/assets/index-OLD11111.js',
      fetchIndexHtml: vi.fn().mockResolvedValue(indexHtml('/beta/assets/index-OLD11111.js')),
    });
    await leaveAndReturn(90_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('inert in dev: no built bundle means no listeners and no requests', async () => {
    const { fetchIndexHtml, reload, onUpdate } = watch({ runningBundle: null });
    await leaveAndReturn(90_000);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchIndexHtml).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('a served page with no built bundle (dev server answering) changes nothing', async () => {
    const { reload, onUpdate } = watch({
      fetchIndexHtml: vi.fn().mockResolvedValue('<script type="module" src="/src/main.tsx"></script>'),
    });
    await leaveAndReturn(90_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('a failed check is quiet: offline never reloads and never throws', async () => {
    const { reload, onUpdate } = watch({ fetchIndexHtml: vi.fn().mockRejectedValue(new Error('offline')) });
    await leaveAndReturn(90_000);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('stopping the watch detaches it: no check after the page unmounts', async () => {
    const { fetchIndexHtml, stop } = watch();
    stop();
    await leaveAndReturn(90_000);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchIndexHtml).not.toHaveBeenCalled();
  });

  test('storage being off does not stop the reload (private mode still updates)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage off');
    });
    const { reload } = watch();
    await leaveAndReturn(90_000);
    expect(reload).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('pageHasTypedText', () => {
  test('an empty page has nothing to lose', () => {
    document.body.innerHTML = '<input type="text"><textarea></textarea>';
    expect(pageHasTypedText()).toBe(false);
  });

  test('a typed field has', () => {
    document.body.innerHTML = '<input type="text" id="a">';
    (document.getElementById('a') as HTMLInputElement).value = '400';
    expect(pageHasTypedText()).toBe(true);
  });

  test('whitespace alone is not typed text', () => {
    document.body.innerHTML = '<input type="text" id="a">';
    (document.getElementById('a') as HTMLInputElement).value = '   ';
    expect(pageHasTypedText()).toBe(false);
  });

  test('a prefilled hidden field is not something a visitor typed', () => {
    document.body.innerHTML = '<input type="hidden" id="a">';
    (document.getElementById('a') as HTMLInputElement).value = 'csrf-token';
    expect(pageHasTypedText()).toBe(false);
  });

  test('a ticked checkbox is not typed text', () => {
    document.body.innerHTML = '<input type="checkbox" id="a" checked>';
    expect(pageHasTypedText()).toBe(false);
  });

  test('a contenteditable with words in it counts', () => {
    document.body.innerHTML = '<div contenteditable="true">a comment</div>';
    expect(pageHasTypedText()).toBe(true);
  });
});

describe('runningBundlePath', () => {
  test('reads the entry bundle the document actually loaded', () => {
    document.head.innerHTML = `<script type="module" crossorigin src="${OLD}"></script>`;
    expect(runningBundlePath()).toBe(OLD);
    document.head.innerHTML = '';
  });

  test('is null in dev, which is what keeps the watch inert there', () => {
    document.head.innerHTML = '<script type="module" src="/src/main.tsx"></script>';
    expect(runningBundlePath()).toBeNull();
    document.head.innerHTML = '';
  });
});
