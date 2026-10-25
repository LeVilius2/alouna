import type { CategoryRule } from './types';

function rule(
  category: string,
  label: string,
  passable: boolean,
  cost: number,
  buffer_m: number,
  warn_m: number | null,
  color: string,
  overrides: readonly string[] = [],
): CategoryRule {
  return Object.freeze({
    category,
    label,
    passable,
    cost,
    buffer_m,
    warn_m,
    color,
    overrides: Object.freeze([...overrides]),
    priority: overrides.length ? 100 : 0,
  });
}

export const DEFAULT_RULES: readonly CategoryRule[] = Object.freeze([
  rule('walkable_area', 'Walkable area', true, 1, 0, null, '#86efac'),
  rule('grass', 'Grass', true, 1, 0, null, '#bbf7d0'),
  rule('path', 'Path', true, 0.4, 0, null, '#eab308'),
  rule('rough', 'Rough ground', true, 3, 0, null, '#a16207'),
  rule('caution', 'Caution', true, 6, 0, 3, '#f97316'),
  rule('road', 'Road', false, 1, 1, 5, '#6b7280'),
  rule('crossing', 'Road crossing', true, 1, 0, 5, '#facc15', ['road']),
  rule('ditch', 'Ditch', false, 1, 1.5, 4, '#7c3aed'),
  rule('water', 'Water', false, 1, 2.5, 6, '#38bdf8'),
  rule('dock', 'Dock', true, 1, 0, 3, '#c084fc', ['water']),
  rule('building', 'Building', false, 1, 0.5, 2, '#a8a29e'),
  rule('fence', 'Fence', false, 1, 0.3, 2, '#525252'),
  rule('wall', 'Wall', false, 1, 0.3, 2, '#737373'),
  rule('gate', 'Gate', true, 1, 0, 3, '#22c55e', ['fence', 'wall', 'building']),
  rule('door', 'Door', true, 1, 0, 3, '#16a34a', ['fence', 'wall', 'building']),
  // The obstacle's physical radius defaults to 0.7 m; it is not added twice.
  rule('obstacle', 'Obstacle', false, 1, 0, 2, '#ef4444'),
  rule('steps', 'Steps', true, 2, 0, 3, '#fb923c'),
  rule('no_go', 'No-go area', false, 1, 1, 4, '#dc2626'),
  rule('landmark', 'Landmark', true, 1, 0, null, '#2563eb'),
]);
