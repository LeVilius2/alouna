import { gpx, kml } from '@tmcw/togeojson';
import {
  convertImport,
  parseCoordinateText,
  parseGeoJson,
  type ConvertResult,
  type ImportCrs,
  type JoinMode,
  type ParseResult,
} from '@alouna/core';

export type ImportFormat = 'auto' | 'geojson' | 'kml' | 'gpx' | 'csv';

function detectFormat(text: string, filename = ''): Exclude<ImportFormat, 'auto'> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.kml')) return 'kml';
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return 'geojson';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'geojson';
  if (trimmed.startsWith('<')) {
    if (/<gpx[\s>]/i.test(trimmed)) return 'gpx';
    return 'kml';
  }
  return 'csv';
}

function parseXml(text: string, kind: 'kml' | 'gpx'): ParseResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) return { features: [], warnings: [`Invalid ${kind.toUpperCase()} XML.`] };
  const fc = kind === 'kml' ? kml(doc, { skipNullGeometry: true }) : gpx(doc);
  return parseGeoJson(fc);
}

export function parseImportInput(
  text: string,
  options: {
    filename?: string;
    format?: ImportFormat;
    crs?: ImportCrs | 'auto';
    join?: JoinMode;
  } = {},
): ConvertResult & { format: Exclude<ImportFormat, 'auto'> } {
  const format =
    !options.format || options.format === 'auto'
      ? detectFormat(text, options.filename)
      : options.format;
  let parsed: ParseResult;
  if (format === 'geojson') {
    try {
      parsed = parseGeoJson(JSON.parse(text));
    } catch {
      return { format, crs: null, features: [], warnings: ['Invalid JSON.'] };
    }
  } else if (format === 'kml' || format === 'gpx') {
    parsed = parseXml(text, format);
  } else {
    parsed = parseCoordinateText(text, options.join ?? 'points');
  }
  // KML and GPX are defined in WGS84 by standard unless overridden manually.
  const defaultCrs = format === 'kml' || format === 'gpx' ? 'wgs84' : 'auto';
  const converted = convertImport(parsed.features, options.crs ?? defaultCrs);
  return {
    format,
    crs: converted.crs,
    features: converted.features,
    warnings: [...parsed.warnings, ...converted.warnings],
  };
}
