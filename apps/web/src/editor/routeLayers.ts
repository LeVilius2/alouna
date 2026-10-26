import type { LayerSpecification } from 'maplibre-gl';
import { moveWalker } from '@alouna/core';
import type { RouteMapOverlay } from './routeState';

export const routeLayers: LayerSpecification[] = [
  {
    id: 'cost-grid',
    type: 'fill',
    source: 'alouna-costs',
    paint: {
      'fill-color': [
        'case',
        ['get', 'blocked'],
        '#dc2626',
        [
          'interpolate',
          ['linear'],
          ['get', 'cost'],
          0.4,
          '#16a34a',
          1,
          '#facc15',
          3,
          '#fb923c',
          6,
          '#c2410c',
        ],
      ],
      'fill-opacity': 0.55,
    },
  },
  {
    id: 'route-diagnostic',
    type: 'line',
    source: 'alouna-route',
    filter: ['==', ['get', 'kind'], 'diagnostic'],
    paint: { 'line-color': '#ff4545', 'line-width': 4 },
  },
  {
    id: 'route-casing',
    type: 'line',
    source: 'alouna-route',
    filter: ['==', ['get', 'kind'], 'route'],
    paint: { 'line-color': '#ffffff', 'line-width': 7 },
  },
  {
    id: 'route-line',
    type: 'line',
    source: 'alouna-route',
    filter: ['==', ['get', 'kind'], 'route'],
    paint: { 'line-color': '#2563eb', 'line-width': 4 },
  },
  {
    id: 'route-snap',
    type: 'line',
    source: 'alouna-route',
    filter: ['==', ['get', 'kind'], 'snap'],
    paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-dasharray': [1, 2] },
  },
  {
    id: 'route-endpoints',
    type: 'circle',
    source: 'alouna-route',
    filter: ['in', ['get', 'kind'], ['literal', ['start', 'end']]],
    paint: {
      'circle-radius': 9,
      'circle-color': ['case', ['==', ['get', 'kind'], 'start'], '#16a34a', '#9333ea'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  },
  {
    id: 'walker-heading',
    type: 'line',
    source: 'alouna-route',
    filter: ['==', ['get', 'kind'], 'heading'],
    paint: { 'line-color': '#ffffff', 'line-width': 4 },
  },
  {
    id: 'walker-point',
    type: 'circle',
    source: 'alouna-route',
    filter: ['==', ['get', 'kind'], 'walker'],
    paint: {
      'circle-radius': 7,
      'circle-color': '#facc15',
      'circle-stroke-color': '#111111',
      'circle-stroke-width': 2,
    },
  },
];

export function routeGeoJson(overlay?: RouteMapOverlay | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const add = (kind: string, geometry: GeoJSON.Geometry) =>
    features.push({ type: 'Feature', properties: { kind }, geometry });
  if (!overlay) return { type: 'FeatureCollection', features };
  for (const endpoint of ['start', 'end'] as const) {
    if (overlay[endpoint]) add(endpoint, { type: 'Point', coordinates: [...overlay[endpoint]] });
    const inspection = overlay.response?.endpoints[endpoint];
    if (inspection && !inspection.passable)
      add('diagnostic', { type: 'LineString', coordinates: inspection.ring.map((p) => [...p]) });
  }
  const result = overlay.response?.result;
  if (result?.status === 'ok') {
    if (result.waypoints.length > 1)
      add('route', { type: 'LineString', coordinates: result.waypoints.map((p) => [...p]) });
    for (const snap of result.snaps)
      add('snap', { type: 'LineString', coordinates: [[...snap.from], [...snap.to]] });
  }
  if (overlay.walker) {
    const { position, headingDegrees } = overlay.walker;
    const tip = moveWalker(position, headingDegrees, 3);
    add('walker', { type: 'Point', coordinates: [...position] });
    add('heading', {
      type: 'LineString',
      coordinates: [
        [...position],
        [...tip],
        [...moveWalker(tip, headingDegrees + 150, 1)],
        [...tip],
        [...moveWalker(tip, headingDegrees - 150, 1)],
      ],
    });
  }
  return { type: 'FeatureCollection', features };
}
