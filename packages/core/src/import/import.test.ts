import { describe, expect, it } from 'vitest';
import { toLks94 } from '../geo/projection';
import { convertImport, detectCrs } from './crs';
import { parseCoordinateText } from './csv';
import { parseGeoJson } from './geojson';

describe('parseGeoJson', () => {
  it('explodes multi-geometries and collections, drops Z and repeated vertices', () => {
    const { features, warnings } = parseGeoJson({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Trees' },
          geometry: {
            type: 'MultiPoint',
            coordinates: [
              [25.69, 55.63, 120],
              [25.7, 55.64],
            ],
          },
        },
        {
          type: 'Feature',
          properties: null,
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              {
                type: 'LineString',
                coordinates: [
                  [25.69, 55.63],
                  [25.69, 55.63],
                  [25.7, 55.64],
                ],
              },
              { type: 'Circle', coordinates: [0, 0] },
            ],
          },
        },
      ],
    });
    expect(features).toHaveLength(3);
    expect(features[0]).toEqual({
      geometry: { type: 'Point', coordinates: [25.69, 55.63] },
      properties: { name: 'Trees' },
    });
    expect(features[2]!.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [25.69, 55.63],
        [25.7, 55.64],
      ],
    });
    expect(warnings).toEqual(['Item 2: unsupported geometry type Circle, skipped.']);
  });

  it('closes open polygon rings and rejects degenerate ones', () => {
    const open = parseGeoJson({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    });
    expect(open.features[0]!.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    const bad = parseGeoJson({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
        ],
      ],
    });
    expect(bad.features).toHaveLength(0);
    expect(bad.warnings[0]).toMatch(/invalid Polygon/);
  });
});

describe('parseCoordinateText', () => {
  it('reads header CSV with groups into lines and closed polygons', () => {
    const csv = [
      'name,group,lat,lon',
      'a,ditch,55.6360,25.6940',
      'b,ditch,55.6362,25.6945',
      'p1,shed,55.6360,25.6950',
      'p2,shed,55.6360,25.6952',
      'p3,shed,55.6362,25.6952',
      'p4,shed,55.6360,25.6950',
      'well,,55.6364,25.6948',
    ].join('\n');
    const { features } = parseCoordinateText(csv);
    expect(features.map((f) => f.geometry.type)).toEqual(['LineString', 'Polygon', 'Point']);
    // Header columns map lon -> x, lat -> y.
    expect(features[2]!.geometry.coordinates).toEqual([25.6948, 55.6364]);
    expect(features[0]!.properties).toEqual({ name: 'a' });
  });

  it('handles pasted lat,lon pairs and Lithuanian decimal commas', () => {
    const pasted = parseCoordinateText('55.6360, 25.6940\n55.6362, 25.6945', 'line');
    expect(pasted.features).toHaveLength(1);
    expect(pasted.features[0]!.geometry.type).toBe('LineString');
    const semicolon = parseCoordinateText('55,6360;25,6940;Šulinys');
    expect(semicolon.features[0]).toEqual({
      geometry: { type: 'Point', coordinates: [55.636, 25.694] },
      properties: { name: 'Šulinys' },
    });
  });

  it('joins rows into a polygon on request and warns about bad rows', () => {
    const { features, warnings } = parseCoordinateText('0 0\n1 0\nnope\n1 1', 'polygon');
    expect(features[0]!.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    expect(warnings).toHaveLength(1);
  });
});

describe('CRS detection and conversion', () => {
  const lonLat = [25.6953, 55.6363] as const;
  const lks = toLks94(lonLat);

  it('detects WGS84 in both axis orders', () => {
    const p = (x: number, y: number) => ({
      geometry: { type: 'Point' as const, coordinates: [x, y] as const },
      properties: {},
    });
    expect(detectCrs([p(25.69, 55.63)])).toBe('wgs84');
    expect(detectCrs([p(55.63, 25.69)])).toBe('wgs84-latlon');
    expect(detectCrs([p(lks[0], lks[1])])).toBe('lks94');
    expect(detectCrs([p(lks[1], lks[0])])).toBe('lks94-ne');
    expect(detectCrs([p(1e9, 1e9)])).toBeNull();
  });

  it('converts LKS94 back to WGS84 within a centimetre', () => {
    const result = convertImport(
      [{ geometry: { type: 'Point', coordinates: [lks[1], lks[0]] }, properties: {} }],
      'auto',
    );
    expect(result.crs).toBe('lks94-ne');
    const [lon, lat] = result.features[0]!.geometry.coordinates as readonly number[];
    expect(lon).toBeCloseTo(lonLat[0], 7);
    expect(lat).toBeCloseTo(lonLat[1], 7);
  });

  it('reports out-of-range coordinates for a manual CRS', () => {
    const result = convertImport(
      [{ geometry: { type: 'Point', coordinates: [500, 20] }, properties: {} }],
      'wgs84',
    );
    expect(result.features).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/outside the valid range/);
  });
});
