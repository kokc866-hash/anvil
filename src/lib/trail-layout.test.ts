import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitTrailSplit } from './trail-layout.ts';

describe('trail layout', () => {
  it('reserves readable tools despite a saved 712px thinking preference', () => {
    const split = fitTrailSplit(500, 712);
    assert.ok(split.tools >= 190);
    assert.ok(split.thinking < 712);
    assert.equal(split.thinking + split.tools + split.gap, 500);
  });
  it('keeps the preferred height when there is sufficient space', () => {
    assert.equal(fitTrailSplit(1100, 712).thinking, 712);
    assert.equal(fitTrailSplit(500, 200).thinking, 200);
  });
  it('gives tools priority when a pane becomes shorter than both regions', () => {
    assert.equal(fitTrailSplit(220, 712).tools, 96);
    const short = fitTrailSplit(90, 712);
    assert.equal(short.thinking, 0);
    assert.equal(short.tools, 78);
  });
  it('does not overflow for zero, fractional or invalid measurements', () => {
    for (const height of [0, 1, 11, 12, 60, 120, 221.9, 500, 5000, -10, NaN, Infinity]) {
      for (const preferred of [72, 200, 712, 5000, -1, NaN, Infinity]) {
        const split = fitTrailSplit(height, preferred);
        assert.ok(Object.values(split).every(value => Number.isFinite(value) && value >= 0));
        assert.equal(split.thinking + split.tools + split.gap, Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0);
        assert.ok(split.tools >= split.minTools);
      }
    }
  });
});
