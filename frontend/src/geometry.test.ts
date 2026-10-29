import { describe, expect, it } from 'vitest';
import { inside, mergeSelection, metadataColor } from './geometry';

describe('cell center selection', () => {
  const roi: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('includes boundaries and excludes cells outside the ROI', () => {
    expect(inside([5, 5], roi)).toBe(true);
    expect(inside([0, 5], roi)).toBe(true);
    expect(inside([11, 5], roi)).toBe(false);
  });
  it('maintains stable IDs across additive and subtractive selections', () => {
    const selected = mergeSelection(new Set(['cell-a']), ['cell-b'], 'add');
    expect([...selected]).toEqual(['cell-a', 'cell-b']);
    expect([...mergeSelection(selected, ['cell-a'], 'subtract')]).toEqual(['cell-b']);
    expect([...mergeSelection(selected, ['cell-c'], 'replace')]).toEqual(['cell-c']);
  });
  it('reserves gray for missing annotation', () => {
    expect(metadataColor(null)).toBe('#969ca7');
    expect(metadataColor('T cells')).not.toBe(metadataColor(null));
  });
});
