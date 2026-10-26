import type { ParseResult, RawFeature, RawPosition } from './types';

export type JoinMode = 'points' | 'line' | 'polygon';

const X_NAMES = ['lon', 'lng', 'long', 'longitude', 'x', 'easting', 'e', 'ilguma'];
const Y_NAMES = ['lat', 'latitude', 'y', 'northing', 'n', 'platuma'];
const NAME_NAMES = ['name', 'title', 'label', 'pavadinimas', 'description'];
const GROUP_NAMES = ['group', 'feature', 'feature_id', 'id', 'line', 'polygon', 'shape', 'object'];
const CATEGORY_NAMES = ['category', 'kategorija', 'type'];

function detectDelimiter(lines: readonly string[]): string | RegExp {
  const sample = lines.slice(0, 5).join('\n');
  if (sample.includes('\t')) return '\t';
  if (sample.includes(';')) return ';';
  if (sample.includes(',')) {
    // "55.63, 25.69" -> comma separated. "55,63 25,69" -> decimal commas separated by spaces.
    const commaSeparated = lines.slice(0, 5).every((l) => /\d\s*,\s*-?\d/.test(l) && /\./.test(l));
    if (commaSeparated || !/^\s*-?\d+,\d+\s+-?\d+,\d+/.test(lines[0] ?? '')) return ',';
  }
  return /\s+/;
}

function parseNumber(value: string | undefined, decimalComma: boolean): number | null {
  if (value === undefined) return null;
  let v = value.trim().replace(/^"|"$/g, '');
  if (decimalComma) v = v.replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return null;
  return Number(v);
}

function splitLine(line: string, delimiter: string | RegExp): string[] {
  if (delimiter instanceof RegExp) return line.trim().split(delimiter);
  // Minimal quoted-field support.
  const out: string[] = [];
  let cur = '',
    quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse CSV or pasted coordinate text.
 * - With a header row, recognised columns are x/lon/easting, y/lat/northing, name, group, category.
 *   Rows sharing a group value form one line/polygon (polygon if the group closes or `join` says so).
 * - Without a header, each row is `a, b[, name]`. Column order is kept as-is; CRS detection
 *   decides later whether it is lat/lon or lon/lat.
 * `join` controls how header-less rows (or rows without a group column) are combined.
 */
export function parseCoordinateText(text: string, join: JoinMode = 'points'): ParseResult {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return { features: [], warnings: ['No coordinates found.'] };
  const delimiter = detectDelimiter(lines);
  const decimalComma = delimiter === ';' || delimiter === '\t' || delimiter instanceof RegExp;
  const firstCells = splitLine(lines[0]!, delimiter);
  // A header row is one whose first two cells are not both numbers ("55.6;25.6;Well" is data).
  const hasHeader =
    parseNumber(firstCells[0], decimalComma) === null ||
    parseNumber(firstCells[1], decimalComma) === null;
  let xi = 0,
    yi = 1,
    ni = -1,
    gi = -1,
    ci = -1;
  let rows = lines;
  if (hasHeader) {
    const header = firstCells.map((c) => c.toLowerCase().replace(/^"|"$/g, ''));
    const find = (names: string[]) => header.findIndex((h) => names.includes(h));
    xi = find(X_NAMES);
    yi = find(Y_NAMES);
    ni = find(NAME_NAMES);
    gi = find(GROUP_NAMES);
    ci = find(CATEGORY_NAMES);
    if (xi < 0 || yi < 0) {
      // Fall back to the first two numeric-looking columns.
      warnings.push('Coordinate columns not recognised by name; using the first two columns.');
      xi = 0;
      yi = 1;
    }
    rows = lines.slice(1);
  } else if (firstCells.length >= 3 && parseNumber(firstCells[2], decimalComma) === null) {
    ni = 2;
  }

  type Row = { p: RawPosition; name: string; group: string; category: string };
  const parsed: Row[] = [];
  rows.forEach((line, i) => {
    const cells = splitLine(line, delimiter);
    const x = parseNumber(cells[xi], decimalComma),
      y = parseNumber(cells[yi], decimalComma);
    if (x === null || y === null) {
      warnings.push(`Line ${i + 1 + (hasHeader ? 1 : 0)}: could not read coordinates, skipped.`);
      return;
    }
    parsed.push({
      p: [x, y],
      name: ni >= 0 ? (cells[ni] ?? '') : '',
      group: gi >= 0 ? (cells[gi] ?? '') : '',
      category: ci >= 0 ? (cells[ci] ?? '') : '',
    });
  });

  const features: RawFeature[] = [];
  const build = (group: Row[], mode: JoinMode, groupName: string) => {
    const props = (r: Row) => ({
      ...(r.name ? { name: r.name } : {}),
      ...(r.category ? { category: r.category } : {}),
    });
    const pts = group.map((r) => r.p);
    const first = pts[0],
      last = pts.at(-1);
    const closed = pts.length >= 4 && first && last && first[0] === last[0] && first[1] === last[1];
    const effective: JoinMode = mode === 'points' ? 'points' : closed ? 'polygon' : mode;
    if (effective === 'points' || pts.length === 1) {
      for (const r of group)
        features.push({ geometry: { type: 'Point', coordinates: r.p }, properties: props(r) });
      return;
    }
    const properties = {
      ...props(group[0]!),
      ...(groupName && !group[0]!.name ? { name: groupName } : {}),
    };
    if (effective === 'polygon') {
      const ringPts = closed ? pts : [...pts, pts[0]!];
      if (ringPts.length < 4) {
        warnings.push(`${groupName || 'Polygon'}: needs at least 3 points, skipped.`);
        return;
      }
      features.push({ geometry: { type: 'Polygon', coordinates: [ringPts] }, properties });
    } else {
      features.push({ geometry: { type: 'LineString', coordinates: pts }, properties });
    }
  };

  if (gi >= 0) {
    const groups = new Map<string, Row[]>();
    for (const r of parsed) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
    for (const [name, group] of groups)
      build(group, group.length > 1 ? (join === 'points' ? 'line' : join) : 'points', name);
  } else {
    build(parsed, join, '');
  }
  return { features, warnings };
}
