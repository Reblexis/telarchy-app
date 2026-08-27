import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The picture's framing step (owner ask 2026-08-25): a picked file is not
 * saved on pick; it opens a frame with a zoom slider and a draggable
 * picture, and "Use this picture" stores exactly what the frame shows.
 * Pinned here: nothing saves until the confirm, Cancel keeps the old
 * picture, and the stored crop reflects the zoom and offset chosen.
 */

const upsertProfile = vi.fn(async () => ({}));
vi.mock('../../lib/api', () => ({
  api: {
    upsertProfile: (...a: unknown[]) => upsertProfile(...(a as [])),
    getParticipant: async () => ({ nickname: 'trader-1', balance: 1000, earnedBetting: 0 }),
    getProfile: async () => ({}),
    getPushKey: async () => ({ configured: false, publicKey: null }),
    getStatus: async () => ({ usdcSettlementEnabled: false }),
    getDepositAddress: async () => null,
    getMySeason: async () => null,
  },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'Trader', email: 't@x.com', image: null }, logout: async () => {} }),
}));

import { AccountDialog } from '../AccountDialog';

// jsdom neither decodes images nor draws canvases: a 400x200 landscape
// picture stands in, and the 2d context records what gets drawn.
const drawImage = vi.fn();
const RealImage = globalThis.Image;
beforeEach(() => {
  upsertProfile.mockClear();
  drawImage.mockClear();
  (globalThis as any).Image = class {
    width = 400;
    height = 200;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
  (URL as any).createObjectURL = () => 'blob:pick';
  (URL as any).revokeObjectURL = () => {};
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage })) as any;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,QUJD';
});
afterEach(() => {
  globalThis.Image = RealImage;
});

const pick = async () => {
  render(<AccountDialog onClose={() => {}} />);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByLabelText('Zoom')).toBeTruthy());
};

describe('framing the picture', () => {
  test('picking opens the frame and saves nothing yet', async () => {
    await pick();
    expect(upsertProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Use this picture')).toBeTruthy();
    expect((screen.getByLabelText('Zoom') as HTMLInputElement).value).toBe('1');
    // The step takes over the body: the identity head and the tabs step aside.
    expect(screen.getByText('Frame your picture')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Profile' })).toBeNull();
  });

  test('the zoom buttons step the slider and stop at the ends', async () => {
    await pick();
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect((screen.getByLabelText('Zoom') as HTMLInputElement).value).toBe('1.25');
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(false);
  });

  test('cancel drops the pick without saving', async () => {
    await pick();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByLabelText('Zoom')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeTruthy();
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  test('the stored crop is what the frame shows after zoom and drag', async () => {
    await pick();
    // Zoom 2x on a 400x200 picture in a 220px frame: scale 2.2, so the
    // frame covers a 100px square of the picture.
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    expect((screen.getByLabelText('Zoom') as HTMLInputElement).value).toBe('2');
    // Drag the picture 30px right and 10px down: the frame reads 30/2.2
    // and 10/2.2 picture pixels further up-left than centre.
    const frame = screen.getByLabelText('Drag to move the picture; arrow keys nudge it');
    fireEvent.pointerDown(frame, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 130, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 130, clientY: 110, pointerId: 1 });
    fireEvent.click(screen.getByText('Use this picture'));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({ image: 'data:image/jpeg;base64,QUJD' }));
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls[0] as number[];
    expect(sx).toBeCloseTo(150 - 30 / 2.2, 5);
    expect(sy).toBeCloseTo(50 - 10 / 2.2, 5);
    expect(sw).toBeCloseTo(100, 5);
    expect(sh).toBeCloseTo(100, 5);
    expect([dx, dy, dw, dh]).toEqual([0, 0, 256, 256]);
    expect(screen.queryByLabelText('Zoom')).toBeNull();
  });

  test('the offset clamps so the frame stays covered', async () => {
    await pick();
    // At 1x the 200px side fills the frame exactly: no vertical room, and
    // 110px of horizontal room each way. Arrow keys nudge 4px (20 shifted).
    const frame = screen.getByLabelText('Drag to move the picture; arrow keys nudge it');
    for (let i = 0; i < 10; i++) fireEvent.keyDown(frame, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(frame, { key: 'ArrowDown', shiftKey: true });
    fireEvent.click(screen.getByText('Use this picture'));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalled());
    const [, sx, sy, sw] = drawImage.mock.calls[0] as number[];
    expect(sx).toBeCloseTo(0, 5); // pinned to the left edge, not past it
    expect(sy).toBeCloseTo(0, 5);
    expect(sw).toBeCloseTo(200, 5);
  });
});
