import { describe, it, expect } from 'vitest';
import { AutoCapture, commonDisplacement, coverage } from '../../src/core/capture';
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
describe('automatic capture', () => {
  it('requires a complete 250 ms stationary window even with five frames already seen', () => {
    const gate = new AutoCapture();
    for (let time = 0; time < 250; time += 50)
      expect(gate.update(detected(), time, 640).capture).toBe(false);
    expect(gate.update(detected(), 250, 640).capture).toBe(true);
  });
  it('waits for five analyzed frames when the detector is slower', () => {
    const gate = new AutoCapture();
    for (const time of [0, 100, 200, 300])
      expect(gate.update(detected(), time, 640).capture).toBe(false);
    expect(gate.update(detected(), 400, 640).capture).toBe(true);
  });
  it('allows a new stable view after the 100 ms cooldown, not a full second', () => {
    const gate = new AutoCapture();
    gate.captured(corners(), 0);
    for (const time of [20, 40, 60, 80, 99])
      expect(gate.update(detected(30), time, 640).progress).toBe(0);
    for (const time of [100, 150, 200, 250, 300])
      expect(gate.update(detected(30), time, 640).capture).toBe(false);
    expect(gate.update(detected(30), 350, 640).capture).toBe(true);
  });
  it('does not count repeated frames or catch-up after a suspended tab', () => {
    const gate = new AutoCapture();
    gate.update(detected(), 0, 640);
    for (let i = 0; i < 10; i++) expect(gate.update(detected(), 0, 640).capture).toBe(false);
    expect(gate.update(detected(), 10000, 640).progress).toBe(0);
  });
  it('compares motion against an anchor, so slow drift never looks still', () => {
    const gate = new AutoCapture();
    for (let i = 0; i < 30; i++)
      expect(gate.update(detected(i * 0.7), i * 100, 640).capture).toBe(false);
  });
  it('rejects 4 px/s drift that fits inside the old displacement tolerance over 250 ms', () => {
    const gate = new AutoCapture();
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
        slow = new AutoCapture(),
        fast = new AutoCapture();
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
    const gate = new AutoCapture();
    for (let i = 0; i < 5; i++) gate.update(detected(i % 2 ? 0.1 : -0.1), i * 50, 640);
    expect(gate.update(detected(0.1), 250, 640).capture).toBe(true);
  });
  it('uses recent motion even after a long stable preview with auto capture disabled', () => {
    const gate = new AutoCapture();
    for (let time = 0; time <= 10000; time += 50) gate.update(detected(), time, 640);
    const status = gate.update(detected(1.2), 10050, 640);
    expect(status.capture).toBe(false);
    expect(status.reason).toContain('Movement detected');
  });
  it('detects rotation even when the center of the board does not move', () => {
    const gate = new AutoCapture();
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
  it('suppresses duplicate views until the board moves or leaves', () => {
    const gate = new AutoCapture();
    gate.captured(corners(), 0);
    for (let i = 1; i < 30; i++) expect(gate.update(detected(), i * 100, 640).capture).toBe(false);
    for (let i = 0; i < 5; i++)
      expect(gate.update(detected(30), 3000 + i * 50, 640).capture).toBe(false);
    expect(gate.update(detected(30), 3250, 640).capture).toBe(true);
    gate.captured(corners(30), 3250);
    gate.update({ ...detected(), valid: false }, 4000, 640);
    for (let i = 0; i < 5; i++) gate.update(detected(30), 5000 + i * 50, 640);
    expect(gate.update(detected(30), 5250, 640).capture).toBe(true);
  });
  it('starts a fresh window when a detection is lost or a duplicate view interrupts it', () => {
    for (const loss of [true, false]) {
      const gate = new AutoCapture();
      gate.captured(corners(), 0);
      for (const time of [100, 150, 200]) gate.update(detected(30), time, 640);
      gate.update({ ...detected(), valid: !loss }, 250, 640);
      for (const time of [300, 350, 400, 450, 500])
        expect(gate.update(detected(30), time, 640).capture).toBe(false);
      expect(gate.update(detected(30), 550, 640).capture).toBe(true);
    }
  });
  it('rejects speed estimates without enough corner IDs shared across the window', () => {
    const gate = new AutoCapture();
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
