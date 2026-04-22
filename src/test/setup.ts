import '@testing-library/jest-dom/vitest';

// jsdom does not implement canvas, but Chart.js queries canvas context on
// construction. Provide a minimal stub so render tests don't crash.
HTMLCanvasElement.prototype.getContext = (() => {
  const noop = () => {};
  const stub = {
    canvas: document.createElement('canvas'),
    fillRect: noop, clearRect: noop, getImageData: () => ({ data: new Uint8ClampedArray() }),
    putImageData: noop, createImageData: () => ({ data: new Uint8ClampedArray() }),
    setTransform: noop, drawImage: noop, save: noop, restore: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, stroke: noop,
    fill: noop, translate: noop, scale: noop, rotate: noop, arc: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
    setLineDash: noop, getLineDash: () => [], createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null,
  };
  return () => stub as unknown as CanvasRenderingContext2D;
})();
