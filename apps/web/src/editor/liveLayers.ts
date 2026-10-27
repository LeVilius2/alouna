import type { LayerSpecification } from 'maplibre-gl';
import { moveWalker, toLks94, toWgs84 } from '@alouna/core';
import { freshPosition, type LiveUser } from '../data/livePosition';

export const liveLayers: LayerSpecification[] = [
  {
    id: 'live-accuracy',
    type: 'fill',
    source: 'alouna-live',
    filter: ['==', ['get', 'kind'], 'accuracy'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 },
  },
  {
    id: 'live-accuracy-outline',
    type: 'line',
    source: 'alouna-live',
    filter: ['==', ['get', 'kind'], 'accuracy'],
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
  },
  {
    id: 'live-trail',
    type: 'line',
    source: 'alouna-live',
    filter: ['==', ['get', 'kind'], 'trail'],
    paint: {
      'line-color': ['get', 'color'],
      'line-opacity': 0.55,
      'line-width': 2,
      'line-dasharray': [2, 2],
    },
  },
  {
    id: 'live-route',
    type: 'line',
    source: 'alouna-live',
    filter: ['==', ['get', 'kind'], 'route'],
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.7 },
  },
  {
    id: 'live-heading',
    type: 'line',
    source: 'alouna-live',
    filter: ['==', ['get', 'kind'], 'heading'],
    paint: { 'line-color': '#ffffff', 'line-width': 4 },
  },
  {
    id: 'live-point',
    type: 'circle',
    source: 'alouna-live',
    filter: ['==', ['get', 'kind'], 'point'],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 7,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  },
];

export const liveColor = (user: LiveUser) =>
  (user.packet?.accuracy ?? 1000) > 15
    ? '#a1a1aa'
    : user.packet?.source === 'simulator'
      ? '#c084fc'
      : '#38bdf8';

export function liveGeoJson(
  users: readonly LiveUser[],
  now: number,
  showTrails: boolean,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const user of users) {
    const position = freshPosition(user, now),
      p = user.packet;
    if (!position || !p) continue;
    const add = (kind: string, geometry: GeoJSON.Geometry) =>
      features.push({
        type: 'Feature',
        properties: { kind, color: liveColor(user), session: user.key },
        geometry,
      });
    try {
      const center = toLks94(position),
        radius = p.accuracy ?? 0;
      const ring = Array.from({ length: 33 }, (_, i) => {
        const angle = (i / 32) * Math.PI * 2;
        return [
          ...toWgs84([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]),
        ];
      });
      add('accuracy', { type: 'Polygon', coordinates: [ring] });
      if (p.route && p.route.length > 1)
        add('route', { type: 'LineString', coordinates: p.route.map((point) => [...point]) });
      if (showTrails && user.trail.length > 1)
        add('trail', { type: 'LineString', coordinates: user.trail.map((point) => [...point]) });
      if (p.heading !== null) {
        const tip = moveWalker(position, p.heading, 4);
        add('heading', {
          type: 'LineString',
          coordinates: [
            [...position],
            [...tip],
            [...moveWalker(tip, p.heading + 150, 1)],
            [...tip],
            [...moveWalker(tip, p.heading - 150, 1)],
          ],
        });
      }
      add('point', { type: 'Point', coordinates: [...position] });
    } catch {
      /* An unprojectable position cannot be rendered as a metric circle. */
    }
  }
  return { type: 'FeatureCollection', features };
}
