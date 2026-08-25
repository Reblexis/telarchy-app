import '@testing-library/jest-dom/vitest';

// Vitest 4.x prints a `--localstorage-file` warning when its flag is malformed
// and, in some module-init paths, leaves localStorage undefined when api.ts
// reads it eagerly at import time. Provide a deterministic in-memory stub up
// front so module load never crashes before the test body runs.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

// jsdom does not implement matchMedia either, and the charts call it on mount
// to pick phone vs desktop geometry. Without it, any test that renders a chart
// dies on `window.matchMedia is not a function` before asserting anything.
// Default to desktop; a test that cares about the phone layout overrides it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom does not implement canvas, but Chart.js queries canvas context on
// construction. Provide a minimal stub so render tests don't crash.
HTMLCanvasElement.prototype.getContext = (() => {
  const noop = () => {};
  const stub = {
    canvas: document.createElement('canvas'),
    fillRect: noop,
    clearRect: noop,
    getImageData: () => ({ data: new Uint8ClampedArray() }),
    putImageData: noop,
    createImageData: () => ({ data: new Uint8ClampedArray() }),
    setTransform: noop,
    drawImage: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    stroke: noop,
    fill: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    arc: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 0 }),
    setLineDash: noop,
    getLineDash: () => [],
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
  };
  return () => stub as unknown as CanvasRenderingContext2D;
})();
