import { describe, it, expect } from 'vitest';
import {
  AutoCapture,
  CaptureTimer,
  duplicateView,
  commonDisplacement,
  coverage,
} from '../../src/core/capture';
import type { Analysis, Corner } from '../../src/core/types';
const corners = (offset = 0): Corner[] =>
  Array.from({ length: 12 }, (_, id) => ({
    id,
    x: 50 + (id % 4) * 40 + offset,
    y: 50 + Math.floor(id / 4) * 40,
  }));
const detected = (offset = 0): Analysis => ({
  corners: corners(offset),
  valid: true,
  reason: 'Board detected',
  sharpness: 80,
  contrast: 40,
  brightness: 128,
  clipped: 0,
});
describe('handheld automatic capture', () => {
  it('accepts gentle drift that the strict gate rejects', () => {
    const handheld = new AutoCapture(),
      strict = new AutoCapture('strict');
    for (const time of [0, 50, 100, 150, 200]) {
      handheld.update(detected(time * 0.004), time, 640);
      strict.update(detected(time * 0.004), time, 640);
    }
    expect(handheld.update(detected(1), 250, 640).capture).toBe(true);
    expect(strict.update(detected(1), 250, 640).capture).toBe(false);
  });
  it('allows small hand tremor with a short exposure, but rejects larger oscillation', () => {
    for (const [amplitude, accepted] of [
      [0.35, true],
      [1.2, true],
      [3, false],
    ] as const) {
      const gate = new AutoCapture();
      const settings = { exposureMode: 'manual', exposureTime: 100 };
      for (let i = 0; i < 5; i++)
        gate.update(detected(i % 2 ? amplitude : -amplitude), i * 50, 640, settings);
      expect(gate.update(detected(amplitude), 250, 640, settings).capture).toBe(accepted);
    }
  });
  it('tightens motion tolerance for long manual exposures', () => {
    for (const [exposureTime, accepted] of [
      [100, true],
      [2000, false],
    ] as const) {
      const gate = new AutoCapture();
      const settings = { exposureMode: 'manual', exposureTime };
      for (const time of [0, 50, 100, 150, 200])
        gate.update(detected(time * 0.004), time, 640, settings);
      expect(gate.update(detected(1), 250, 640, settings).capture).toBe(accepted);
    }
  });
  it('uses a frame-period fallback for auto exposure and invalid or missing metadata', () => {
    for (const settings of [
      {},
      { exposureMode: 'continuous', exposureTime: 1, frameRate: 30 },
      { exposureMode: 'manual', exposureTime: NaN, frameRate: Infinity },
      { exposureMode: 'manual', exposureTime: 0, frameRate: 0 },
      { exposureMode: 'manual', exposureTime: -1, frameRate: -1 },
      { exposureMode: 'manual', exposureTime: Infinity, frameRate: 120 },
    ]) {
      const gate = new AutoCapture();
      for (const time of [0, 50, 100, 150, 200, 250])
        expect(gate.update(detected(time * 0.02), time, 1280, settings).capture).toBe(false);
    }
    const gate = new AutoCapture();
    const settings = { exposureMode: 'manual', exposureTime: 100 };
    for (const time of [0, 50, 100, 150, 200])
      gate.update(detected(time * 0.02), time, 1280, settings);
    expect(gate.update(detected(5), 250, 1280, settings).capture).toBe(true);
  });
  it('accounts for lower frame rates when exposure is unknown', () => {
    for (const [frameRate, accepted] of [
      [30, true],
      [10, false],
    ] as const) {
      const gate = new AutoCapture();
      for (const time of [0, 100, 200, 300])
        gate.update(detected(time * 0.008), time, 640, { frameRate });
      expect(gate.update(detected(3.2), 400, 640, { frameRate }).capture).toBe(accepted);
    }
  });
  it('accepts movement at short exposure and measures travel in full-resolution pixels', () => {
    const settings = { exposureMode: 'manual', exposureTime: 10 };
    for (const width of [640, 1280, 1920]) {
      for (const [speed, accepted] of [
        [100, true],
        [600, false],
      ] as const) {
        const gate = new AutoCapture();
        const view = (time: number) => ({
          ...detected(),
          corners: corners((speed * time) / 1000).map((p) => ({
            ...p,
            x: (p.x * width) / 640,
            y: (p.y * width) / 640,
          })),
        });
        for (const time of [0, 50, 100, 150, 200]) gate.update(view(time), time, width, settings);
        expect(gate.update(view(250), 250, width, settings).capture).toBe(accepted);
      }
    }
  });
  it('does not average a sudden movement into an otherwise steady window', () => {
    const gate = new AutoCapture();
    for (let time = 0; time <= 10000; time += 50) gate.update(detected(), time, 640);
    expect(gate.update(detected(2), 10050, 640).capture).toBe(false);
  });
  it('requires a fresh window after changing steadiness and preserves duplicate suppression', () => {
    const gate = new AutoCapture();
    gate.captured(corners(), -1000);
    for (const time of [100, 150, 200]) gate.update(detected(30), time, 640);
    gate.setSteadiness('strict');
    for (const time of [250, 300, 350, 400, 450])
      expect(gate.update(detected(30), time, 640).capture).toBe(false);
    expect(gate.update(detected(30), 500, 640).capture).toBe(true);
    gate.setSteadiness('handheld');
    for (const time of [600, 650, 700, 750, 800, 850])
      expect(gate.update(detected(), time, 640).capture).toBe(false);
  });
  it('handles a reconnected stream restarting its timestamps without a stale cooldown', () => {
    const gate = new AutoCapture();
    gate.captured(corners(), 10000);
    gate.reset();
    for (const time of [0, 50]) expect(gate.update(detected(30), time, 640).capture).toBe(false);
    expect(gate.update(detected(30), 100, 640).capture).toBe(true);
  });
});
describe('strict automatic capture', () => {
  it('requires a complete 250 ms stationary window even with five frames already seen', () => {
    const gate = new AutoCapture('strict');
    for (let time = 0; time < 250; time += 50)
      expect(gate.update(detected(), time, 640).capture).toBe(false);
    expect(gate.update(detected(), 250, 640).capture).toBe(true);
  });
  it('waits for five analyzed frames when the detector is slower', () => {
    const gate = new AutoCapture('strict');
    for (const time of [0, 100, 200, 300])
      expect(gate.update(detected(), time, 640).capture).toBe(false);
    expect(gate.update(detected(), 400, 640).capture).toBe(true);
  });
  it('requires a fresh strict window after the 750 ms cooldown', () => {
    const gate = new AutoCapture('strict');
    gate.captured(corners(), 0);
    for (const time of [20, 100, 500, 749])
      expect(gate.update(detected(30), time, 640).progress).toBe(0);
    for (const time of [750, 800, 850, 900, 950])
      expect(gate.update(detected(30), time, 640).capture).toBe(false);
    expect(gate.update(detected(30), 1000, 640).capture).toBe(true);
  });
  it('does not count repeated frames or catch-up after a suspended tab', () => {
    const gate = new AutoCapture('strict');
    gate.update(detected(), 0, 640);
    for (let i = 0; i < 10; i++) expect(gate.update(detected(), 0, 640).capture).toBe(false);
    expect(gate.update(detected(), 10000, 640).progress).toBe(0);
  });
  it('compares motion against an anchor, so slow drift never looks still', () => {
    const gate = new AutoCapture('strict');
    for (let i = 0; i < 30; i++)
      expect(gate.update(detected(i * 0.7), i * 100, 640).capture).toBe(false);
  });
  it('rejects 4 px/s drift that fits inside the old displacement tolerance over 250 ms', () => {
    const gate = new AutoCapture('strict');
    for (let time = 0; time <= 1500; time += 50)
      expect(gate.update(detected(time * 0.004), time, 640).capture).toBe(false);
    // Once movement stops, a fresh 250 ms window can qualify.
    for (let time = 1550; time < 1750; time += 50)
      expect(gate.update(detected(6), time, 640).capture).toBe(false);
    expect(gate.update(detected(6), 1750, 640).capture).toBe(true);
  });
  it('normalizes the speed limit for resolution', () => {
    for (const width of [640, 1280, 1920]) {
      const scale = width / 640,
        slow = new AutoCapture('strict'),
        fast = new AutoCapture('strict');
      const view = (speed: number, time: number) => ({
        ...detected(),
        corners: corners((speed * time) / 1000).map((p) => ({
          ...p,
          x: p.x * scale,
          y: p.y * scale,
        })),
      });
      for (const time of [0, 50, 100, 150, 200]) {
        slow.update(view(1, time), time, width);
        fast.update(view(4, time), time, width);
      }
      expect(slow.update(view(1, 250), 250, width).capture).toBe(true);
      expect(fast.update(view(4, 250), 250, width).capture).toBe(false);
    }
  });
  it('accepts small alternating detector jitter instead of using noisy frame-to-frame speed', () => {
    const gate = new AutoCapture('strict');
    for (let i = 0; i < 5; i++) gate.update(detected(i % 2 ? 0.1 : -0.1), i * 50, 640);
    expect(gate.update(detected(0.1), 250, 640).capture).toBe(true);
  });
  it('uses recent motion even after a long stable preview with auto capture disabled', () => {
    const gate = new AutoCapture('strict');
    for (let time = 0; time <= 10000; time += 50) gate.update(detected(), time, 640);
    const status = gate.update(detected(1.2), 10050, 640);
    expect(status.capture).toBe(false);
    expect(status.reason).toContain('Movement detected');
  });
  it('detects rotation even when the center of the board does not move', () => {
    const gate = new AutoCapture('strict');
    const rotated = (time: number) => ({
      ...detected(),
      corners: corners().map((p) => {
        const a = time * 0.00008,
          x = p.x - 110,
          y = p.y - 90;
        return {
          ...p,
          x: 110 + x * Math.cos(a) - y * Math.sin(a),
          y: 90 + x * Math.sin(a) + y * Math.cos(a),
        };
      }),
    });
    for (const time of [0, 50, 100, 150, 200]) gate.update(rotated(time), time, 640);
    expect(gate.update(rotated(250), 250, 640).capture).toBe(false);
  });
  it('suppresses duplicate views even after the board leaves and returns', () => {
    const gate = new AutoCapture('strict');
    gate.captured(corners(), 0);
    for (let i = 1; i < 30; i++) expect(gate.update(detected(), i * 100, 640).capture).toBe(false);
    for (let i = 0; i < 5; i++)
      expect(gate.update(detected(30), 3000 + i * 50, 640).capture).toBe(false);
    expect(gate.update(detected(30), 3250, 640).capture).toBe(true);
    gate.captured(corners(30), 3250);
    gate.update({ ...detected(), valid: false }, 4000, 640);
    for (let i = 0; i < 5; i++) gate.update(detected(30), 5000 + i * 50, 640);
    expect(gate.update(detected(30), 5250, 640).capture).toBe(false);
  });
  it('starts a fresh window when a detection is lost or a duplicate view interrupts it', () => {
    for (const loss of [true, false]) {
      const gate = new AutoCapture('strict');
      gate.captured(corners(), -1000);
      for (const time of [100, 150, 200]) gate.update(detected(30), time, 640);
      gate.update({ ...detected(), valid: !loss }, 250, 640);
      for (const time of [300, 350, 400, 450, 500])
        expect(gate.update(detected(30), time, 640).capture).toBe(false);
      expect(gate.update(detected(30), 550, 640).capture).toBe(true);
    }
  });
  it('rejects speed estimates without enough corner IDs shared across the window', () => {
    const gate = new AutoCapture('strict');
    for (const time of [0, 50, 100, 150, 200, 250]) {
      const view = detected();
      view.corners = view.corners.filter((p) => p.id !== time / 50);
      expect(gate.update(view, time, 640).capture).toBe(false);
    }
  });
  it('matches corner IDs, and rejects motion estimates without enough overlap', () => {
    expect(commonDisplacement(corners(), corners(3).reverse())).toBe(3);
    expect(commonDisplacement(corners(), corners().slice(0, 2))).toBe(Infinity);
  });
  it('counts independent views, not corner density, for each coverage cell', () => {
    const one = {
      included: true,
      corners: [
        { id: 0, x: 1, y: 1 },
        { id: 1, x: 2, y: 2 },
      ],
    };
    expect(coverage([one], 640, 480).cells[0]).toBe(1);
    expect(coverage([one, one, { ...one, included: false }], 640, 480).cells[0]).toBe(2);
  });
});

