import type { Point } from './types';

export function inside(point: Point, polygon: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = point,
      [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-8 &&
      x >= Math.min(xi, xj) &&
      x <= Math.max(xi, xj) &&
      y >= Math.min(yi, yj) &&
      y <= Math.max(yi, yj)
    )
      return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function mergeSelection(
  current: Set<string>,
  incoming: string[],
  operation: string,
): Set<string> {
  if (operation === 'replace') return new Set(incoming);
  const next = new Set(current);
  incoming.forEach((id) => (operation === 'subtract' ? next.delete(id) : next.add(id)));
  return next;
}

export function metadataColor(value: string | null | undefined): string {
  if (value == null) return '#969ca7';
  const palette = [
    '#39c6aa',
    '#f4ad55',
    '#8e8ce8',
    '#ec7ca3',
    '#50b6e0',
    '#c7ca65',
    '#c195dc',
    '#64c788',
    '#df8665',
    '#6b9ae3',
  ];
  let hash = 0;
  for (const c of value) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return palette[(hash >>> 0) % palette.length];
}

export function expressionColor(value: number | null | undefined, max: number): string {
  if (value == null) return '#969ca7';
  const t = Math.max(0, Math.min(1, value / Math.max(max, 1e-9)));
  return `rgb(${Math.round(40 + 210 * t)},${Math.round(53 + 158 * t)},${Math.round(78 - 5 * t)})`;
}