describe('capture scheduling', () => {
  it('accepts three fresh frames spanning 100ms and handles slow analysis', () => {
    const settings = { exposureMode: 'manual', exposureTime: 10 };
    const gate = new AutoCapture();
    expect(gate.update(detected(0), 0, 640, settings).capture).toBe(false);
    expect(gate.update(detected(5), 50, 640, settings).capture).toBe(false);
    expect(gate.update(detected(10), 100, 640, settings).capture).toBe(true);
    gate.reset(true);
    expect(gate.update(detected(), 0, 640).capture).toBe(false);
    expect(gate.update(detected(), 600, 640).capture).toBe(false);
    expect(gate.update(detected(), 1200, 640).capture).toBe(true);
    expect(gate.update(detected(), 2301, 640).capture).toBe(false);
  });
  it('forgets duplicate history only for a different session', () => {
    const gate = new AutoCapture();
    gate.captured(corners(), 0);
    gate.reset();
    for (const t of [1000, 1050, 1100]) expect(gate.update(detected(), t, 640).capture).toBe(false);
    gate.reset(true);
    for (const t of [2000, 2050]) expect(gate.update(detected(), t, 640).capture).toBe(false);
    expect(gate.update(detected(), 2100, 640).capture).toBe(true);
  });
  it('uses fresh frame deadlines without accumulating missed shots', () => {
    const timer = new CaptureTimer();
    timer.restart(1000, 5);
    expect(timer.remaining(1001)).toBe(5);
    expect(timer.due(5999)).toBe(false);
    expect(timer.due(6000)).toBe(true);
    timer.restart(12000, 5); // save/skip completed late
    expect(timer.due(12001)).toBe(false);
    expect(timer.remaining(12001)).toBe(5);
    timer.stop();
    expect(timer.due(100000)).toBe(false);
  });
  it('shares duplicate checks with the timer without requiring stillness', () => {
    expect(duplicateView(corners(), corners(5), 640)).toBe(true);
    expect(duplicateView(corners(), corners(20), 640)).toBe(false);
    expect(duplicateView([], corners(), 640)).toBe(false);
  });
});

it('retains the automatic-save cooldown across settings and mode changes', () => {
  const gate = new AutoCapture();
  gate.captured(corners(), 0);
  gate.reset();
  for (const time of [100, 200, 300, 500, 749])
    expect(gate.update(detected(30), time, 640).capture).toBe(false);
  for (const time of [750, 800]) expect(gate.update(detected(30), time, 640).capture).toBe(false);
  expect(gate.update(detected(30), 850, 640).capture).toBe(true);
});
